import { randomUUID } from "node:crypto";
import { containerTokens } from "@/configuration/bootstrap/container";
import { buildApiPath } from "@/configuration/http/api-path";
import { asUuid } from "@/configuration/validation/uuid";
import { buildImageVariantBlobNames } from "@/features/blob/image-variant-names";
import { MediaRepository } from "@/features/media/media.repository";
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
  unattachedReadyTtlMs: 24 * HOUR_MS,
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

  async function backdate(id: string, to: Date): Promise<void> {
    await persistenceApp.prisma.$executeRaw`
      UPDATE media SET created_at = ${to}, updated_at = ${to}
      WHERE id = ${id}`;
  }

  /** The processed image and both renditions, as the harness stores them. */
  function imageBlobNames(blobName: string): string[] {
    const names = buildImageVariantBlobNames(blobName)!;

    return [names.large, names.medium, names.thumbnail];
  }

  /** An old ready image no reference holds, as a picked but unsaved photo. */
  async function createUnattachedMedia(
    options: { scope?: string; updatedAt?: Date } = {},
  ) {
    const media = await createReadyMedia(ownerId, { scope: options.scope });
    await backdate(media.mediaId, options.updatedAt ?? ago(48 * HOUR_MS));

    return media;
  }

  function createPosting(
    owner: { headers(): Record<string, string> },
    photoMediaId: string,
  ) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath("/postings")}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          variant: { family: "place", subtype: "workspace" },
          name: `Cleanup race ${photoMediaId}`,
          description: "A posting saved while the media cleanup runs.",
          pricing: { currency: "cad", daily: { amount: 120 } },
          photos: [{ mediaId: photoMediaId, position: 0 }],
          tags: [],
          details: {
            guest_capacity: 2,
            bedrooms: 0,
            bathrooms: 1,
            property_type: "loft",
            amenities: [],
            pet_friendly: false,
            parking: false,
          },
          availabilityStatus: "available",
          instantBooking: false,
          availabilityBlocks: [],
          location: {
            latitude: 43.6511,
            longitude: -79.347,
            city: "Toronto",
            region: "Ontario",
            country: "Canada",
            postalCode: "M5A1A1",
          },
        }),
      },
    );
  }

  function countPhotoReferences(blobName: string): Promise<number> {
    return persistenceApp.prisma.postingPhoto.count({ where: { blobName } });
  }

  async function createRestorableAudit(
    resourceType: "organization" | "posting",
    beforeSnapshot: Record<string, unknown>,
  ): Promise<void> {
    const organization =
      await persistenceApp.prisma.organization.findFirstOrThrow();
    const latest = await persistenceApp.prisma.organizationAuditLog.aggregate({
      where: { organizationId: organization.id },
      _max: { organizationVersion: true },
    });

    await persistenceApp.prisma.organizationAuditLog.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        action: `${resourceType}.updated`,
        resourceType,
        resourceId: randomUUID(),
        organizationVersion: (latest._max.organizationVersion ?? 0) + 1,
        summary: "Held by the media cleanup test.",
        beforeSnapshot: beforeSnapshot as never,
        afterSnapshot: {},
        restorable: true,
      },
    });
  }

  /**
   * The harness runs no processing worker, so by default the sweep is told the
   * queue is idle and consumed; `readBacklog` itself is checked against
   * RabbitMQ below.
   */
  function sweep(
    options: {
      realBacklog?: boolean;
      mediaRepository?: MediaRepository;
    } = {},
  ) {
    const container = persistenceApp.container;
    const queue = container.resolve(
      containerTokens.mediaProcessingQueueService,
    );

    return new MediaCleanupService(
      options.mediaRepository ??
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
    // Old, but attached as the owner's avatar.
    const ready = await createReadyMedia(ownerId, { scope: "avatars" });
    await persistenceApp.prisma.profile.update({
      where: { userId: ownerId },
      data: { avatarBlobName: ready.blobName, avatarUrl: ready.blobUrl },
    });
    await backdate(ready.mediaId, twoDaysAgo);

    await expect(sweep()).resolves.toEqual({
      abandonedDeleted: 1,
      requeued: 2,
      rejected: 1,
      rejectedPurged: 1,
      unattachedDeleted: 0,
      // The avatar, moved to the back of the order.
      attached: 1,
      held: 0,
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
      unattachedDeleted: 0,
      attached: 0,
      held: 0,
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

  it("deletes a ready image nothing attached in time, keeping a tombstone until the purge", async () => {
    const storage = persistenceApp.stubs.blobService.storage;
    const unattached = await createUnattachedMedia();

    await expect(sweep()).resolves.toMatchObject({
      unattachedDeleted: 1,
      held: 0,
      failed: 0,
    });

    await expect(findMedia(unattached.mediaId)).resolves.toMatchObject({
      status: "rejected",
      rejectionCode: "unattached",
      rejectionReason: "This image was not saved in time. Upload it again.",
    });
    for (const name of imageBlobNames(unattached.blobName)) {
      expect(storage.has(name)).toBe(false);
    }

    // A late save is told why.
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const lateSave = await createPosting(owner, unattached.mediaId);
    expect(lateSave.status).toBe(400);
    await expect(lateSave.json()).resolves.toMatchObject({
      message:
        "Image was rejected: This image was not saved in time. Upload it again.",
    });

    // The purge of old rejections removes the tombstone after its retention.
    await persistenceApp.prisma.$executeRaw`
      UPDATE media SET updated_at = ${ago(48 * HOUR_MS)}
      WHERE id = ${unattached.mediaId}`;
    await expect(sweep()).resolves.toMatchObject({ rejectedPurged: 1 });
    await expect(findMedia(unattached.mediaId)).resolves.toBeNull();
  });

  it("keeps attached, recent, and audit-held images", async () => {
    const storage = persistenceApp.stubs.blobService.storage;
    const organization =
      await persistenceApp.prisma.organization.findFirstOrThrow();
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const photo = await createReadyMedia(ownerId);
    const created = await createPosting(owner, photo.mediaId);
    expect({
      status: created.status,
      body: await created.text(),
    }).toMatchObject({ status: 201 });
    await backdate(photo.mediaId, ago(48 * HOUR_MS));

    const avatar = await createUnattachedMedia({ scope: "avatars" });
    await persistenceApp.prisma.profile.update({
      where: { userId: ownerId },
      data: { avatarBlobName: avatar.blobName, avatarUrl: avatar.blobUrl },
    });

    const logo = await createUnattachedMedia({ scope: "organizations" });
    await persistenceApp.prisma.organization.update({
      where: { id: organization.id },
      data: { logoBlobName: logo.blobName, logoUrl: logo.blobUrl },
    });

    const cover = await createUnattachedMedia({ scope: "organizations" });
    const blogPost =
      await persistenceApp.prisma.organizationBlogPost.findFirst();
    if (blogPost) {
      await persistenceApp.prisma.organizationBlogPost.update({
        where: { id: blogPost.id },
        data: {
          coverImageBlobName: cover.blobName,
          coverImageUrl: cover.blobUrl,
        },
      });
    }

    const recent = await createUnattachedMedia({
      updatedAt: ago(HOUR_MS),
    });

    const replacedLogo = await createUnattachedMedia({
      scope: "organizations",
    });
    await createRestorableAudit("organization", {
      logoBlobName: replacedLogo.blobName,
      logoUrl: replacedLogo.blobUrl,
    });

    const removedPhoto = await createUnattachedMedia();
    await createRestorableAudit("posting", {
      photos: [
        { blobName: "postings/legacy.jpg", blobUrl: "https://example.com/x" },
        { blobName: removedPhoto.blobName, blobUrl: removedPhoto.blobUrl },
      ],
    });

    await expect(sweep()).resolves.toMatchObject({
      unattachedDeleted: blogPost ? 0 : 1,
      attached: blogPost ? 4 : 3,
      held: 2,
      failed: 0,
    });

    const kept = [photo, avatar, logo, recent, replacedLogo, removedPhoto];
    for (const item of blogPost ? [...kept, cover] : kept) {
      await expect(findMedia(item.mediaId)).resolves.toMatchObject({
        status: "ready",
      });
      for (const name of imageBlobNames(item.blobName)) {
        expect(storage.has(name)).toBe(true);
      }
    }

    // Attached and held images move to the back of the order rather than
    // being read again by every sweep.
    for (const item of [photo, avatar, logo, replacedLogo]) {
      const moved = await findMedia(item.mediaId);
      expect(moved!.updatedAt.getTime()).toBeGreaterThan(
        ago(HOUR_MS).getTime(),
      );
    }
    await expect(sweep()).resolves.toMatchObject({
      unattachedDeleted: 0,
      attached: 0,
      held: 0,
    });
  });

  it("keeps an image a save attached after the sweep listed it", async () => {
    const storage = persistenceApp.stubs.blobService.storage;
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const photo = await createUnattachedMedia();
    const repository = new MediaRepository(persistenceApp.prisma);
    const listAttached = repository.listAttachedBlobNames.bind(repository);
    let saved: Response | undefined;
    // The save commits between the sweep finding the item unattached and
    // claiming it.
    repository.listAttachedBlobNames = async (blobNames) => {
      const attached = await listAttached(blobNames);
      saved = await createPosting(owner, photo.mediaId);
      return attached;
    };

    await expect(sweep({ mediaRepository: repository })).resolves.toMatchObject(
      { unattachedDeleted: 0, failed: 0 },
    );

    expect(saved?.status).toBe(201);
    await expect(countPhotoReferences(photo.blobName)).resolves.toBe(1);
    await expect(findMedia(photo.mediaId)).resolves.toMatchObject({
      status: "ready",
    });
    for (const name of imageBlobNames(photo.blobName)) {
      expect(storage.has(name)).toBe(true);
    }
  });

  it("fails a save cleanly when the sweep claims the image after the save read it", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const photo = await createUnattachedMedia();
    const findById = MediaRepository.prototype.findById;
    // The sweep claims and deletes the image between the save resolving the
    // media id, which still finds it ready, and writing the posting.
    const spy = jest
      .spyOn(MediaRepository.prototype, "findById")
      .mockImplementationOnce(async function (this: MediaRepository, id) {
        const record = await findById.call(this, id);
        await expect(sweep()).resolves.toMatchObject({ unattachedDeleted: 1 });
        return record;
      });

    try {
      const saved = await createPosting(owner, photo.mediaId);

      expect(saved.status).toBe(400);
      await expect(saved.json()).resolves.toMatchObject({
        message: "Image is no longer available. Upload it again.",
      });
    } finally {
      spy.mockRestore();
    }

    await expect(countPhotoReferences(photo.blobName)).resolves.toBe(0);
    await expect(findMedia(photo.mediaId)).resolves.toMatchObject({
      status: "rejected",
      rejectionCode: "unattached",
    });
  });

  it("never leaves a reference to a deleted image when saves and sweeps race", async () => {
    const storage = persistenceApp.stubs.blobService.storage;
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const photos = await Promise.all(
      Array.from({ length: 6 }, () => createUnattachedMedia()),
    );

    const [saves] = await Promise.all([
      Promise.all(photos.map((photo) => createPosting(owner, photo.mediaId))),
      sweep(),
      sweep(),
    ]);

    for (const [index, photo] of photos.entries()) {
      const media = await findMedia(photo.mediaId);
      const references = await countPhotoReferences(photo.blobName);

      if (saves[index]!.status === 201) {
        expect(references).toBe(1);
        expect(media).toMatchObject({ status: "ready" });
        for (const name of imageBlobNames(photo.blobName)) {
          expect(storage.has(name)).toBe(true);
        }
      } else {
        expect(saves[index]!.status).toBe(400);
        expect(references).toBe(0);
        expect(media).toMatchObject({
          status: "rejected",
          rejectionCode: "unattached",
        });
      }
    }
  });

  describe("DELETE /media/{id} racing a save", () => {
    function deleteMedia(
      owner: { headers(): Record<string, string> },
      mediaId: string,
    ) {
      return persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/media/${mediaId}`)}`,
        { method: "DELETE", headers: owner.headers() },
      );
    }

    it("refuses a save whose image was deleted after the save read it", async () => {
      const storage = persistenceApp.stubs.blobService.storage;
      const owner = await createAuthenticatedRequestContext({
        email: "owner1@rentify.local",
      });
      const photo = await createReadyMedia(ownerId);
      const findById = MediaRepository.prototype.findById;
      let deleted: Response | undefined;
      // The client picks another photo and deletes this one between the save
      // resolving the media id, which still finds it ready, and writing the
      // posting.
      const spy = jest
        .spyOn(MediaRepository.prototype, "findById")
        .mockImplementationOnce(async function (this: MediaRepository, id) {
          const record = await findById.call(this, id);
          deleted = await deleteMedia(owner, photo.mediaId);
          return record;
        });

      try {
        const saved = await createPosting(owner, photo.mediaId);

        expect(deleted?.status).toBe(200);
        expect(saved.status).toBe(400);
        await expect(saved.json()).resolves.toMatchObject({
          message: "Image is no longer available. Upload it again.",
        });
      } finally {
        spy.mockRestore();
      }

      await expect(countPhotoReferences(photo.blobName)).resolves.toBe(0);
      await expect(findMedia(photo.mediaId)).resolves.toBeNull();
      for (const name of imageBlobNames(photo.blobName)) {
        expect(storage.has(name)).toBe(false);
      }
    });

    it("keeps an image a save attached after the delete checked its owner", async () => {
      const storage = persistenceApp.stubs.blobService.storage;
      const owner = await createAuthenticatedRequestContext({
        email: "owner1@rentify.local",
      });
      const photo = await createReadyMedia(ownerId);
      const findById = MediaRepository.prototype.findById;
      let saved: Response | undefined;
      // The save commits between the delete reading the item and locking it.
      const spy = jest
        .spyOn(MediaRepository.prototype, "findById")
        .mockImplementationOnce(async function (this: MediaRepository, id) {
          const record = await findById.call(this, id);
          saved = await createPosting(owner, photo.mediaId);
          return record;
        });

      try {
        const deleted = await deleteMedia(owner, photo.mediaId);

        expect(saved?.status).toBe(201);
        expect(deleted.status).toBe(409);
      } finally {
        spy.mockRestore();
      }

      await expect(countPhotoReferences(photo.blobName)).resolves.toBe(1);
      await expect(findMedia(photo.mediaId)).resolves.toMatchObject({
        status: "ready",
      });
      for (const name of imageBlobNames(photo.blobName)) {
        expect(storage.has(name)).toBe(true);
      }
    });

    it("never leaves a reference to a deleted image when saves and deletes race", async () => {
      const storage = persistenceApp.stubs.blobService.storage;
      const owner = await createAuthenticatedRequestContext({
        email: "owner1@rentify.local",
      });
      const photos = await Promise.all(
        Array.from({ length: 6 }, () => createReadyMedia(ownerId)),
      );

      const [saves, deletes] = await Promise.all([
        Promise.all(photos.map((photo) => createPosting(owner, photo.mediaId))),
        Promise.all(photos.map((photo) => deleteMedia(owner, photo.mediaId))),
      ]);

      for (const [index, photo] of photos.entries()) {
        const references = await countPhotoReferences(photo.blobName);

        if (saves[index]!.status === 201) {
          expect(deletes[index]!.status).toBe(409);
          expect(references).toBe(1);
          await expect(findMedia(photo.mediaId)).resolves.toMatchObject({
            status: "ready",
          });
          for (const name of imageBlobNames(photo.blobName)) {
            expect(storage.has(name)).toBe(true);
          }
        } else {
          expect(
            `${saves[index]!.status} ${await saves[index]!.text()}`,
          ).toMatch(/^400 /);
          expect(deletes[index]!.status).toBe(200);
          expect(references).toBe(0);
          await expect(findMedia(photo.mediaId)).resolves.toBeNull();
        }
      }
    });
  });
});
