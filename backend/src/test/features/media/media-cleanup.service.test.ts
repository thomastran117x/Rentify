import type { MediaRecord, MediaStatus } from "@/features/media/media.model";
import type { MediaProcessingBacklog } from "@/features/media/media-processing.queue.service";
import {
  MediaCleanupService,
  type MediaCleanupOptions,
} from "@/features/media/media-cleanup.service";
import { NoopMediaMetrics } from "@/features/media/media-metrics";
import { RecordingMediaMetrics } from "../../support/recording-media-metrics";
import { testUuid } from "../../support/uuid";

const USER_1_ID = testUuid(9000, 994500);
const NOW = new Date("2026-09-28T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const STUCK_THRESHOLD_MS = 15 * 60 * 1000;
const OPTIONS: MediaCleanupOptions = {
  batchSize: 25,
  pendingUploadTtlMs: 24 * HOUR_MS,
  stuckThresholdMs: STUCK_THRESHOLD_MS,
  maxRequeues: 3,
  rejectedRetentionMs: 48 * HOUR_MS,
  unattachedReadyTtlMs: 12 * HOUR_MS,
};
const IDLE: MediaProcessingBacklog = { waitingJobs: 0, consumers: 1 };
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
    rejectionCode: null,
    processingRequeues: 0,
    processingAttempts: 0,
    processingStartedAt: null,
    processingCompletedAt: null,
    processingError: null,
    scanStatus: "not_scanned",
    scanEngine: null,
    scannedAt: null,
    threatName: null,
    moderationResult: null,
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
    unattached?: MediaRecord[];
    attached?: string[];
    auditHeld?: string[];
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
    rejectAbandonedUpload: jest.fn(
      async (_id: string, _createdBefore: Date, _reason: string, _at: Date) =>
        true,
    ),
    claimStuckForRequeue: jest.fn(
      async (_id: string, _updatedBefore: Date, _at: Date) => true,
    ),
    rejectStuck: jest.fn(
      async (_id: string, _updatedBefore: Date, _reason: string, _at: Date) =>
        true,
    ),
    deferRejectedPurge: jest.fn(
      async (_id: string, _updatedBefore: Date, _at: Date) => true,
    ),
    deleteByIdIfStatus: jest.fn(
      async (_id: string, _status: MediaStatus) => true,
    ),
    listReadyPastTtl: jest.fn(
      async (_updatedBefore: Date, _limit: number) =>
        candidates.unattached ?? [],
    ),
    listAttachedBlobNames: jest.fn(
      async (_blobNames: string[]) => new Set(candidates.attached ?? []),
    ),
    listAuditHeldBlobNames: jest.fn(
      async (_blobNames: string[]) => new Set(candidates.auditHeld ?? []),
    ),
    deferUnattached: jest.fn(
      async (ids: string[], _updatedBefore: Date, _at: Date) => ids.length,
    ),
    claimUnattached: jest.fn(
      async (_id: string, _updatedBefore: Date, _reason: string, _at: Date) =>
        true,
    ),
  };
  const blobService = {
    deleteBlob: jest.fn(async (_blobName: string) => undefined),
  };
  const queue = {
    enqueueMediaProcessingJob: jest.fn(async (_mediaId: string) => undefined),
    readBacklog: jest.fn(async (): Promise<MediaProcessingBacklog> => IDLE),
  };
  const metrics = new RecordingMediaMetrics();
  const service = new MediaCleanupService(
    mediaRepository as never,
    blobService,
    queue as never,
    metrics,
    () => NOW,
  );

  return { mediaRepository, blobService, queue, metrics, service };
}

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("MediaCleanupService", () => {
  it("queries each step with its own cutoff and the batch size", async () => {
    const { mediaRepository, queue, service } = createContext();

    await expect(service.sweep(OPTIONS)).resolves.toEqual({
      abandonedDeleted: 0,
      requeued: 0,
      rejected: 0,
      rejectedPurged: 0,
      unattachedDeleted: 0,
      attached: 0,
      held: 0,
      deferred: 0,
      failed: 0,
    });

    expect(mediaRepository.listAbandonedUploads).toHaveBeenCalledWith(
      ago(24 * HOUR_MS),
      25,
    );
    expect(mediaRepository.listStuck).toHaveBeenCalledWith(
      ago(STUCK_THRESHOLD_MS),
      25,
    );
    expect(mediaRepository.listRejected).toHaveBeenCalledWith(
      ago(48 * HOUR_MS),
      25,
    );
    expect(mediaRepository.listReadyPastTtl).toHaveBeenCalledWith(
      ago(12 * HOUR_MS),
      25,
    );
    // Nothing stuck, so there is no need to ask RabbitMQ.
    expect(queue.readBacklog).not.toHaveBeenCalled();
    // Nothing past its TTL, so there is no need to look for references.
    expect(mediaRepository.listAttachedBlobNames).not.toHaveBeenCalled();
    expect(mediaRepository.listAuditHeldBlobNames).not.toHaveBeenCalled();
  });

  it("claims an abandoned upload, then deletes its bytes, then its row", async () => {
    const abandoned = record("pending_upload");
    const { mediaRepository, blobService, metrics, service } = createContext({
      abandoned: [abandoned],
    });

    const summary = await service.sweep(OPTIONS);

    expect(summary.abandonedDeleted).toBe(1);
    expect(mediaRepository.rejectAbandonedUpload).toHaveBeenCalledWith(
      abandoned.id,
      ago(24 * HOUR_MS),
      "The upload was never completed.",
      "abandoned",
      NOW,
    );
    expect(blobService.deleteBlob).toHaveBeenCalledWith(
      abandoned.originalBlobName,
    );
    expect(mediaRepository.deleteByIdIfStatus).toHaveBeenCalledWith(
      abandoned.id,
      "rejected",
    );
    const [claimed] =
      mediaRepository.rejectAbandonedUpload.mock.invocationCallOrder;
    const [bytesDeleted] = blobService.deleteBlob.mock.invocationCallOrder;
    const [rowDeleted] =
      mediaRepository.deleteByIdIfStatus.mock.invocationCallOrder;
    expect(claimed).toBeLessThan(bytesDeleted!);
    expect(bytesDeleted).toBeLessThan(rowDeleted!);
    // Never completed, so it is not counted against completed uploads.
    expect(metrics.recorded).toEqual([]);
  });

  it("leaves an upload completed before the claim, bytes and all", async () => {
    const { mediaRepository, blobService, service } = createContext({
      abandoned: [record("pending_upload")],
    });
    mediaRepository.rejectAbandonedUpload.mockResolvedValueOnce(false);

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      abandonedDeleted: 0,
      failed: 0,
    });
    expect(blobService.deleteBlob).not.toHaveBeenCalled();
    expect(mediaRepository.deleteByIdIfStatus).not.toHaveBeenCalled();
  });

  it("claims and re-enqueues stuck items while processing is idle", async () => {
    const uploaded = record("uploaded");
    const processing = record("processing", { processingRequeues: 2 });
    const { mediaRepository, queue, service } = createContext({
      stuck: [uploaded, processing],
    });

    const summary = await service.sweep(OPTIONS);

    expect(summary).toMatchObject({ requeued: 2, rejected: 0, deferred: 0 });
    // The claim is stamped with the same clock as the cutoff.
    expect(mediaRepository.claimStuckForRequeue).toHaveBeenCalledWith(
      uploaded.id,
      ago(STUCK_THRESHOLD_MS),
      NOW,
    );
    expect(queue.enqueueMediaProcessingJob.mock.calls).toEqual([
      [uploaded.id],
      [processing.id],
    ]);
    expect(mediaRepository.rejectStuck).not.toHaveBeenCalled();
  });

  it.each([
    ["jobs are waiting in the queue", { waitingJobs: 40, consumers: 1 }],
    ["no worker is consuming", { waitingJobs: 0, consumers: 0 }],
  ])(
    "leaves stuck items alone while %s, since their job may be delayed",
    async (_label, backlog) => {
      const oldest = record("uploaded", { processingRequeues: 3 });
      const { mediaRepository, queue, service } = createContext({
        stuck: [record("uploaded"), oldest],
      });
      queue.readBacklog.mockResolvedValueOnce(backlog);

      await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
        requeued: 0,
        rejected: 0,
        deferred: 2,
        failed: 0,
      });
      expect(mediaRepository.claimStuckForRequeue).not.toHaveBeenCalled();
      expect(mediaRepository.rejectStuck).not.toHaveBeenCalled();
      expect(queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();
    },
  );

  it("treats a backlog it cannot read as busy", async () => {
    const { mediaRepository, queue, service } = createContext({
      stuck: [record("uploaded")],
    });
    queue.readBacklog.mockRejectedValueOnce(new Error("rabbitmq down"));

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      requeued: 0,
      deferred: 1,
      failed: 0,
    });
    expect(mediaRepository.claimStuckForRequeue).not.toHaveBeenCalled();
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

  it("rejects a stuck item once it has used its re-queues, and keeps its upload for a replay", async () => {
    const exhausted = record("processing", { processingRequeues: 3 });
    const { mediaRepository, blobService, queue, metrics, service } =
      createContext({
        stuck: [exhausted],
      });

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      requeued: 0,
      rejected: 1,
    });
    expect(mediaRepository.rejectStuck).toHaveBeenCalledWith(
      exhausted.id,
      ago(STUCK_THRESHOLD_MS),
      "The image could not be processed.",
      "processing_failed",
      NOW,
    );
    // Purged with the row once the rejected retention has passed.
    expect(blobService.deleteBlob).not.toHaveBeenCalled();
    expect(mediaRepository.claimStuckForRequeue).not.toHaveBeenCalled();
    expect(queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();
    expect(metrics.tagsOf("media.rejected")).toEqual([
      { code: "processing_failed", stage: "cleanup" },
    ]);
    metrics.assertNoIdentifiers();
  });

  it("does not reject an item for its age alone", async () => {
    const { mediaRepository, service } = createContext({
      stuck: [record("uploaded", { createdAt: ago(7 * 24 * HOUR_MS) })],
    });

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      requeued: 1,
      rejected: 0,
    });
    expect(mediaRepository.rejectStuck).not.toHaveBeenCalled();
  });

  it("rejects at once when no re-queues are allowed", async () => {
    const { mediaRepository, queue, service } = createContext({
      stuck: [record("uploaded")],
    });

    await expect(
      service.sweep({ ...OPTIONS, maxRequeues: 0 }),
    ).resolves.toMatchObject({ requeued: 0, rejected: 1 });
    expect(queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();
    expect(mediaRepository.rejectStuck).toHaveBeenCalledTimes(1);
  });

  it("leaves an exhausted item alone once a job has claimed it", async () => {
    const { mediaRepository, blobService, metrics, service } = createContext({
      stuck: [record("processing", { processingRequeues: 3 })],
    });
    // The job moved updatedAt, or another sweep rejected it first.
    mediaRepository.rejectStuck.mockResolvedValueOnce(false);

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      rejected: 0,
      failed: 0,
    });
    expect(blobService.deleteBlob).not.toHaveBeenCalled();
    expect(metrics.count("media.rejected")).toBe(0);
  });

  it("counts a rejection even when deleting its upload fails", async () => {
    const { blobService, service } = createContext({
      stuck: [record("processing", { processingRequeues: 3 })],
    });
    blobService.deleteBlob.mockRejectedValueOnce(new Error("storage down"));

    // The leftover upload goes with the row when old rejections are purged.
    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      rejected: 1,
      failed: 0,
    });
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
    expect(mediaRepository.deferRejectedPurge).not.toHaveBeenCalled();

    mediaRepository.deleteByIdIfStatus.mockResolvedValueOnce(false);
    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      rejectedPurged: 0,
    });
  });

  it("moves a rejection it cannot purge to the back, so newer ones still go", async () => {
    const stubborn = record("rejected");
    const newer = record("rejected");
    const { mediaRepository, blobService, service } = createContext({
      rejected: [stubborn, newer],
    });
    blobService.deleteBlob.mockRejectedValueOnce(new Error("forbidden"));

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      rejectedPurged: 1,
      failed: 1,
    });
    expect(mediaRepository.deferRejectedPurge).toHaveBeenCalledWith(
      stubborn.id,
      ago(48 * HOUR_MS),
      NOW,
    );
    expect(mediaRepository.deleteByIdIfStatus).not.toHaveBeenCalledWith(
      stubborn.id,
      "rejected",
    );
    expect(mediaRepository.deleteByIdIfStatus).toHaveBeenCalledWith(
      newer.id,
      "rejected",
    );
  });

  it("purges a tombstone's image with every rendition, then its row", async () => {
    const tombstone = record("rejected", {
      rejectionCode: "unattached",
      processedBlobName: `media/images/${USER_1_ID}/photo.webp`,
    });
    const { mediaRepository, blobService, service } = createContext({
      rejected: [tombstone],
    });

    await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
      rejectedPurged: 1,
    });
    expect(blobService.deleteBlob.mock.calls.map(([name]) => name)).toEqual([
      tombstone.originalBlobName,
      `media/images/${USER_1_ID}/photo.webp`,
      `media/images/${USER_1_ID}/photo.medium.webp`,
      `media/images/${USER_1_ID}/photo.thumbnail.webp`,
    ]);
    expect(mediaRepository.deleteByIdIfStatus).toHaveBeenCalledWith(
      tombstone.id,
      "rejected",
    );
  });

  describe("unattached ready items", () => {
    function readyRecord(overrides: Partial<MediaRecord> = {}): MediaRecord {
      const item = record("ready", overrides);

      return {
        ...item,
        processedBlobName: `media/images/${USER_1_ID}/${item.id}.webp`,
        ...overrides,
      };
    }

    it("claims the item, then deletes its image with every rendition, and keeps the row", async () => {
      const unattached = readyRecord();
      const { mediaRepository, blobService, metrics, service } = createContext({
        unattached: [unattached],
      });
      const base = `media/images/${USER_1_ID}/${unattached.id}`;

      await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
        unattachedDeleted: 1,
        held: 0,
        failed: 0,
      });
      expect(mediaRepository.listAttachedBlobNames).toHaveBeenCalledWith([
        `${base}.webp`,
      ]);
      expect(mediaRepository.listAuditHeldBlobNames).toHaveBeenCalledWith([
        `${base}.webp`,
      ]);
      expect(mediaRepository.claimUnattached).toHaveBeenCalledWith(
        unattached.id,
        ago(12 * HOUR_MS),
        "This image was not saved in time. Upload it again.",
        NOW,
      );
      expect(blobService.deleteBlob.mock.calls.map(([name]) => name)).toEqual([
        unattached.originalBlobName,
        `${base}.webp`,
        `${base}.medium.webp`,
        `${base}.thumbnail.webp`,
      ]);
      const [claimed] =
        mediaRepository.claimUnattached.mock.invocationCallOrder;
      const [firstDelete] = blobService.deleteBlob.mock.invocationCallOrder;
      expect(claimed).toBeLessThan(firstDelete!);
      // The row stays as the `unattached` rejection until the purge.
      expect(mediaRepository.deleteByIdIfStatus).not.toHaveBeenCalled();
      expect(metrics.recorded).toEqual([
        {
          kind: "increment",
          name: "media.cleanup.deleted",
          value: 1,
          tags: { reason: "unattached" },
        },
      ]);
    });

    it("keeps an item a restorable audit entry references, and moves it to the back", async () => {
      const held = readyRecord({ scope: "organizations" });
      const unattached = readyRecord();
      const { mediaRepository, blobService, service } = createContext({
        unattached: [held, unattached],
        auditHeld: [held.processedBlobName!],
      });

      await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
        unattachedDeleted: 1,
        held: 1,
      });
      expect(mediaRepository.deferUnattached).toHaveBeenCalledWith(
        [held.id],
        ago(12 * HOUR_MS),
        NOW,
      );
      expect(mediaRepository.claimUnattached).not.toHaveBeenCalledWith(
        held.id,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(blobService.deleteBlob).not.toHaveBeenCalledWith(
        held.processedBlobName,
      );
    });

    it("does not count a held item another sweep moved first", async () => {
      const held = readyRecord();
      const { mediaRepository, service } = createContext({
        unattached: [held],
        auditHeld: [held.processedBlobName!],
      });
      mediaRepository.deferUnattached
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
        held: 0,
      });
    });

    it("moves an attached item to the back without claiming it or reading the audit log for it", async () => {
      const attached = readyRecord();
      const unattached = readyRecord();
      const { mediaRepository, blobService, service } = createContext({
        unattached: [attached, unattached],
        attached: [attached.processedBlobName!],
      });

      await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
        unattachedDeleted: 1,
        attached: 1,
        held: 0,
      });
      expect(mediaRepository.listAuditHeldBlobNames).toHaveBeenCalledWith([
        unattached.processedBlobName,
      ]);
      expect(mediaRepository.deferUnattached).toHaveBeenCalledWith(
        [attached.id],
        ago(12 * HOUR_MS),
        NOW,
      );
      expect(mediaRepository.claimUnattached).toHaveBeenCalledTimes(1);
      expect(mediaRepository.claimUnattached).toHaveBeenCalledWith(
        unattached.id,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(blobService.deleteBlob).not.toHaveBeenCalledWith(
        attached.processedBlobName,
      );
    });

    it("leaves an item a save attached or moved before the claim", async () => {
      const { mediaRepository, blobService, metrics, service } = createContext({
        unattached: [readyRecord()],
      });
      mediaRepository.claimUnattached.mockResolvedValueOnce(false);

      await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
        unattachedDeleted: 0,
        failed: 0,
      });
      expect(blobService.deleteBlob).not.toHaveBeenCalled();
      expect(metrics.recorded).toEqual([]);
    });

    it("keeps the claimed row when deleting the image fails, for the purge to retry", async () => {
      const failing = readyRecord();
      const unattached = readyRecord();
      const { blobService, metrics, service } = createContext({
        unattached: [failing, unattached],
      });
      blobService.deleteBlob.mockRejectedValueOnce(new Error("storage down"));

      await expect(service.sweep(OPTIONS)).resolves.toMatchObject({
        unattachedDeleted: 1,
        failed: 1,
      });
      expect(metrics.recorded).toHaveLength(1);
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
      unattachedDeleted: 0,
      attached: 0,
      held: 0,
      deferred: 0,
      failed: 2,
    });
    // The failed upload's row stays behind, rejected, for the purge of old
    // rejections to try again.
    expect(mediaRepository.rejectAbandonedUpload).toHaveBeenCalledWith(
      failingUpload.id,
      expect.any(Date),
      expect.any(String),
      "abandoned",
      NOW,
    );
    expect(mediaRepository.deleteByIdIfStatus).not.toHaveBeenCalledWith(
      failingUpload.id,
      "rejected",
    );
    expect(queue.enqueueMediaProcessingJob).toHaveBeenLastCalledWith(stuck.id);
  });

  it("uses the current time when none is injected", async () => {
    const mediaRepository = {
      listAbandonedUploads: jest.fn(async () => []),
      listStuck: jest.fn(async () => []),
      listRejected: jest.fn(async () => []),
      listReadyPastTtl: jest.fn(async () => []),
    };
    const service = new MediaCleanupService(
      mediaRepository as never,
      { deleteBlob: jest.fn() },
      { enqueueMediaProcessingJob: jest.fn(), readBacklog: jest.fn() },
      new NoopMediaMetrics(),
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
