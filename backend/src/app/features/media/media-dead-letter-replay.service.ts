import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { BlobService } from "@/features/blob/blob.service";
import type { MediaRecord } from "@/features/media/media.model";
import type {
  MediaDeadLetterMessage,
  MediaDeadLetterReader,
  MediaProcessingQueueService,
} from "@/features/media/media-processing.queue.service";
import type { MediaRepository } from "@/features/media/media.repository";

export const DEFAULT_REPLAY_LIMIT = 1000;

// Rows read per query in a database-driven replay.
const DATABASE_PAGE_SIZE = 100;

/**
 * Where a replay finds its work: the dead-letter queue's messages, or the
 * items rejected as `processing_failed` that the database still holds, which
 * also reaches an item whose job never reached the queue, such as one the
 * media cleanup rejected after losing its jobs.
 */
export type MediaReplaySource = "queue" | "database";

/**
 * What happened to one dead-lettered job, or one item in a database replay.
 *
 * replayed: its item was rejected as `processing_failed` with its upload still
 *   kept, and was reopened and queued again.
 * requeued: its item never got marked rejected (the outage that exhausted the
 *   retries stopped that too) and had not moved since, so it was claimed and
 *   queued again.
 * skipped: nothing is left to do: the item is gone, ready, already being
 *   handled (`in_flight`), or changed while this ran.
 * not_replayable: the item cannot be processed from what is kept: its
 *   rejection is final, its upload has already been deleted, or its rejected
 *   retention has passed and the media cleanup is purging it (`expired`).
 * invalid: the message is not a processing job.
 * duplicate: an earlier message in this run already handled the same item.
 * failed: settling it failed, so it was left for another run.
 */
export type MediaDeadLetterOutcome =
  | "replayed"
  | "requeued"
  | "skipped"
  | "not_replayable"
  | "invalid"
  | "duplicate"
  | "failed";

export interface MediaDeadLetterReplayItem {
  mediaId: string | null;
  /** The dead-lettered job's id; null in a database replay. */
  jobId: string | null;
  outcome: MediaDeadLetterOutcome;
  /** Why, where the outcome alone does not say, or the failure's message. */
  reason?: string;
}

export interface MediaDeadLetterReplayResult {
  mode: "dry-run" | "replay";
  source: MediaReplaySource;
  /** Messages taken from the queue, or rows read from the database. */
  scanned: number;
  replayed: number;
  requeued: number;
  skipped: number;
  notReplayable: number;
  invalid: number;
  duplicate: number;
  failed: number;
  /**
   * One entry per message or row. In a dry run, each outcome is what a replay
   * would do; nothing is written and every message stays in the queue.
   */
  items: MediaDeadLetterReplayItem[];
  /**
   * Why the run stopped early, such as the broker closing the channel. What
   * is listed in `items` was still settled.
   */
  error: string | null;
}

export function mediaDeadLetterReplayExitCode(
  result: Pick<MediaDeadLetterReplayResult, "failed" | "error">,
): 0 | 1 {
  return result.failed > 0 || result.error !== null ? 1 : 0;
}

export interface MediaDeadLetterReplayOptions {
  /**
   * The media cleanup's rejected retention. An item rejected longer ago is
   * the cleanup's to purge, and is never reopened.
   */
  rejectedRetentionMs: number;
}

type Decision =
  | { outcome: "replay" | "requeue" }
  | {
      outcome: Exclude<
        MediaDeadLetterOutcome,
        "replayed" | "requeued" | "failed" | "duplicate" | "invalid"
      >;
      reason: string;
    };

/**
 * Replays media processing jobs once whatever exhausted their retries, such
 * as a storage or database outage, is over.
 *
 * From the queue, each message is decided from its item's current row, then
 * settled: an item that can still be processed is queued again as a fresh job
 * with attempt 0, and the message is acknowledged; one that cannot is only
 * acknowledged. A message whose handling fails is left unacknowledged and goes
 * back to the queue when the run ends, so a later run can try it again. A run
 * takes only the messages ready when it started, so a replayed job that is
 * dead-lettered again during the run is left for the next one rather than
 * taken for a duplicate.
 *
 * From the database, every item rejected as `processing_failed` within the
 * rejected retention whose upload is still kept is reopened and queued again.
 * Messages for those items stay in the queue; a later queue replay reports
 * them as skipped.
 *
 * Every change is guarded on the row's status, so a user deleting the item,
 * the cleanup purging it, or a concurrent run replaying it cannot be undone.
 * An unfinished item is only queued again after claiming it, while it has not
 * moved since its job was dead-lettered, so of several replays of one item,
 * whether duplicate messages, separate runs, or concurrent ones, only the
 * first queues a job. A replayed item that fails again goes through the retry
 * tiers from the start and is dead-lettered again.
 */
export class MediaDeadLetterReplayService {
  constructor(
    private readonly repository: Pick<
      MediaRepository,
      | "findById"
      | "reopenForReplay"
      | "claimForReplay"
      | "listReplayableRejections"
    >,
    private readonly blobService: Pick<BlobService, "getProperties">,
    private readonly queue: Pick<
      MediaProcessingQueueService,
      "openDeadLetterQueue"
    >,
    private readonly options: MediaDeadLetterReplayOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(options: {
    dryRun: boolean;
    limit?: number;
    source?: MediaReplaySource;
  }): Promise<MediaDeadLetterReplayResult> {
    const source = options.source ?? "queue";
    const result: MediaDeadLetterReplayResult = {
      mode: options.dryRun ? "dry-run" : "replay",
      source,
      scanned: 0,
      replayed: 0,
      requeued: 0,
      skipped: 0,
      notReplayable: 0,
      invalid: 0,
      duplicate: 0,
      failed: 0,
      items: [],
      error: null,
    };
    const limit = options.limit ?? DEFAULT_REPLAY_LIMIT;
    // Both sources publish on the reader's channel, which is opened once.
    const reader = await this.queue.openDeadLetterQueue();

    // Messages left unacknowledged, in a dry run all of them, return to the
    // queue when the reader closes.
    try {
      if (source === "queue") {
        await this.replayQueue(reader, limit, options.dryRun, result);
      } else {
        await this.replayDatabase(reader, limit, options.dryRun, result);
      }
    } catch (error) {
      // The channel or the database went away mid-run. What was settled so
      // far is still reported, so the operator knows what was replayed.
      result.error = describe(error);
    } finally {
      await reader.close();
    }

    return result;
  }

  private async replayQueue(
    reader: MediaDeadLetterReader,
    limit: number,
    dryRun: boolean,
    result: MediaDeadLetterReplayResult,
  ): Promise<void> {
    const seen = new Set<string>();
    const count = Math.min(limit, reader.depth);

    while (result.scanned < count) {
      const message = await reader.take();

      if (!message) {
        return;
      }

      result.scanned += 1;
      record(result, await this.handle(reader, message, seen, dryRun));
    }
  }

  private async replayDatabase(
    reader: MediaDeadLetterReader,
    limit: number,
    dryRun: boolean,
    result: MediaDeadLetterReplayResult,
  ): Promise<void> {
    const rejectedAfter = this.retentionStart();
    // Paged by id, so an item reopened or failing is not selected again
    // within the same run.
    let afterId: string | null = null;

    while (result.scanned < limit) {
      const batch = await this.repository.listReplayableRejections(
        rejectedAfter,
        afterId,
        Math.min(DATABASE_PAGE_SIZE, limit - result.scanned),
      );

      if (batch.length === 0) {
        return;
      }

      for (const row of batch) {
        afterId = row.id;
        result.scanned += 1;
        record(result, await this.replayRejection(reader, row, dryRun));
      }
    }
  }

  private async replayRejection(
    reader: MediaDeadLetterReader,
    row: MediaRecord,
    dryRun: boolean,
  ): Promise<MediaDeadLetterReplayItem> {
    const item = { mediaId: row.id, jobId: null };

    try {
      const decision = await this.decide(row, this.now());

      if ("reason" in decision) {
        return { ...item, outcome: decision.outcome, reason: decision.reason };
      }

      if (dryRun) {
        return { ...item, outcome: "replayed" };
      }

      if (!(await this.claim(row.id, decision, this.now()))) {
        return { ...item, outcome: "skipped", reason: "changed" };
      }

      await reader.republish(row.id);
      return { ...item, outcome: "replayed" };
    } catch (error) {
      return { ...item, outcome: "failed", reason: describe(error) };
    }
  }

  private async handle(
    reader: MediaDeadLetterReader,
    message: MediaDeadLetterMessage,
    seen: Set<string>,
    dryRun: boolean,
  ): Promise<MediaDeadLetterReplayItem> {
    const { payload } = message;
    const item = {
      mediaId: payload?.mediaId ?? null,
      jobId: payload?.jobId ?? null,
    };

    try {
      if (!payload) {
        settle(message, dryRun);
        return { ...item, outcome: "invalid" };
      }

      // A job can be dead-lettered more than once, when the cleanup queued
      // its item again and that job failed too. One replay is enough.
      if (seen.has(payload.mediaId)) {
        settle(message, dryRun);
        return { ...item, outcome: "duplicate" };
      }

      seen.add(payload.mediaId);

      const row = await this.repository.findById(payload.mediaId);
      // A message published by this service always carries its time. Without
      // one, the original enqueue time is an earlier, safe stand-in.
      const deadLetteredAt =
        message.deadLetteredAt ?? new Date(payload.occurredAt);
      const decision = await this.decide(row, deadLetteredAt);

      if ("reason" in decision) {
        settle(message, dryRun);
        return { ...item, outcome: decision.outcome, reason: decision.reason };
      }

      const outcome = decision.outcome === "replay" ? "replayed" : "requeued";

      if (dryRun) {
        return { ...item, outcome };
      }

      if (!(await this.claim(payload.mediaId, decision, deadLetteredAt))) {
        message.ack();
        return { ...item, outcome: "skipped", reason: "changed" };
      }

      // Published before the ack, so a failure here leaves the message in the
      // queue. A claimed item whose job is never published is taken for a
      // lost one by the media cleanup.
      await reader.republish(payload.mediaId);
      message.ack();

      return { ...item, outcome };
    } catch (error) {
      return { ...item, outcome: "failed", reason: describe(error) };
    }
  }

  /**
   * Takes the item for this replay: a rejection is reopened, an unfinished
   * item claimed. Returns false when another actor got there first.
   */
  private claim(
    mediaId: MediaRecord["id"],
    decision: { outcome: "replay" | "requeue" },
    deadLetteredAt: Date,
  ): Promise<boolean> {
    return decision.outcome === "replay"
      ? this.repository.reopenForReplay(mediaId, this.retentionStart())
      : this.repository.claimForReplay(mediaId, deadLetteredAt, this.now());
  }

  private async decide(
    row: MediaRecord | null,
    deadLetteredAt: Date,
  ): Promise<Decision> {
    if (!row) {
      return { outcome: "skipped", reason: "missing" };
    }

    switch (row.status) {
      case "ready":
        return { outcome: "skipped", reason: "ready" };
      case "uploaded":
      case "processing":
        // Rejecting it failed along with processing. Once it has moved since,
        // something else already has it: a replay of a duplicate message, a
        // job the media cleanup queued again, or a worker. Another job would
        // only process it twice at once.
        return row.updatedAt.getTime() > deadLetteredAt.getTime()
          ? { outcome: "skipped", reason: "in_flight" }
          : { outcome: "requeue" };
      case "pending_upload":
        return { outcome: "not_replayable", reason: "not_uploaded" };
      case "rejected":
        break;
    }

    if (row.rejectionCode !== "processing_failed") {
      return { outcome: "not_replayable", reason: "final_rejection" };
    }

    // Past its retention, the media cleanup may be deleting its upload and
    // row right now; reopening it would race that purge.
    if (row.updatedAt.getTime() <= this.retentionStart().getTime()) {
      return { outcome: "not_replayable", reason: "expired" };
    }

    if (!(await this.uploadExists(row))) {
      return { outcome: "not_replayable", reason: "upload_deleted" };
    }

    return { outcome: "replay" };
  }

  /** Rejections at or before this are the media cleanup's to purge. */
  private retentionStart(): Date {
    return new Date(this.now().getTime() - this.options.rejectedRetentionMs);
  }

  private async uploadExists(row: MediaRecord): Promise<boolean> {
    try {
      await this.blobService.getProperties(row.originalBlobName);
      return true;
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return false;
      }

      throw error;
    }
  }
}

/** Removes a message that needs nothing more, except in a dry run. */
function settle(message: MediaDeadLetterMessage, dryRun: boolean): void {
  if (!dryRun) {
    message.ack();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const OUTCOME_COUNTERS: Record<
  MediaDeadLetterOutcome,
  keyof Pick<
    MediaDeadLetterReplayResult,
    | "replayed"
    | "requeued"
    | "skipped"
    | "notReplayable"
    | "invalid"
    | "duplicate"
    | "failed"
  >
> = {
  replayed: "replayed",
  requeued: "requeued",
  skipped: "skipped",
  not_replayable: "notReplayable",
  invalid: "invalid",
  duplicate: "duplicate",
  failed: "failed",
};

function record(
  result: MediaDeadLetterReplayResult,
  item: MediaDeadLetterReplayItem,
): void {
  result[OUTCOME_COUNTERS[item.outcome]] += 1;
  result.items.push(item);
}
