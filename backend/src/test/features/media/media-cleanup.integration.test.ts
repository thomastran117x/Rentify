import { randomUUID } from "node:crypto";
import { containerTokens } from "@/configuration/bootstrap/container";
import { asUuid } from "@/configuration/validation/uuid";
import type {
  MediaProcessingJobPayload,
  MediaStatus,
} from "@/features/media/media.model";
import type { MediaCleanupOptions } from "@/features/media/media-cleanup.service";
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
  maxProcessingAgeMs: 24 * HOUR_MS,
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
        ...times,
      },
    });

    return { id, originalBlobName };
  }

  function findMedia(id: string) {
    return persistenceApp.prisma.media.findUnique({ where: { id } });
  }

  function sweep() {
    return persistenceApp.container
      .resolve(containerTokens.mediaCleanupService)
      .sweep(OPTIONS);
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
    const poison = await seedMedia("uploaded", {
      createdAt: twoDaysAgo,
      updatedAt: anHourAgo,
    });
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
      requeued: 1,
      rejected: 1,
      rejectedPurged: 1,
      failed: 0,
    });

    await expect(findMedia(abandoned.id)).resolves.toBeNull();
    expect(storage.has(abandoned.originalBlobName)).toBe(false);

    const requeued = await findMedia(stuck.id);
    expect(requeued?.status).toBe("processing");
    expect(requeued!.updatedAt.getTime()).toBeGreaterThan(anHourAgo.getTime());
    await waitForRabbitMqPayload<MediaProcessingJobPayload>(
      persistenceApp.infra.rabbitMq,
      MEDIA_PROCESSING_QUEUE_NAME,
      (payload) => payload.mediaId === stuck.id,
    );

    await expect(findMedia(poison.id)).resolves.toMatchObject({
      status: "rejected",
      rejectionReason: "The image could not be processed.",
    });
    expect(storage.has(poison.originalBlobName)).toBe(false);

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
      failed: 0,
    });
  });

  it("keeps an abandoned upload's row once it has been completed", async () => {
    const twoDaysAgo = ago(48 * HOUR_MS);
    const completed = await seedMedia("uploaded", {
      createdAt: twoDaysAgo,
      updatedAt: new Date(),
    });
    const repository = persistenceApp.container.resolve(
      containerTokens.mediaRepository,
    );

    // As if the sweep read it while still pending, then lost the race.
    await expect(
      repository.deleteByIdIfStatus(asUuid(completed.id), "pending_upload"),
    ).resolves.toBe(false);
    await expect(findMedia(completed.id)).resolves.toMatchObject({
      status: "uploaded",
    });
  });
});
