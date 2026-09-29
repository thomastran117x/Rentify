import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  MediaProcessingJobPayload,
  MediaRecord,
  MediaStatus,
} from "@/features/media/media.model";
import type { MediaDeadLetterMessage } from "@/features/media/media-processing.queue.service";
import {
  mediaDeadLetterReplayExitCode,
  MediaDeadLetterReplayService,
} from "@/features/media/media-dead-letter-replay.service";
import { InMemoryMediaRepository } from "../../support/in-memory-media-repository";
import { testUuid } from "../../support/uuid";

const USER_ID = testUuid(9000, 994700);
let nextMediaIndex = 994701;

/**
 * A dead-letter queue as the reader sees it: `take` hands out each message
 * once, and closing puts back every message not acknowledged.
 */
class FakeDeadLetterQueue {
  readonly queued: (MediaProcessingJobPayload | null)[] = [];
  closed = 0;

  push(...payloads: (MediaProcessingJobPayload | null)[]): void {
    this.queued.push(...payloads);
  }

  open() {
    const taken: (MediaProcessingJobPayload | null)[] = [];
    const acked = new Set<number>();

    return {
      take: async (): Promise<MediaDeadLetterMessage | null> => {
        if (this.queued.length === 0) {
          return null;
        }

        const payload = this.queued.shift()!;
        const index = taken.push(payload) - 1;

        return { payload, ack: () => acked.add(index) };
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
  const queue = {
    openDeadLetterQueue: jest.fn(async () => deadLetters.open()),
    enqueueMediaProcessingJob: jest.fn(async (_mediaId: string) => undefined),
  };
  const service = new MediaDeadLetterReplayService(
    repository,
    blobService as never,
    queue,
  );

  function addMedia(
    status: MediaStatus,
    overrides: Partial<MediaRecord> = {},
    options: { uploadKept?: boolean } = {},
  ): MediaRecord {
    const id = testUuid(9000, nextMediaIndex++);
    const now = new Date();
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
    expect(context.queue.enqueueMediaProcessingJob).toHaveBeenCalledWith(
      failed.id,
    );
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
    expect(context.queue.enqueueMediaProcessingJob.mock.calls).toEqual([
      [uploaded.id],
      [processing.id],
    ]);
    expect((await context.repository.findById(processing.id))?.status).toBe(
      "processing",
    );
    expect(context.deadLetters.queued).toEqual([]);
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
    expect(context.queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();
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
    expect(context.queue.enqueueMediaProcessingJob).toHaveBeenCalledTimes(1);
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
    expect(context.queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();
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
    expect(context.queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();
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
    context.queue.enqueueMediaProcessingJob.mockRejectedValueOnce(
      new Error("broker unavailable"),
    );

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

  it("closes the queue even when reading it fails", async () => {
    const context = createContext();
    const close = jest.fn(async () => undefined);
    context.queue.openDeadLetterQueue.mockResolvedValueOnce({
      take: async () => {
        throw new Error("channel closed");
      },
      close,
    });

    await expect(context.service.run({ dryRun: false })).rejects.toThrow(
      "channel closed",
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
