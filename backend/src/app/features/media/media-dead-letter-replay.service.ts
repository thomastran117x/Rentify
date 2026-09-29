import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type { BlobService } from "@/features/blob/blob.service";
import type { MediaRecord } from "@/features/media/media.model";
import type {
  MediaDeadLetterMessage,
  MediaProcessingQueueService,
} from "@/features/media/media-processing.queue.service";
import type { MediaRepository } from "@/features/media/media.repository";

export const DEFAULT_REPLAY_LIMIT = 1000;

/**
 * What happened to one dead-lettered job.
 *
 * replayed: its item was rejected as `processing_failed` with its upload still
 *   kept, and was reopened and queued again.
 * requeued: its item never got marked rejected (the outage that exhausted the
 *   retries stopped that too) and is still waiting, so it was queued again.
 * skipped: nothing is left to do: the item is gone, ready, or changed while
 *   this ran.
 * not_replayable: the item cannot be processed from what is kept: its
 *   rejection is final, or its upload has already been deleted.
 * invalid: the message is not a processing job.
 * duplicate: an earlier message in this run already handled the same item.
 * failed: settling it failed, so it was left in the queue for another run.
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
  jobId: string | null;
  outcome: MediaDeadLetterOutcome;
  /** Why, where the outcome alone does not say, or the failure's message. */
  reason?: string;
}

export interface MediaDeadLetterReplayResult {
  mode: "dry-run" | "replay";
  /** Messages taken from the dead-letter queue. */
  scanned: number;
  replayed: number;
  requeued: number;
  skipped: number;
  notReplayable: number;
  invalid: number;
  duplicate: number;
  failed: number;
  /**
   * One entry per message. In a dry run, each outcome is what a replay would
   * do, and every message stays in the queue.
   */
  items: MediaDeadLetterReplayItem[];
}

export function mediaDeadLetterReplayExitCode(
  result: Pick<MediaDeadLetterReplayResult, "failed">,
): 0 | 1 {
  return result.failed > 0 ? 1 : 0;
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
 * Replays jobs from `media.processing.dead-letter` once whatever exhausted
 * their retries, such as a storage or database outage, is over.
 *
 * Each message is decided from its item's current row, then settled: an item
 * that can still be processed is queued again as a fresh job with attempt 0,
 * and the message is acknowledged; one that cannot is only acknowledged. A
 * message whose handling fails is left unacknowledged and goes back to the
 * queue when the run ends, so a later run can try it again.
 *
 * Every change is guarded on the row's status, so a user deleting the item,
 * the cleanup purging it, or a concurrent run replaying it cannot be undone.
 * A replayed item that fails again goes through the retry tiers from the
 * start and is dead-lettered again.
 */
export class MediaDeadLetterReplayService {
  constructor(
    private readonly repository: Pick<
      MediaRepository,
      "findById" | "reopenForReplay"
    >,
    private readonly blobService: Pick<BlobService, "getProperties">,
    private readonly queue: Pick<
      MediaProcessingQueueService,
      "openDeadLetterQueue" | "enqueueMediaProcessingJob"
    >,
  ) {}

  async run(options: {
    dryRun: boolean;
    limit?: number;
  }): Promise<MediaDeadLetterReplayResult> {
    const limit = options.limit ?? DEFAULT_REPLAY_LIMIT;
    const result: MediaDeadLetterReplayResult = {
      mode: options.dryRun ? "dry-run" : "replay",
      scanned: 0,
      replayed: 0,
      requeued: 0,
      skipped: 0,
      notReplayable: 0,
      invalid: 0,
      duplicate: 0,
      failed: 0,
      items: [],
    };
    const seen = new Set<string>();
    const reader = await this.queue.openDeadLetterQueue();

    // Messages left unacknowledged, in a dry run all of them, return to the
    // queue when the reader closes. Until then `take` does not see them
    // again, so the run always ends.
    try {
      while (result.scanned < limit) {
        const message = await reader.take();

        if (!message) {
          break;
        }

        result.scanned += 1;
        const item = await this.handle(message, seen, options.dryRun);
        record(result, item);
      }
    } finally {
      await reader.close();
    }

    return result;
  }

  private async handle(
    message: MediaDeadLetterMessage,
    seen: Set<string>,
    dryRun: boolean,
  ): Promise<MediaDeadLetterReplayItem> {
    const { payload } = message;

    if (!payload) {
      settle(message, dryRun);
      return { mediaId: null, jobId: null, outcome: "invalid" };
    }

    const item = { mediaId: payload.mediaId, jobId: payload.jobId };

    // A job can be dead-lettered more than once, when the cleanup queued its
    // item again and that job failed too. One replay is enough.
    if (seen.has(payload.mediaId)) {
      settle(message, dryRun);
      return { ...item, outcome: "duplicate" };
    }

    seen.add(payload.mediaId);

    try {
      const record = await this.repository.findById(payload.mediaId);
      const decision = await this.decide(record);

      if ("reason" in decision) {
        settle(message, dryRun);
        return { ...item, outcome: decision.outcome, reason: decision.reason };
      }

      if (dryRun) {
        return {
          ...item,
          outcome: decision.outcome === "replay" ? "replayed" : "requeued",
        };
      }

      if (
        decision.outcome === "replay" &&
        !(await this.repository.reopenForReplay(payload.mediaId))
      ) {
        message.ack();
        return { ...item, outcome: "skipped", reason: "changed" };
      }

      // Published before the ack, so a failure here leaves the message in the
      // queue. A reopened item whose job is never published is taken for a
      // lost one by the media cleanup.
      await this.queue.enqueueMediaProcessingJob(payload.mediaId);
      message.ack();

      return {
        ...item,
        outcome: decision.outcome === "replay" ? "replayed" : "requeued",
      };
    } catch (error) {
      return {
        ...item,
        outcome: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async decide(record: MediaRecord | null): Promise<Decision> {
    if (!record) {
      return { outcome: "skipped", reason: "missing" };
    }

    switch (record.status) {
      case "ready":
        return { outcome: "skipped", reason: "ready" };
      case "uploaded":
      case "processing":
        // Rejecting it failed along with processing. A job that reaches it
        // claims it as usual; a duplicate of one the cleanup queued is a no-op.
        return { outcome: "requeue" };
      case "pending_upload":
        return { outcome: "not_replayable", reason: "not_uploaded" };
      case "rejected":
        break;
    }

    if (record.rejectionCode !== "processing_failed") {
      return { outcome: "not_replayable", reason: "final_rejection" };
    }

    if (!(await this.uploadExists(record))) {
      return { outcome: "not_replayable", reason: "upload_deleted" };
    }

    return { outcome: "replay" };
  }

  private async uploadExists(record: MediaRecord): Promise<boolean> {
    try {
      await this.blobService.getProperties(record.originalBlobName);
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

const OUTCOME_COUNTERS: Record<
  MediaDeadLetterOutcome,
  keyof Omit<MediaDeadLetterReplayResult, "mode" | "scanned" | "items">
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
