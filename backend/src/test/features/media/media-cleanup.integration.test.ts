import { randomUUID } from "node:crypto";
import { containerTokens } from "@/configuration/bootstrap/container";
import { asUuid } from "@/configuration/validation/uuid";
import type {
  MediaProcessingJobPayload,
  MediaStatus,
} from "@/features/media/media.model";
import {
  MediaCleanupService,
  type MediaCleanupOptions,
} from "@/features/media/media-cleanup.service";
import { waitForRabbitMqPayload } from "../../support/live-rabbitmq-assertions";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  createReadyMedia,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const MEDIA_PROCESSING_QUEUE_NAME = "media.processing.main";
const HOUR_MS = 60 * 60 * 1000;
const OPTIONS: MediaCleanupOptions = {
  batchSize: 100,
  pendingUploadTtlMs: 24 * HOUR_MS,
  stuckThresholdMs: 15 * 60 * 1000,
  maxRequeues: 3,
  rejectedRetentionMs: 24 * HOUR_MS,
};

/**
 * Runs the media cleanup sweep against MySQL and RabbitMQ, with blob storage
 * held in memory by the harness.
 */
describe("Media cleanup persistence integration", () => {
  let persistenceApp: PersistenceTestApp;
  let ownerId: string;

  function ago(ms: number): Date {
    return new Date(Date.now() - ms);
  }

  async function seedMedia(
    status: MediaStatus,
    times: { createdAt: Date; updatedAt: Date },
    processingRequeues = 0,
  ): Promise<{ id: string; originalBlobName: string }> {
    const id = randomUUID();
    const originalBlobName = `quarantine/images/${ownerId}/${id}`;

    persistenceApp.stubs.blobService.storage.set(originalBlobName, {
      contentType: "image/png",
      body: Buffer.from("upload"),
    });
    await persistenceApp.prisma.media.create({
      data: {
        id,
        userId: ownerId,
        status,
        scope: "postings",
        originalBlobName,
        declaredContentType: "image/png",
        processingRequeues,
        ...times,
      },
    });

    return { id, originalBlobName };
  }

  function findMedia(id: string) {
    return persistenceApp.prisma.media.findUnique({ where: { id } });
  }

  /**
   * The harness runs no processing worker, so by default the sweep is told the
   * queue is idle and consumed; `readBacklog` itself is checked against
   * RabbitMQ below.
   */
  function sweep(options: { realBacklog?: boolean } = {}) {
    const container = persistenceApp.container;
    const queue = container.resolve(
      containerTokens.mediaProcessingQueueService,
    );

    return new MediaCleanupService(
      container.resolve(containerTokens.mediaRepository),
      container.resolve(containerTokens.blobService),
      {
        enqueueMediaProcessingJob: (mediaId) =>
          queue.enqueueMediaProcessingJob(mediaId),
        readBacklog: options.realBacklog
          ? () => queue.readBacklog()
          : async () => ({ waitingJobs: 0, consumers: 1 }),
      },
      container.resolve(containerTokens.mediaMetrics),
    ).sweep(OPTIONS);
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    ownerId = owner.userId;
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("finishes off unfinished and old rejected media, and leaves the rest alone", async () => {
    const storage = persistenceApp.stubs.blobService.storage;
    const twoDaysAgo = ago(48 * HOUR_MS);
    const anHourAgo = ago(HOUR_MS);
    const now = new Date();

    const abandoned = await seedMedia("pending_upload", {
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    });
    const freshPending = await seedMedia("pending_upload", {
      createdAt: now,
      updatedAt: now,
    });
    const stuck = await seedMedia("processing", {
      createdAt: anHourAgo,
      updatedAt: anHourAgo,
    });
    const active = await seedMedia("processing", {
      createdAt: anHourAgo,
      updatedAt: now,
    });
    // Old, but never queued again: its age alone does not reject it.
    const oldStuck = await seedMedia("uploaded", {
      createdAt: twoDaysAgo,
      updatedAt: anHourAgo,
    });
    const exhausted = await seedMedia(
      "uploaded",
      { createdAt: anHourAgo, updatedAt: anHourAgo },
      3,
    );
    const oldRejected = await seedMedia("rejected", {
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    });
    const freshRejected = await seedMedia("rejected", {
      createdAt: anHourAgo,
      updatedAt: anHourAgo,
    });
    const ready = await createReadyMedia(ownerId);
    await persistenceApp.prisma.$executeRaw`
      UPDATE media
      SET created_at = ${twoDaysAgo}, updated_at = ${twoDaysAgo}
      WHERE id = ${ready.mediaId}`;

    await expect(sweep()).resolves.toEqual({
      abandonedDeleted: 1,
      requeued: 2,
      rejected: 1,
      rejectedPurged: 1,
      deferred: 0,
      failed: 0,
    });

    await expect(findMedia(abandoned.id)).resolves.toBeNull();
    expect(storage.has(abandoned.originalBlobName)).toBe(false);

    for (const item of [stuck, oldStuck]) {
      const requeued = await findMedia(item.id);
      expect(requeued?.processingRequeues).toBe(1);
      expect(requeued!.updatedAt.getTime()).toBeGreaterThan(
        anHourAgo.getTime(),
      );
      await waitForRabbitMqPayload<MediaProcessingJobPayload>(
        persistenceApp.infra.rabbitMq,
        MEDIA_PROCESSING_QUEUE_NAME,
        (payload) => payload.mediaId === item.id,
      );
    }
    await expect(findMedia(stuck.id)).resolves.toMatchObject({
      status: "processing",
    });

    await expect(findMedia(exhausted.id)).resolves.toMatchObject({
      status: "rejected",
      rejectionReason: "The image could not be processed.",
      rejectionCode: "processing_failed",
    });
    // Kept for a replay until the rejected retention has passed.
    expect(storage.has(exhausted.originalBlobName)).toBe(true);

    await expect(findMedia(oldRejected.id)).resolves.toBeNull();
    expect(storage.has(oldRejected.originalBlobName)).toBe(false);

    for (const kept of [freshPending, active, freshRejected]) {
      await expect(findMedia(kept.id)).resolves.not.toBeNull();
      expect(storage.has(kept.originalBlobName)).toBe(true);
    }
    await expect(findMedia(ready.mediaId)).resolves.toMatchObject({
      status: "ready",
      processedBlobName: ready.blobName,
    });
    expect(storage.has(ready.blobName)).toBe(true);

    // Everything handled has moved out of reach of the next sweep, so a
    // worker draining a backlog stops once it is done.
    await expect(sweep()).resolves.toEqual({
      abandonedDeleted: 0,
      requeued: 0,
      rejected: 0,
      rejectedPurged: 0,
      deferred: 0,
      failed: 0,
    });
  });

  it("leaves stuck media alone while no worker consumes the processing queue", async () => {
    const anHourAgo = ago(HOUR_MS);
    const queue = persistenceApp.container.resolve(
      containerTokens.mediaProcessingQueueService,
    );
    const stuck = await seedMedia(
      "uploaded",
      { createdAt: anHourAgo, updatedAt: anHourAgo },
      3,
    );
    await queue.enqueueMediaProcessingJob(asUuid(stuck.id));

    // Read from RabbitMQ itself: the job waits, and the harness runs no
    // processing worker.
    await expect(queue.readBacklog()).resolves.toEqual({
      waitingJobs: 1,
      consumers: 0,
    });
    await expect(sweep({ realBacklog: true })).resolves.toMatchObject({
      requeued: 0,
      rejected: 0,
      deferred: 1,
    });
    await expect(findMedia(stuck.id)).resolves.toMatchObject({
      status: "uploaded",
      processingRequeues: 3,
    });
  });

  it("loses its claim to a completion or a job that moved the item first", async () => {
    const twoDaysAgo = ago(48 * HOUR_MS);
    const repository = persistenceApp.container.resolve(
      containerTokens.mediaRepository,
    );
    const pendingCutoff = ago(24 * HOUR_MS);
    const stuckCutoff = ago(15 * 60 * 1000);

    // As if the sweep read it while still pending, and the client completed
    // it before the claim.
    const completed = await seedMedia("uploaded", {
      createdAt: twoDaysAgo,
      updatedAt: new Date(),
    });
    await expect(
      repository.rejectAbandonedUpload(
        asUuid(completed.id),
        pendingCutoff,
        "abandoned",
        "abandoned",
        new Date(),
      ),
    ).resolves.toBe(false);
    await expect(findMedia(completed.id)).resolves.toMatchObject({
      status: "uploaded",
    });

    // As if the sweep read it as stuck, and a redelivered job claimed it
    // before the rejection.
    const reclaimed = await seedMedia("processing", {
      createdAt: twoDaysAgo,
      updatedAt: new Date(),
    });
    await expect(
      repository.rejectStuck(
        asUuid(reclaimed.id),
        stuckCutoff,
        "stuck",
        "processing_failed",
        new Date(),
      ),
    ).resolves.toBe(false);
    await expect(findMedia(reclaimed.id)).resolves.toMatchObject({
      status: "processing",
    });

    // Once the claim is held, completing the upload can no longer apply.
    const abandoned = await seedMedia("pending_upload", {
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    });
    await expect(
      repository.rejectAbandonedUpload(
        asUuid(abandoned.id),
        pendingCutoff,
        "abandoned",
        "abandoned",
        new Date(),
      ),
    ).resolves.toBe(true);
    await expect(
      repository.markUploaded(asUuid(abandoned.id), 6, '"etag"'),
    ).resolves.toBe(false);
  });
});
