import { randomUUID } from "node:crypto";
import { containerTokens } from "@/configuration/bootstrap/container";
import { asUuid } from "@/configuration/validation/uuid";
import type {
  MediaProcessingJobPayload,
  MediaRejectionCode,
  MediaStatus,
} from "@/features/media/media.model";
import { BlobCleanupRepository } from "@/features/blob/blob-cleanup.repository";
import { MediaDeadLetterReplayService } from "@/features/media/media-dead-letter-replay.service";
import { createPngFixture } from "../../support/image-fixtures";
import { waitForRabbitMqPayload } from "../../support/live-rabbitmq-assertions";
import { listRabbitMqQueues } from "../../support/live-rabbitmq";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const MAIN_QUEUE_NAME = "media.processing.main";
const DEAD_LETTER_QUEUE_NAME = "media.processing.dead-letter";
const RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Replays dead-lettered media processing jobs against MySQL and RabbitMQ, with
 * blob storage held in memory by the harness.
 */
describe("Media dead-letter replay persistence integration", () => {
  let persistenceApp: PersistenceTestApp;
  let ownerId: string;

  async function seedMedia(
    status: MediaStatus,
    rejectionCode: MediaRejectionCode | null = null,
    options: { uploadKept?: boolean } = {},
  ): Promise<{ id: string; originalBlobName: string }> {
    const id = randomUUID();
    const originalBlobName = `quarantine/images/${ownerId}/${id}`;

    if (options.uploadKept ?? true) {
      persistenceApp.stubs.blobService.storage.set(originalBlobName, {
        contentType: "image/png",
        body: Buffer.from("upload"),
      });
    }

    await persistenceApp.prisma.media.create({
      data: {
        id,
        userId: ownerId,
        status,
        scope: "postings",
        originalBlobName,
        declaredContentType: "image/png",
        rejectionReason: rejectionCode ? "Rejected." : null,
        rejectionCode,
        processingAttempts: 5,
        processingCompletedAt: rejectionCode ? new Date() : null,
        processingError: "Error: storage unavailable",
      },
    });

    return { id, originalBlobName };
  }

  function findMedia(id: string) {
    return persistenceApp.prisma.media.findUnique({ where: { id } });
  }

  function retentionStart(): Date {
    return new Date(Date.now() - RETENTION_MS);
  }

  function queue() {
    return persistenceApp.container.resolve(
      containerTokens.mediaProcessingQueueService,
    );
  }

  async function deadLetter(mediaId: string): Promise<void> {
    await queue().publishDeadLetterJob({
      jobId: randomUUID(),
      mediaId: asUuid(mediaId),
      attempt: 5,
      occurredAt: new Date().toISOString(),
    });
  }

  async function queueDepth(name: string): Promise<number> {
    const queues = await listRabbitMqQueues(persistenceApp.infra.rabbitMq);
    return queues.find((snapshot) => snapshot.name === name)?.messages ?? 0;
  }

  /** The management API's counts lag the broker by a moment. */
  async function waitForQueueDepth(name: string, expected: number) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 10_000) {
      if ((await queueDepth(name)) === expected) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(await queueDepth(name)).toBe(expected);
  }

  function replay(
    dryRun: boolean,
    limit?: number,
    source: "queue" | "database" = "queue",
  ) {
    const container = persistenceApp.container;

    return new MediaDeadLetterReplayService(
      container.resolve(containerTokens.mediaRepository),
      container.resolve(containerTokens.blobService),
      queue(),
      { rejectedRetentionMs: RETENTION_MS },
    ).run({ dryRun, limit, source });
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

  it("reopens only an item rejected because processing kept failing", async () => {
    const repository = persistenceApp.container.resolve(
      containerTokens.mediaRepository,
    );
    const failed = await seedMedia("rejected", "processing_failed");
    const corrupt = await seedMedia("rejected", "corrupt");
    const legacy = await seedMedia("rejected");
    const ready = await seedMedia("ready");

    await expect(
      repository.reopenForReplay(asUuid(failed.id), retentionStart()),
    ).resolves.toBe(true);
    await expect(findMedia(failed.id)).resolves.toMatchObject({
      status: "uploaded",
      rejectionReason: null,
      rejectionCode: null,
      processingCompletedAt: null,
      processingAttempts: 5,
      processingError: "Error: storage unavailable",
    });
    // Once reopened it is no longer a rejection to reopen.
    await expect(
      repository.reopenForReplay(asUuid(failed.id), retentionStart()),
    ).resolves.toBe(false);

    for (const other of [corrupt, legacy, ready]) {
      await expect(
        repository.reopenForReplay(asUuid(other.id), retentionStart()),
      ).resolves.toBe(false);
    }
    await expect(findMedia(corrupt.id)).resolves.toMatchObject({
      status: "rejected",
      rejectionCode: "corrupt",
    });
    await expect(
      repository.reopenForReplay(asUuid(randomUUID()), retentionStart()),
    ).resolves.toBe(false);
  });

  it("does not reopen a rejection past its retention, and resets the re-queue budget", async () => {
    const repository = persistenceApp.container.resolve(
      containerTokens.mediaRepository,
    );
    const expired = await seedMedia("rejected", "processing_failed");
    const fresh = await seedMedia("rejected", "processing_failed");
    await persistenceApp.prisma.$executeRaw`
      UPDATE media SET updated_at = NOW(6) - INTERVAL 2 DAY WHERE id = ${expired.id}`;
    await persistenceApp.prisma.media.update({
      where: { id: fresh.id },
      data: { processingRequeues: 3 },
    });

    await expect(
      repository.reopenForReplay(asUuid(expired.id), retentionStart()),
    ).resolves.toBe(false);
    await expect(
      repository.reopenForReplay(asUuid(fresh.id), retentionStart()),
    ).resolves.toBe(true);
    await expect(findMedia(fresh.id)).resolves.toMatchObject({
      status: "uploaded",
      processingRequeues: 0,
    });
  });

  it("replays processing failures from the database, whether or not they were dead-lettered", async () => {
    const stuck = await seedMedia("rejected", "processing_failed");
    const gone = await seedMedia("rejected", "processing_failed", {
      uploadKept: false,
    });
    const corrupt = await seedMedia("rejected", "corrupt");

    await expect(replay(true, undefined, "database")).resolves.toMatchObject({
      scanned: 2,
      replayed: 1,
      notReplayable: 1,
    });
    await expect(findMedia(stuck.id)).resolves.toMatchObject({
      status: "rejected",
    });

    await expect(replay(false, undefined, "database")).resolves.toMatchObject({
      source: "database",
      replayed: 1,
      notReplayable: 1,
      error: null,
    });
    await expect(findMedia(stuck.id)).resolves.toMatchObject({
      status: "uploaded",
    });
    await expect(findMedia(gone.id)).resolves.toMatchObject({
      status: "rejected",
    });
    await expect(findMedia(corrupt.id)).resolves.toMatchObject({
      status: "rejected",
    });
    await expect(
      waitForRabbitMqPayload<MediaProcessingJobPayload>(
        persistenceApp.infra.rabbitMq,
        MAIN_QUEUE_NAME,
        (payload) => payload.mediaId === stuck.id,
      ),
    ).resolves.toMatchObject({ attempt: 0 });
  }, 30_000);

  it("keeps the uploads a replay may need out of the blob cleanup", async () => {
    const failed = await seedMedia("rejected", "processing_failed");
    const waiting = await seedMedia("uploaded");
    const corrupt = await seedMedia("rejected", "corrupt");
    const ready = await seedMedia("ready");

    const { blobNames, sourceCounts } =
      await new BlobCleanupRepository().loadReferences();

    expect(blobNames.has(failed.originalBlobName)).toBe(true);
    expect(blobNames.has(waiting.originalBlobName)).toBe(true);
    expect(blobNames.has(corrupt.originalBlobName)).toBe(false);
    expect(blobNames.has(ready.originalBlobName)).toBe(false);
    expect(sourceCounts.mediaUploads).toBe(2);
  });

  it("replays what can still be processed and drains the dead-letter queue", async () => {
    const failed = await seedMedia("rejected", "processing_failed");
    const neverRejected = await seedMedia("uploaded");
    const uploadGone = await seedMedia("rejected", "processing_failed", {
      uploadKept: false,
    });
    const corrupt = await seedMedia("rejected", "corrupt");
    for (const item of [failed, neverRejected, uploadGone, corrupt]) {
      await deadLetter(item.id);
    }
    await waitForQueueDepth(DEAD_LETTER_QUEUE_NAME, 4);

    // A dry run changes nothing and leaves every message queued.
    await expect(replay(true)).resolves.toMatchObject({
      scanned: 4,
      replayed: 1,
      requeued: 1,
      notReplayable: 2,
    });
    await expect(findMedia(failed.id)).resolves.toMatchObject({
      status: "rejected",
    });
    await waitForQueueDepth(DEAD_LETTER_QUEUE_NAME, 4);
    await waitForQueueDepth(MAIN_QUEUE_NAME, 0);

    const result = await replay(false);

    expect(result).toMatchObject({
      mode: "replay",
      scanned: 4,
      replayed: 1,
      requeued: 1,
      notReplayable: 2,
      failed: 0,
    });
    await expect(findMedia(failed.id)).resolves.toMatchObject({
      status: "uploaded",
      rejectionCode: null,
    });
    await expect(findMedia(uploadGone.id)).resolves.toMatchObject({
      status: "rejected",
      rejectionCode: "processing_failed",
    });
    for (const item of [failed, neverRejected]) {
      await expect(
        waitForRabbitMqPayload<MediaProcessingJobPayload>(
          persistenceApp.infra.rabbitMq,
          MAIN_QUEUE_NAME,
          (payload) => payload.mediaId === item.id,
        ),
      ).resolves.toMatchObject({ attempt: 0 });
    }
    await waitForQueueDepth(DEAD_LETTER_QUEUE_NAME, 0);
  }, 30_000);

  it("queues an unfinished item once when its duplicates are replayed in separate runs", async () => {
    const waiting = await seedMedia("uploaded");
    await deadLetter(waiting.id);
    await deadLetter(waiting.id);
    await waitForQueueDepth(DEAD_LETTER_QUEUE_NAME, 2);

    await expect(replay(false, 1)).resolves.toMatchObject({ requeued: 1 });
    await expect(replay(false, 1)).resolves.toMatchObject({
      requeued: 0,
      skipped: 1,
      items: [expect.objectContaining({ reason: "in_flight" })],
    });

    await waitForQueueDepth(DEAD_LETTER_QUEUE_NAME, 0);
    await waitForQueueDepth(MAIN_QUEUE_NAME, 1);
  }, 30_000);

  it("processes a replayed item to ready", async () => {
    const failed = await seedMedia("rejected", "processing_failed");
    persistenceApp.stubs.blobService.storage.set(failed.originalBlobName, {
      contentType: "image/png",
      body: await createPngFixture(40, 30),
    });
    await deadLetter(failed.id);
    await waitForQueueDepth(DEAD_LETTER_QUEUE_NAME, 1);

    await expect(replay(false)).resolves.toMatchObject({ replayed: 1 });
    // What the worker does with the queued job.
    await persistenceApp.container
      .resolve(containerTokens.mediaProcessingService)
      .process(asUuid(failed.id));

    await expect(findMedia(failed.id)).resolves.toMatchObject({
      status: "ready",
      rejectionCode: null,
      processingAttempts: 6,
      processingCompletedAt: expect.any(Date),
    });
    expect(
      persistenceApp.stubs.blobService.storage.has(failed.originalBlobName),
    ).toBe(false);
  }, 30_000);
});
