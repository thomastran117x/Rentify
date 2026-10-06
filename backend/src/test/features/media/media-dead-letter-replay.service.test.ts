import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  MediaProcessingJobPayload,
  MediaRecord,
  MediaStatus,
} from "@/features/media/media.model";
import type {
  MediaDeadLetterMessage,
  MediaDeadLetterReader,
} from "@/features/media/media-processing.queue.service";
import {
  mediaDeadLetterReplayExitCode,
  MediaDeadLetterReplayService,
} from "@/features/media/media-dead-letter-replay.service";
import { InMemoryMediaRepository } from "../../support/in-memory-media-repository";
import { testUuid } from "../../support/uuid";

const USER_ID = testUuid(9000, 994700);
const HOUR_MS = 60 * 60 * 1000;
const RETENTION_MS = 24 * HOUR_MS;
let nextMediaIndex = 994701;

/**
 * A dead-letter queue as the reader sees it: `take` hands out each message
 * once, `depth` is what was queued when it opened, and closing puts back every
 * message not acknowledged. Each message is
 * dead-lettered a minute before it is pushed, as a real one precedes the
 * replay that reads it, unless a time is given.
 */
class FakeDeadLetterQueue {
  readonly queued: (MediaProcessingJobPayload | null)[] = [];
  private readonly deadLetteredAt = new Map<
    MediaProcessingJobPayload | null,
    Date | null
  >();
  closed = 0;

  push(...payloads: (MediaProcessingJobPayload | null)[]): void {
    for (const payload of payloads) {
      this.pushAt(new Date(Date.now() - 60_000), payload);
    }
  }

  pushAt(
    deadLetteredAt: Date | null,
    payload: MediaProcessingJobPayload | null,
  ): void {
    this.deadLetteredAt.set(payload, deadLetteredAt);
    this.queued.push(payload);
  }

  open(republish: (mediaId: string) => Promise<void>): MediaDeadLetterReader {
    const taken: (MediaProcessingJobPayload | null)[] = [];
    const acked = new Set<number>();

    return {
      depth: this.queued.length,
      republish,
      take: async (): Promise<MediaDeadLetterMessage | null> => {
        if (this.queued.length === 0) {
          return null;
        }

        const payload = this.queued.shift()!;
        const index = taken.push(payload) - 1;

        return {
          payload,
          deadLetteredAt: this.deadLetteredAt.get(payload) ?? null,
          ack: () => acked.add(index),
        };
      },
      close: async () => {
        this.closed += 1;
        this.queued.unshift(...taken.filter((_, index) => !acked.has(index)));
      },
    };
  }
}

function createContext() {
  const repository = new InMemoryMediaRepository();
  const deadLetters = new FakeDeadLetterQueue();
  const storedBlobs = new Set<string>();
  const blobService = {
    getProperties: jest.fn(async (blobName: string) => {
      if (!storedBlobs.has(blobName)) {
        throw new ResourceNotFoundError("Blob not found.");
      }

      return { contentLength: 1 };
    }),
  };
  const republish = jest.fn(async (_mediaId: string) => undefined);
  const queue = {
    openDeadLetterQueue: jest.fn(async () => deadLetters.open(republish)),
  };
  const service = new MediaDeadLetterReplayService(
    repository,
    blobService as never,
    queue,
    { rejectedRetentionMs: RETENTION_MS },
  );

  function addMedia(
    status: MediaStatus,
    overrides: Partial<MediaRecord> = {},
    options: { uploadKept?: boolean } = {},
  ): MediaRecord {
    const id = testUuid(9000, nextMediaIndex++);
    // Last moved before its job was dead-lettered, as a real item would be.
    const now = new Date(Date.now() - HOUR_MS);
    const record: MediaRecord = {
      id,
      userId: USER_ID,
      status,
      scope: "postings",
      originalBlobName: `quarantine/images/${USER_ID}/${id}`,
      processedBlobName: null,
      declaredContentType: "image/png",
      detectedContentType: null,
      originalFilename: null,
      originalEtag: null,
      sizeBytes: 10,
      width: null,
      height: null,
      variants: null,
      rejectionReason: null,
      rejectionCode: null,
      processingRequeues: 0,
      processingAttempts: 5,
      processingStartedAt: now,
      processingCompletedAt: null,
      processingError: "Error: storage unavailable",
      scanStatus: "not_scanned",
      scanEngine: null,
      scannedAt: null,
      threatName: null,
      moderationResult: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    repository.put(record);

    if (options.uploadKept ?? true) {
      storedBlobs.add(record.originalBlobName);
    }

    return record;
  }

  function processingFailed(options: { uploadKept?: boolean } = {}) {
    return addMedia(
      "rejected",
      {
        rejectionReason: "The image could not be processed.",
        rejectionCode: "processing_failed",
        processingCompletedAt: new Date(),
      },
      options,
    );
  }

  return {
    repository,
    deadLetters,
    blobService,
    queue,
    republish,
    service,
    addMedia,
    processingFailed,
  };
}

function job(mediaId: string, jobId = `job-${mediaId}`) {
  return {
    jobId,
    mediaId: mediaId as MediaProcessingJobPayload["mediaId"],
    attempt: 5,
    occurredAt: "2026-09-29T12:00:00.000Z",
  };
}

describe("MediaDeadLetterReplayService", () => {
  it("reopens and queues again an item rejected as a processing failure", async () => {
    const context = createContext();
    const failed = context.processingFailed();
    context.deadLetters.push(job(failed.id));

    const result = await context.service.run({ dryRun: false });

    expect(result).toMatchObject({
      mode: "replay",
      scanned: 1,
      replayed: 1,
      failed: 0,
      items: [{ mediaId: failed.id, outcome: "replayed" }],
    });
    await expect(context.repository.findById(failed.id)).resolves.toMatchObject(
      {
        status: "uploaded",
        rejectionReason: null,
        rejectionCode: null,
        processingCompletedAt: null,
        // Kept for operators until the next failure overwrites it.
        processingError: "Error: storage unavailable",
      },
    );
    expect(context.republish).toHaveBeenCalledWith(failed.id);
    expect(context.deadLetters.queued).toEqual([]);
    expect(context.deadLetters.closed).toBe(1);
  });

  it("queues again an item whose rejection never landed", async () => {
    const context = createContext();
    const uploaded = context.addMedia("uploaded");
    const processing = context.addMedia("processing");
    context.deadLetters.push(job(uploaded.id), job(processing.id));

    const result = await context.service.run({ dryRun: false });

    expect(result).toMatchObject({ requeued: 2, replayed: 0 });
    expect(context.republish.mock.calls).toEqual([
      [uploaded.id],
      [processing.id],
    ]);
    expect((await context.repository.findById(processing.id))?.status).toBe(
      "processing",
    );
    expect(context.deadLetters.queued).toEqual([]);
  });

  it("queues an unfinished item once, however its duplicates are split across runs", async () => {
    const context = createContext();
    const uploaded = context.addMedia("uploaded");
    context.deadLetters.push(
      job(uploaded.id, "first"),
      job(uploaded.id, "second"),
    );

    const first = await context.service.run({ dryRun: false, limit: 1 });
    const second = await context.service.run({ dryRun: false, limit: 1 });

    expect(first.items).toEqual([
      expect.objectContaining({ jobId: "first", outcome: "requeued" }),
    ]);
    // The first run's claim moved the item after the second message was
    // dead-lettered, so the second run leaves it to the job already queued.
    expect(second.items).toEqual([
      expect.objectContaining({
        jobId: "second",
        outcome: "skipped",
        reason: "in_flight",
      }),
    ]);
    expect(context.republish).toHaveBeenCalledTimes(1);
    expect(context.deadLetters.queued).toEqual([]);
  });

  it("leaves an unfinished item that moved after its job was dead-lettered", async () => {
    const context = createContext();
    const moved = context.addMedia("processing", { updatedAt: new Date() });
    context.deadLetters.pushAt(
      new Date(Date.now() - HOUR_MS / 2),
      job(moved.id),
    );

    const result = await context.service.run({ dryRun: false });

    expect(result.items).toEqual([
      expect.objectContaining({ outcome: "skipped", reason: "in_flight" }),
    ]);
    expect(context.republish).not.toHaveBeenCalled();
  });

  it("does not queue an unfinished item another replay claimed first", async () => {
    const context = createContext();
    const uploaded = context.addMedia("uploaded");
    context.deadLetters.push(job(uploaded.id));
    // As if a concurrent run claimed it between the read and the claim.
    jest
      .spyOn(context.repository, "claimForReplay")
      .mockResolvedValueOnce(false);

    const result = await context.service.run({ dryRun: false });

    expect(result.items).toEqual([
      expect.objectContaining({ outcome: "skipped", reason: "changed" }),
    ]);
    expect(context.republish).not.toHaveBeenCalled();
    expect(context.deadLetters.queued).toEqual([]);
  });

  it("claims an unfinished item as of the job's own time when the message has none", async () => {
    const context = createContext();
    const unmoved = context.addMedia("uploaded", {
      updatedAt: new Date("2026-09-29T11:00:00.000Z"),
    });
    const moved = context.addMedia("uploaded", {
      updatedAt: new Date("2026-09-29T13:00:00.000Z"),
    });
    // job() stamps occurredAt 2026-09-29T12:00:00.000Z.
    context.deadLetters.pushAt(null, job(unmoved.id));
    context.deadLetters.pushAt(null, job(moved.id));
    const claim = jest.spyOn(context.repository, "claimForReplay");

    const result = await context.service.run({ dryRun: false });

    expect(result.items.map((item) => item.outcome)).toEqual([
      "requeued",
      "skipped",
    ]);
    expect(claim).toHaveBeenCalledWith(
      unmoved.id,
      new Date("2026-09-29T12:00:00.000Z"),
      expect.any(Date),
    );
  });

  it("removes and reports every message it cannot replay", async () => {
    const context = createContext();
    const ready = context.addMedia("ready");
    const finalRejection = context.addMedia("rejected", {
      rejectionReason: "Uploaded file could not be read as an image.",
      rejectionCode: "corrupt",
    });
    const legacyRejection = context.addMedia("rejected");
    const uploadGone = context.processingFailed({ uploadKept: false });
    const pending = context.addMedia("pending_upload");
    const missingId = testUuid(9000, 994799);
    context.deadLetters.push(
      job(ready.id),
      job(finalRejection.id),
      job(legacyRejection.id),
      job(uploadGone.id),
      job(pending.id),
      job(missingId),
      null,
    );

    const result = await context.service.run({ dryRun: false });

    expect(result).toMatchObject({
      scanned: 7,
      skipped: 2,
      notReplayable: 4,
      invalid: 1,
      replayed: 0,
      requeued: 0,
      failed: 0,
    });
    expect(result.items).toEqual([
      expect.objectContaining({ outcome: "skipped", reason: "ready" }),
      expect.objectContaining({
        outcome: "not_replayable",
        reason: "final_rejection",
      }),
      expect.objectContaining({
        outcome: "not_replayable",
        reason: "final_rejection",
      }),
      expect.objectContaining({
        outcome: "not_replayable",
        reason: "upload_deleted",
      }),
      expect.objectContaining({
        outcome: "not_replayable",
        reason: "not_uploaded",
      }),
      expect.objectContaining({
        mediaId: missingId,
        outcome: "skipped",
        reason: "missing",
      }),
      { mediaId: null, jobId: null, outcome: "invalid" },
    ]);
    expect(context.republish).not.toHaveBeenCalled();
    expect(context.deadLetters.queued).toEqual([]);
    expect((await context.repository.findById(uploadGone.id))?.status).toBe(
      "rejected",
    );
  });

  it("replays an item once when it was dead-lettered more than once", async () => {
    const context = createContext();
    const failed = context.processingFailed();
    context.deadLetters.push(job(failed.id, "first"), job(failed.id, "second"));

    const result = await context.service.run({ dryRun: false });

    expect(result).toMatchObject({ replayed: 1, duplicate: 1 });
    expect(result.items[1]).toEqual({
      mediaId: failed.id,
      jobId: "second",
      outcome: "duplicate",
    });
    expect(context.republish).toHaveBeenCalledTimes(1);
    expect(context.deadLetters.queued).toEqual([]);
  });

  it("skips an item that changed after it was read", async () => {
    const context = createContext();
    const failed = context.processingFailed();
    context.deadLetters.push(job(failed.id));
    // As if its owner deleted it between the read and the reopen.
    jest
      .spyOn(context.repository, "reopenForReplay")
      .mockResolvedValueOnce(false);

    const result = await context.service.run({ dryRun: false });

    expect(result.items).toEqual([
      expect.objectContaining({ outcome: "skipped", reason: "changed" }),
    ]);
    expect(context.republish).not.toHaveBeenCalled();
    expect(context.deadLetters.queued).toEqual([]);
  });

  it("reports what it would do in a dry run and leaves every message queued", async () => {
    const context = createContext();
    const failed = context.processingFailed();
    const uploaded = context.addMedia("uploaded");
    const ready = context.addMedia("ready");
    context.deadLetters.push(
      job(failed.id),
      job(uploaded.id),
      job(ready.id),
      job(failed.id, "again"),
      null,
    );

    const result = await context.service.run({ dryRun: true });

    expect(result).toMatchObject({
      mode: "dry-run",
      scanned: 5,
      replayed: 1,
      requeued: 1,
      skipped: 1,
      duplicate: 1,
      invalid: 1,
    });
    expect(context.republish).not.toHaveBeenCalled();
    expect((await context.repository.findById(failed.id))?.status).toBe(
      "rejected",
    );
    expect(context.deadLetters.queued).toHaveLength(5);
  });

  it("leaves a message whose handling fails in the queue for another run", async () => {
    const context = createContext();
    const storageDown = context.processingFailed();
    const brokerDown = context.addMedia("uploaded");
    const fine = context.processingFailed();
    context.deadLetters.push(
      job(storageDown.id),
      job(brokerDown.id),
      job(fine.id),
    );
    context.blobService.getProperties.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    context.republish.mockRejectedValueOnce(new Error("broker unavailable"));

    const result = await context.service.run({ dryRun: false });

    expect(result).toMatchObject({ failed: 2, replayed: 1 });
    expect(result.items.slice(0, 2)).toEqual([
      expect.objectContaining({
        mediaId: storageDown.id,
        outcome: "failed",
        reason: "storage unavailable",
      }),
      expect.objectContaining({
        mediaId: brokerDown.id,
        outcome: "failed",
        reason: "broker unavailable",
      }),
    ]);
    expect(
      context.deadLetters.queued.map((payload) => payload?.mediaId),
    ).toEqual([storageDown.id, brokerDown.id]);
    expect(mediaDeadLetterReplayExitCode(result)).toBe(1);
  });

  it("takes at most `limit` messages", async () => {
    const context = createContext();
    const items = [
      context.processingFailed(),
      context.processingFailed(),
      context.processingFailed(),
    ];
    context.deadLetters.push(...items.map((item) => job(item.id)));

    const result = await context.service.run({ dryRun: false, limit: 2 });

    expect(result).toMatchObject({ scanned: 2, replayed: 2 });
    expect(context.deadLetters.queued).toEqual([job(items[2]!.id)]);
    expect(mediaDeadLetterReplayExitCode(result)).toBe(0);
  });

  it("reports what it settled, and why it stopped, when the channel fails mid-run", async () => {
    const context = createContext();
    const failed = context.processingFailed();
    context.deadLetters.push(job(failed.id), job(context.addMedia("ready").id));
    const reader = context.deadLetters.open(context.republish);
    const take = reader.take;
    let taken = 0;
    const close = jest.fn(reader.close);
    context.queue.openDeadLetterQueue.mockResolvedValueOnce({
      ...reader,
      take: async () => {
        taken += 1;
        if (taken > 1) {
          throw new Error("Channel closed");
        }
        return take();
      },
      close,
    });

    const result = await context.service.run({ dryRun: false });

    expect(result).toMatchObject({
      scanned: 1,
      replayed: 1,
      error: "Channel closed",
      items: [expect.objectContaining({ mediaId: failed.id })],
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(mediaDeadLetterReplayExitCode(result)).toBe(1);
  });

  it("leaves a job dead-lettered again during the run for the next run", async () => {
    const context = createContext();
    const failed = context.processingFailed();
    context.deadLetters.push(job(failed.id, "before"));
    // The replayed job fails at once and is dead-lettered again mid-run.
    context.republish.mockImplementationOnce(async (mediaId: string) => {
      context.deadLetters.push(job(mediaId, "again"));
    });

    const result = await context.service.run({ dryRun: false });

    // Taken for a duplicate and acknowledged, it would leave the item with
    // no message to replay it from.
    expect(result).toMatchObject({ scanned: 1, replayed: 1, duplicate: 0 });
    expect(context.deadLetters.queued).toEqual([job(failed.id, "again")]);
  });

  it("does not reopen a rejection past its retention, which the cleanup may be purging", async () => {
    const context = createContext();
    const expired = context.addMedia("rejected", {
      rejectionCode: "processing_failed",
      updatedAt: new Date(Date.now() - RETENTION_MS - HOUR_MS),
    });
    context.deadLetters.push(job(expired.id));

    const result = await context.service.run({ dryRun: false });

    expect(result.items).toEqual([
      expect.objectContaining({ outcome: "not_replayable", reason: "expired" }),
    ]);
    expect((await context.repository.findById(expired.id))?.status).toBe(
      "rejected",
    );
    expect(context.republish).not.toHaveBeenCalled();
  });

  it("gives a reopened item a fresh re-queue budget for the media cleanup", async () => {
    const context = createContext();
    const failed = context.addMedia("rejected", {
      rejectionCode: "processing_failed",
      processingRequeues: 3,
    });
    context.deadLetters.push(job(failed.id));

    await context.service.run({ dryRun: false });

    await expect(context.repository.findById(failed.id)).resolves.toMatchObject(
      { status: "uploaded", processingRequeues: 0 },
    );
  });

  describe("from the database", () => {
    it("replays every processing failure still kept, with or without a dead letter", async () => {
      const context = createContext();
      // Rejected by the media cleanup after its jobs were lost: never
      // dead-lettered.
      const stuck = context.processingFailed();
      const gone = context.processingFailed({ uploadKept: false });
      const expired = context.addMedia("rejected", {
        rejectionCode: "processing_failed",
        updatedAt: new Date(Date.now() - RETENTION_MS - HOUR_MS),
      });
      context.addMedia("rejected", { rejectionCode: "corrupt" });
      context.addMedia("uploaded");

      const result = await context.service.run({
        dryRun: false,
        source: "database",
      });

      expect(result).toMatchObject({
        source: "database",
        scanned: 2,
        replayed: 1,
        notReplayable: 1,
        failed: 0,
        error: null,
      });
      expect(result.items).toEqual(
        expect.arrayContaining([
          { mediaId: stuck.id, jobId: null, outcome: "replayed" },
          {
            mediaId: gone.id,
            jobId: null,
            outcome: "not_replayable",
            reason: "upload_deleted",
          },
        ]),
      );
      expect(context.republish.mock.calls).toEqual([[stuck.id]]);
      await expect(
        context.repository.findById(stuck.id),
      ).resolves.toMatchObject({ status: "uploaded", rejectionCode: null });
      expect((await context.repository.findById(expired.id))?.status).toBe(
        "rejected",
      );
    });

    it("pages through the rejections, up to the limit, and only reports in a dry run", async () => {
      const context = createContext();
      const items = Array.from({ length: 3 }, () => context.processingFailed());

      const preview = await context.service.run({
        dryRun: true,
        source: "database",
        limit: 2,
      });

      expect(preview).toMatchObject({ scanned: 2, replayed: 2 });
      expect(context.republish).not.toHaveBeenCalled();
      for (const item of items) {
        expect((await context.repository.findById(item.id))?.status).toBe(
          "rejected",
        );
      }
    });

    it("reports an item another actor took first, and one it failed on", async () => {
      const context = createContext();
      const taken = context.processingFailed();
      const failing = context.processingFailed();
      jest
        .spyOn(context.repository, "reopenForReplay")
        .mockResolvedValueOnce(false);
      context.republish.mockRejectedValueOnce(new Error("broker unavailable"));

      const result = await context.service.run({
        dryRun: false,
        source: "database",
      });

      expect(result.items).toEqual([
        expect.objectContaining({
          mediaId: taken.id,
          outcome: "skipped",
          reason: "changed",
        }),
        expect.objectContaining({
          mediaId: failing.id,
          outcome: "failed",
          reason: "broker unavailable",
        }),
      ]);
    });
  });
});
