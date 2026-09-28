import type { MediaRecord, MediaStatus } from "@/features/media/media.model";
import {
  MediaCleanupService,
  type MediaCleanupOptions,
} from "@/features/media/media-cleanup.service";
import { testUuid } from "../../support/uuid";

const USER_1_ID = testUuid(9000, 994500);
const NOW = new Date("2026-09-28T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const OPTIONS: MediaCleanupOptions = {
  batchSize: 25,
  pendingUploadTtlMs: 24 * HOUR_MS,
  stuckThresholdMs: 15 * 60 * 1000,
  maxProcessingAgeMs: 24 * HOUR_MS,
  rejectedRetentionMs: 48 * HOUR_MS,
};
let nextMediaIndex = 994510;

function record(
  status: MediaStatus,
  overrides: Partial<MediaRecord> = {},
): MediaRecord {
  const id = testUuid(9000, nextMediaIndex++);

  return {
    id,
    userId: USER_1_ID,
    status,
    scope: "postings",
    originalBlobName: `quarantine/images/${USER_1_ID}/${id}`,
    processedBlobName: null,
    declaredContentType: "image/png",
    detectedContentType: null,
    originalFilename: "photo.png",
    originalEtag: null,
    sizeBytes: null,
    width: null,
    height: null,
    variants: null,
    rejectionReason: null,
    createdAt: new Date(NOW.getTime() - HOUR_MS),
    updatedAt: new Date(NOW.getTime() - HOUR_MS),
    ...overrides,
  };
}

function createContext(
  candidates: {
    abandoned?: MediaRecord[];
    stuck?: MediaRecord[];
    rejected?: MediaRecord[];
  } = {},
) {
  const mediaRepository = {
    listAbandonedUploads: jest.fn(
      async (_createdBefore: Date, _limit: number) =>
        candidates.abandoned ?? [],
    ),
    listStuck: jest.fn(
      async (_updatedBefore: Date, _limit: number) => candidates.stuck ?? [],
    ),
    listRejected: jest.fn(
      async (_updatedBefore: Date, _limit: number) => candidates.rejected ?? [],
    ),
    claimStuckForRequeue: jest.fn(
      async (_id: string, _updatedBefore: Date) => true,
    ),
    deleteByIdIfStatus: jest.fn(
      async (_id: string, _status: MediaStatus) => true,
    ),
    markRejected: jest.fn(async (_id: string, _reason: string) => true),
  };
  const blobService = {
    deleteBlob: jest.fn(async (_blobName: string) => undefined),
  };
  const queue = {
    enqueueMediaProcessingJob: jest.fn(async (_mediaId: string) => undefined),
  };
  const service = new MediaCleanupService(
    mediaRepository as never,
    blobService,
    queue as never,
    () => NOW,
  );

  return { mediaRepository, blobService, queue, service };
}

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("MediaCleanupService", () => {
  it("queries each step with its own cutoff and the batch size", async () => {
    const { mediaRepository, service } = createContext();

    await expect(service.sweep(OPTIONS)).resolves.toEqual({
      abandonedDeleted: 0,
      requeued: 0,
      rejected: 0,
      rejectedPurged: 0,
      failed: 0,
    });

    expect(mediaRepository.listAbandonedUploads).toHaveBeenCalledWith(
      ago(24 * HOUR_MS),
      25,
    );
    expect(mediaRepository.listStuck).toHaveBeenCalledWith(
      ago(15 * 60 * 1000),
      25,
    );
    expect(mediaRepository.listRejected).toHaveBeenCalledWith(
      ago(48 * HOUR_MS),
      25,
    );
  });

  it("deletes an abandoned upload's bytes, then its row while still pending", async () => {
    const abandoned = record("pending_upload");
    const { mediaRepository, blobService, service } = createContext({
      abandoned: [abandoned],
    });

    const summary = await service.sweep(OPTIONS);

    expect(summary.abandonedDeleted).toBe(1);
    expect(blobService.deleteBlob).toHaveBeenCalledWith(
      abandoned.originalBlobName,
    );
    expect(mediaRepository.deleteByIdIfStatus).toHaveBeenCalledWith(
      abandoned.id,
      "pending_upload",
    );
    expect(blobService.deleteBlob.mock.invocationCallOrder[0]).toBeLessThan(
      mediaRepository.deleteByIdIfStatus.mock.invocationCallOrder[0],
    );
  });

  it("keeps an abandoned upload's row when it was completed during the sweep", async () => {
    const { mediaRepository, service } = createContext({
      abandoned: [record("pending_upload")],
    });
    mediaRepository.deleteByIdIfStatus.mockResolvedValueOnce(false);

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      abandonedDeleted: 0,
      failed: 0,
    });
  });

  it("claims and re-enqueues a stuck item that is young enough to retry", async () => {
    const uploaded = record("uploaded", { createdAt: ago(2 * HOUR_MS) });
    const processing = record("processing", { createdAt: ago(3 * HOUR_MS) });
    const { mediaRepository, queue, service } = createContext({
      stuck: [uploaded, processing],
    });

    const summary = await service.sweep(OPTIONS);

    expect(summary).toMatchObject({ requeued: 2, rejected: 0 });
    expect(mediaRepository.claimStuckForRequeue).toHaveBeenCalledWith(
      uploaded.id,
      ago(15 * 60 * 1000),
    );
    expect(queue.enqueueMediaProcessingJob.mock.calls).toEqual([
      [uploaded.id],
      [processing.id],
    ]);
    expect(mediaRepository.markRejected).not.toHaveBeenCalled();
  });

  it("does not enqueue a stuck item another sweep claimed first", async () => {
    const { mediaRepository, queue, service } = createContext({
      stuck: [record("processing")],
    });
    mediaRepository.claimStuckForRequeue.mockResolvedValueOnce(false);

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      requeued: 0,
      failed: 0,
    });
    expect(queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();
  });

  it("rejects a stuck item unfinished past the processing age and deletes its upload", async () => {
    const poison = record("processing", {
      createdAt: ago(24 * HOUR_MS + 1),
    });
    const { mediaRepository, blobService, queue, service } = createContext({
      stuck: [poison],
    });

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      requeued: 0,
      rejected: 1,
    });
    expect(mediaRepository.markRejected).toHaveBeenCalledWith(
      poison.id,
      "The image could not be processed.",
    );
    expect(blobService.deleteBlob).toHaveBeenCalledWith(
      poison.originalBlobName,
    );
    expect(mediaRepository.claimStuckForRequeue).not.toHaveBeenCalled();
    expect(queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();
  });

  it("still retries an item created exactly at the processing age", async () => {
    const { mediaRepository, service } = createContext({
      stuck: [record("uploaded", { createdAt: ago(24 * HOUR_MS) })],
    });

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      requeued: 1,
      rejected: 0,
    });
    expect(mediaRepository.markRejected).not.toHaveBeenCalled();
  });

  it("does not count a rejection another actor already recorded", async () => {
    const { mediaRepository, blobService, service } = createContext({
      stuck: [record("processing", { createdAt: ago(48 * HOUR_MS) })],
    });
    mediaRepository.markRejected.mockResolvedValueOnce(false);

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      rejected: 0,
      failed: 0,
    });
    expect(blobService.deleteBlob).not.toHaveBeenCalled();
  });

  it("purges an old rejection's leftover upload and then its row", async () => {
    const rejected = record("rejected");
    const { mediaRepository, blobService, service } = createContext({
      rejected: [rejected],
    });

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      rejectedPurged: 1,
    });
    expect(blobService.deleteBlob).toHaveBeenCalledWith(
      rejected.originalBlobName,
    );
    expect(mediaRepository.deleteByIdIfStatus).toHaveBeenCalledWith(
      rejected.id,
      "rejected",
    );

    mediaRepository.deleteByIdIfStatus.mockResolvedValueOnce(false);
    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      rejectedPurged: 0,
    });
  });

  it("keeps going after an item fails, and does not count it as work done", async () => {
    const failingUpload = record("pending_upload");
    const abandoned = record("pending_upload");
    const failingStuck = record("uploaded");
    const stuck = record("uploaded");
    const { mediaRepository, blobService, queue, service } = createContext({
      abandoned: [failingUpload, abandoned],
      stuck: [failingStuck, stuck],
      rejected: [record("rejected")],
    });
    blobService.deleteBlob.mockRejectedValueOnce(new Error("storage down"));
    queue.enqueueMediaProcessingJob.mockRejectedValueOnce(
      new Error("rabbitmq down"),
    );

    await expect(service.sweep(OPTIONS)).resolves.toEqual({
      abandonedDeleted: 1,
      requeued: 1,
      rejected: 0,
      rejectedPurged: 1,
      failed: 2,
    });
    // The failed upload's row stays behind so a later sweep tries again.
    expect(mediaRepository.deleteByIdIfStatus).not.toHaveBeenCalledWith(
      failingUpload.id,
      "pending_upload",
    );
    expect(queue.enqueueMediaProcessingJob).toHaveBeenLastCalledWith(stuck.id);
  });

  it("uses the current time when none is injected", async () => {
    const mediaRepository = {
      listAbandonedUploads: jest.fn(async () => []),
      listStuck: jest.fn(async () => []),
      listRejected: jest.fn(async () => []),
    };
    const service = new MediaCleanupService(
      mediaRepository as never,
      { deleteBlob: jest.fn() },
      { enqueueMediaProcessingJob: jest.fn() },
    );
    const before = Date.now();

    await service.sweep(OPTIONS);

    const [[cutoff]] = mediaRepository.listStuck.mock.calls as unknown as [
      [Date],
    ];
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(
      before - OPTIONS.stuckThresholdMs,
    );
    expect(cutoff.getTime()).toBeLessThanOrEqual(
      Date.now() - OPTIONS.stuckThresholdMs,
    );
  });
});
