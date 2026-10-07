import { randomUUID } from "node:crypto";
import { containerTokens } from "@/configuration/bootstrap/container";
import { buildApiPath } from "@/configuration/http/api-path";
import type {
  CreatedMediaUpload,
  MediaProcessingJobPayload,
  MediaView,
} from "@/features/media/media.model";
import { MediaRepository } from "@/features/media/media.repository";
import { MediaVariantsBackfillService } from "@/features/media/media-variants-backfill.service";
import { MediaProcessingService } from "@/features/media/media-processing.service";
import { asUuid } from "@/configuration/validation/uuid";
import type { BlobService } from "@/features/blob/blob.service";
import { waitForRabbitMqPayload } from "../../support/live-rabbitmq-assertions";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  createReadyMedia,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { createPngFixture } from "../../support/image-fixtures";

const MEDIA_PROCESSING_QUEUE_NAME = "media.processing.main";

function buildPostingBody(photos: Array<Record<string, unknown>>) {
  return {
    variant: { family: "place", subtype: "workspace" },
    name: "Media Attachment Workspace",
    description: "Loft used to check that postings attach processed media.",
    pricing: { currency: "cad", daily: { amount: 120 } },
    photos,
    tags: ["loft", "workspace"],
    details: {
      guest_capacity: 4,
      bedrooms: 0,
      bathrooms: 1,
      property_type: "loft",
      amenities: ["wifi"],
      pet_friendly: false,
      parking: false,
    },
    availabilityStatus: "available",
    availabilityBlocks: [],
    location: {
      latitude: 43.6511,
      longitude: -79.347,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
    },
  };
}

/**
 * Drives the media upload lifecycle over HTTP against the real MediaService,
 * database, and RabbitMQ, with blob storage held in memory by the harness.
 */
describe("Media persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  async function request(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {},
  ): Promise<Response> {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  async function readData<TData>(response: Response): Promise<TData> {
    const body = (await response.json()) as { data: TData };
    return body.data;
  }

  async function startUpload(
    headers: Record<string, string>,
    body: Record<string, unknown> = {},
  ): Promise<CreatedMediaUpload> {
    const response = await request("/media/uploads", {
      method: "POST",
      headers,
      body: JSON.stringify({
        filename: "photo.png",
        contentType: "image/png",
        scope: "postings",
        ...body,
      }),
    });
    expect(response.status).toBe(201);
    return readData<CreatedMediaUpload>(response);
  }

  async function putBytes(uploadUrl: string, body: Buffer): Promise<Response> {
    const query = new URL(uploadUrl).searchParams.toString();
    return request(`/blob/upload?${query}`, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(body),
    });
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("records an upload, keeps it in quarantine, and queues it for processing", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const fixture = await createPngFixture();

    const created = await startUpload(owner.headers(), {
      sizeBytes: fixture.byteLength,
    });
    const { mediaId, upload } = created;
    // Only the id and a write-only upload target: no media view, and no
    // blob name or URL that could render the quarantined bytes.
    expect(Object.keys(created).sort()).toEqual(["mediaId", "upload"]);
    expect(Object.keys(upload).sort()).toEqual([
      "expiresAt",
      "headers",
      "method",
      "url",
    ]);
    await expect(
      persistenceApp.prisma.media.findUniqueOrThrow({ where: { id: mediaId } }),
    ).resolves.toMatchObject({ status: "pending_upload", scope: "postings" });

    const pendingRead = await request(`/media/${mediaId}`, {
      headers: owner.headers(),
    });
    await expect(
      readData<{ media: MediaView }>(pendingRead),
    ).resolves.toMatchObject({
      media: { status: "pending_upload", url: null },
    });

    const quarantinedName = new URL(upload.url).searchParams.get("blobName");
    expect(quarantinedName).toBe(
      `quarantine/images/${owner.userId}/${mediaId}`,
    );

    const early = await request(`/media/${mediaId}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });
    expect(early.status).toBe(409);

    expect((await putBytes(upload.url, fixture)).status).toBe(201);

    // Quarantined bytes are never served, even to someone holding the name.
    const served = await request(
      `/blob/file?blobName=${encodeURIComponent(quarantinedName!)}`,
    );
    expect(served.status).toBe(404);

    const completed = await request(`/media/${mediaId}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });
    expect(completed.status).toBe(202);
    await expect(readData<{ media: MediaView }>(completed)).resolves.toEqual({
      media: expect.objectContaining({
        id: mediaId,
        status: "uploaded",
        sizeBytes: fixture.byteLength,
        url: null,
      }),
    });

    await expect(
      persistenceApp.prisma.media.findUniqueOrThrow({ where: { id: mediaId } }),
    ).resolves.toMatchObject({
      originalEtag: expect.stringMatching(/^"stub-/),
    });

    await waitForRabbitMqPayload<MediaProcessingJobPayload>(
      persistenceApp.infra.rabbitMq,
      MEDIA_PROCESSING_QUEUE_NAME,
      (payload) => payload.mediaId === mediaId,
    );

    const read = await request(`/media/${mediaId}`, {
      headers: owner.headers(),
    });
    expect(read.status).toBe(200);
    await expect(readData<{ media: MediaView }>(read)).resolves.toMatchObject({
      media: { status: "uploaded" },
    });
  });

  it("rejects an upload the scanner finds infected, without naming the signature", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const { mediaId, upload } = await startUpload(owner.headers());
    const quarantinedName = new URL(upload.url).searchParams.get("blobName")!;
    await putBytes(upload.url, await createPngFixture(40, 30));
    await request(`/media/${mediaId}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });

    const container = persistenceApp.container;
    await new MediaProcessingService(
      container.resolve(containerTokens.mediaRepository),
      container.resolve(containerTokens.blobService),
      container.resolve(containerTokens.mediaMetrics),
      {
        scan: async () => ({
          verdict: "infected",
          threat: "Eicar-Test-Signature",
          engine: "ClamAV 1.5.4/28137",
        }),
      },
      container.resolve(containerTokens.imageModeration),
    ).process(mediaId);

    const read = await request(`/media/${mediaId}`, {
      headers: owner.headers(),
    });
    const { media } = await readData<{ media: MediaView }>(read);

    expect(media).toMatchObject({
      status: "rejected",
      rejectionCode: "malware",
      rejectionReason: "This file can't be used.",
      url: null,
    });
    expect(JSON.stringify(media)).not.toMatch(/Eicar|ClamAV|threat|scan/i);
    await expect(
      persistenceApp.prisma.media.findUniqueOrThrow({ where: { id: mediaId } }),
    ).resolves.toMatchObject({
      status: "rejected",
      rejectionCode: "malware",
      processedBlobName: null,
      scanStatus: "infected",
      scanEngine: "ClamAV 1.5.4/28137",
      scannedAt: expect.any(Date),
      threatName: "Eicar-Test-Signature",
    });
    expect(persistenceApp.stubs.blobService.storage.has(quarantinedName)).toBe(
      false,
    );
    expect(
      persistenceApp.stubs.blobService.storage.has(
        `media/images/${owner.userId}/${mediaId}.webp`,
      ),
    ).toBe(false);
  });

  it("rejects an image moderation blocks, without publishing any rendition", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const { mediaId, upload } = await startUpload(owner.headers());
    const quarantinedName = new URL(upload.url).searchParams.get("blobName")!;
    await putBytes(upload.url, await createPngFixture(1000, 600));
    await request(`/media/${mediaId}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });
    const blocked = {
      decision: "block" as const,
      categories: { hate: 0, sexual: 0, violence: 6, selfHarm: 0 },
      provider: "azure-content-safety",
    };

    const container = persistenceApp.container;
    await new MediaProcessingService(
      container.resolve(containerTokens.mediaRepository),
      container.resolve(containerTokens.blobService),
      container.resolve(containerTokens.mediaMetrics),
      container.resolve(containerTokens.malwareScanner),
      { moderate: async () => blocked, checkAccess: async () => undefined },
    ).process(mediaId);

    const read = await request(`/media/${mediaId}`, {
      headers: owner.headers(),
    });
    const { media } = await readData<{ media: MediaView }>(read);

    expect(media).toMatchObject({
      status: "rejected",
      rejectionCode: "moderation",
      rejectionReason: "This image doesn't meet our content guidelines.",
      url: null,
    });
    // The severities stay on the row, for operators.
    expect(JSON.stringify(media)).not.toMatch(
      /violence|severity|moderationResult|content-safety/i,
    );
    await expect(
      persistenceApp.prisma.media.findUniqueOrThrow({ where: { id: mediaId } }),
    ).resolves.toMatchObject({
      status: "rejected",
      rejectionCode: "moderation",
      processedBlobName: null,
      moderationResult: blocked,
    });
    const blobNames = [...persistenceApp.stubs.blobService.storage.keys()];
    expect(blobNames).not.toContain(quarantinedName);
    expect(
      blobNames.filter((name) =>
        name.startsWith(`media/images/${owner.userId}/${mediaId}`),
      ),
    ).toEqual([]);
  });

  it("holds the scan and readiness to the item's latest attempt", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const repository = persistenceApp.container.resolve(
      containerTokens.mediaRepository,
    );
    const mediaId = asUuid(randomUUID());
    await persistenceApp.prisma.media.create({
      data: {
        id: mediaId,
        userId: owner.userId,
        status: "uploaded",
        scope: "postings",
        originalBlobName: `quarantine/images/${owner.userId}/${mediaId}`,
        declaredContentType: "image/png",
        processingAttempts: 2,
        // Left by an earlier attempt; the claim must clear them.
        scanStatus: "clean",
        scanEngine: "ClamAV 1.5.4/28137",
        scannedAt: new Date(),
        moderationResult: {
          decision: "allow",
          categories: {},
          provider: "none",
        },
      },
    });
    const ready = {
      processedBlobName: `media/images/${owner.userId}/${mediaId}.webp`,
      detectedContentType: "image/png",
      sizeBytes: 10,
      width: 4,
      height: 3,
      variants: { medium: null, thumbnail: null },
    };
    const clean = {
      status: "clean" as const,
      engine: "ClamAV 1.5.4/28137",
      threatName: null,
    };
    const allowed = {
      decision: "allow" as const,
      categories: { hate: 0, sexual: 0, violence: 0, selfHarm: 0 },
      provider: "azure-content-safety",
    };
    const findRow = () =>
      persistenceApp.prisma.media.findUniqueOrThrow({ where: { id: mediaId } });

    // A job that read the row before another claimed it loses the claim.
    await expect(repository.claimForProcessing(mediaId, 1)).resolves.toBe(
      false,
    );
    // Attempt 3.
    await expect(repository.claimForProcessing(mediaId, 2)).resolves.toBe(true);
    await expect(findRow()).resolves.toMatchObject({
      status: "processing",
      processingAttempts: 3,
      scanStatus: "not_scanned",
      scanEngine: null,
      scannedAt: null,
      threatName: null,
      moderationResult: null,
    });
    // Not scanned yet, then infected: neither can be published.
    await expect(repository.markReady(mediaId, 3, ready)).resolves.toBe(false);
    await expect(
      repository.recordScanResult(mediaId, 3, {
        status: "infected",
        engine: "ClamAV 1.5.4/28137",
        threatName: "Eicar-Test-Signature",
      }),
    ).resolves.toBe(true);
    await expect(repository.markReady(mediaId, 3, ready)).resolves.toBe(false);

    // Attempt 4 overtakes it. Attempt 3 can no longer record a verdict or
    // publish, even with a clean scan.
    await expect(repository.claimForProcessing(mediaId, 3)).resolves.toBe(true);
    await expect(repository.recordScanResult(mediaId, 3, clean)).resolves.toBe(
      false,
    );
    await expect(findRow()).resolves.toMatchObject({
      scanStatus: "not_scanned",
    });
    await expect(repository.recordScanResult(mediaId, 4, clean)).resolves.toBe(
      true,
    );
    await expect(repository.markReady(mediaId, 3, ready)).resolves.toBe(false);
    await expect(findRow()).resolves.toMatchObject({ status: "processing" });

    // Scanned clean but not yet moderated: still not publishable. Attempt 3
    // can no longer record a moderation result either.
    await expect(repository.markReady(mediaId, 4, ready)).resolves.toBe(false);
    await expect(
      repository.recordModerationResult(mediaId, 3, allowed),
    ).resolves.toBe(false);
    // A recorded block is a result, but never a publishable one.
    await expect(
      repository.recordModerationResult(mediaId, 4, {
        ...allowed,
        decision: "block",
      }),
    ).resolves.toBe(true);
    await expect(repository.markReady(mediaId, 4, ready)).resolves.toBe(false);
    await expect(
      repository.recordModerationResult(mediaId, 4, allowed),
    ).resolves.toBe(true);
    await expect(findRow()).resolves.toMatchObject({
      moderationResult: allowed,
    });

    await expect(repository.markReady(mediaId, 4, ready)).resolves.toBe(true);
    await expect(findRow()).resolves.toMatchObject({
      status: "ready",
      processingAttempts: 4,
      scanStatus: "clean",
    });
    // A finished item takes no further scan result.
    await expect(
      repository.recordScanResult(mediaId, 4, {
        status: "infected",
        engine: "ClamAV 1.5.4/28137",
        threatName: "Late",
      }),
    ).resolves.toBe(false);
  });

  it("processes a completed upload into a displayable image", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const { mediaId, upload } = await startUpload(owner.headers());
    const quarantinedName = new URL(upload.url).searchParams.get("blobName")!;
    await putBytes(upload.url, await createPngFixture(1000, 600));
    await request(`/media/${mediaId}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });

    // What the worker does with the queued job.
    await persistenceApp.container
      .resolve(containerTokens.mediaProcessingService)
      .process(mediaId);

    const read = await request(`/media/${mediaId}`, {
      headers: owner.headers(),
    });
    const { media: ready } = await readData<{ media: MediaView }>(read);
    const processedName = `media/images/${owner.userId}/${mediaId}.webp`;

    expect(ready).toMatchObject({
      status: "ready",
      contentType: "image/png",
      width: 1000,
      height: 600,
      rejectionReason: null,
      rejectionCode: null,
    });
    // The processing record is kept on the row and never leaves it.
    expect(ready).not.toHaveProperty("processingError");
    expect(ready).not.toHaveProperty("processingAttempts");
    await expect(
      persistenceApp.prisma.media.findUniqueOrThrow({ where: { id: mediaId } }),
    ).resolves.toMatchObject({
      processingAttempts: 1,
      processingStartedAt: expect.any(Date),
      processingCompletedAt: expect.any(Date),
      processingError: null,
      // The test configuration runs no scanner and no moderation.
      scanStatus: "skipped",
      scanEngine: "none",
      scannedAt: expect.any(Date),
      threatName: null,
      moderationResult: { decision: "allow", categories: {}, provider: "none" },
    });
    expect(ready).not.toHaveProperty("scanStatus");
    expect(new URL(ready.url!).searchParams.get("blobName")).toBe(
      processedName,
    );
    expect(persistenceApp.stubs.blobService.storage.has(quarantinedName)).toBe(
      false,
    );
    expect(
      persistenceApp.stubs.blobService.storage.get(processedName)?.contentType,
    ).toBe("image/webp");

    const renditions = {
      thumbnail: {
        blobName: `media/images/${owner.userId}/${mediaId}.thumbnail.webp`,
        width: 300,
        height: 180,
      },
      medium: {
        blobName: `media/images/${owner.userId}/${mediaId}.medium.webp`,
        width: 800,
        height: 480,
      },
      large: { blobName: processedName, width: 1000, height: 600 },
    };
    for (const [rendition, expected] of Object.entries(renditions)) {
      const served = ready.variants![rendition as keyof typeof renditions];
      expect(new URL(served.url).searchParams.get("blobName")).toBe(
        expected.blobName,
      );
      expect(served).toMatchObject({
        width: expected.width,
        height: expected.height,
      });
      expect(
        persistenceApp.stubs.blobService.storage.get(expected.blobName)
          ?.contentType,
      ).toBe("image/webp");
    }
  });

  it("rejects an upload whose bytes are not an image", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const { mediaId, upload } = await startUpload(owner.headers());
    await putBytes(upload.url, Buffer.from("definitely not a png"));
    await request(`/media/${mediaId}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });

    await persistenceApp.container
      .resolve(containerTokens.mediaProcessingService)
      .process(mediaId);

    const read = await request(`/media/${mediaId}`, {
      headers: owner.headers(),
    });
    await expect(readData<{ media: MediaView }>(read)).resolves.toMatchObject({
      media: {
        status: "rejected",
        url: null,
        rejectionReason: "Uploaded file could not be read as an image.",
        rejectionCode: "corrupt",
      },
    });
  });

  it("rejects an upload overwritten after it was completed", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const { mediaId, upload } = await startUpload(owner.headers());
    const quarantinedName = new URL(upload.url).searchParams.get("blobName")!;
    await putBytes(upload.url, await createPngFixture(10, 6));
    const completed = await request(`/media/${mediaId}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });
    expect(completed.status).toBe(202);

    // What a second PUT with a still-valid Azure SAS does: the local route
    // refuses it once the item has left pending_upload, Azure does not.
    expect(
      (await putBytes(upload.url, await createPngFixture(10, 6))).status,
    ).toBe(400);
    persistenceApp.stubs.blobService.storage.set(quarantinedName, {
      contentType: "text/plain",
      body: Buffer.from("x".repeat(4096)),
    });
    persistenceApp.stubs.blobService.downloadBlob.mockClear();

    await persistenceApp.container
      .resolve(containerTokens.mediaProcessingService)
      .process(mediaId);

    const read = await request(`/media/${mediaId}`, {
      headers: owner.headers(),
    });
    await expect(readData<{ media: MediaView }>(read)).resolves.toMatchObject({
      media: {
        status: "rejected",
        url: null,
        rejectionReason: "The upload changed after it was completed.",
        rejectionCode: "upload_changed",
      },
    });
    expect(
      persistenceApp.stubs.blobService.downloadBlob,
    ).not.toHaveBeenCalled();
    expect(
      persistenceApp.stubs.blobService.storage.has(
        `media/images/${owner.userId}/${mediaId}.webp`,
      ),
    ).toBe(false);
  });

  it("rejects an empty upload when it is completed", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const { mediaId, upload } = await startUpload(owner.headers());
    const quarantinedName = new URL(upload.url).searchParams.get("blobName")!;
    expect((await putBytes(upload.url, Buffer.alloc(0))).status).toBe(201);

    const completed = await request(`/media/${mediaId}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });

    expect(completed.status).toBe(422);
    await expect(completed.json()).resolves.toMatchObject({
      success: false,
      message: "The uploaded file is empty.",
      error: { details: { rejectionCode: "empty" } },
    });
    await expect(
      persistenceApp.prisma.media.findUniqueOrThrow({ where: { id: mediaId } }),
    ).resolves.toMatchObject({
      status: "rejected",
      rejectionReason: "The uploaded file is empty.",
      rejectionCode: "empty",
      originalEtag: null,
    });
    expect(persistenceApp.stubs.blobService.storage.has(quarantinedName)).toBe(
      false,
    );
  });

  it("attaches a processed image to a posting and refuses an unprocessed one", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const pending = await startUpload(owner.headers());
    const ready = await startUpload(owner.headers());
    await putBytes(ready.upload.url, await createPngFixture(1000, 600));
    await request(`/media/${ready.mediaId}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });
    await persistenceApp.container
      .resolve(containerTokens.mediaProcessingService)
      .process(ready.mediaId);

    const refused = await request("/postings", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify(
        buildPostingBody([{ mediaId: pending.mediaId, position: 0 }]),
      ),
    });
    expect(refused.status).toBe(400);

    // A blob named for the owner is not a way around the pipeline.
    const ownedName = `postings/${owner.userId}/direct.jpg`;
    const bypass = await request("/postings", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify(
        buildPostingBody([
          {
            blobUrl: `http://rent.test/api/v1/blob/file?blobName=${encodeURIComponent(ownedName)}`,
            blobName: ownedName,
            position: 0,
          },
        ]),
      ),
    });
    expect(bypass.status).toBe(400);

    const created = await request("/postings", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify(
        buildPostingBody([{ mediaId: ready.mediaId, position: 0 }]),
      ),
    });
    expect(created.status).toBe(201);
    const posting = await readData<{
      photos: Array<{
        blobName: string;
        blobUrl: string;
        variants: Record<
          "thumbnail" | "medium" | "large",
          { url: string; width: number }
        > | null;
      }>;
    }>(created);
    const processedName = `media/images/${owner.userId}/${ready.mediaId}.webp`;
    expect(posting.photos).toEqual([
      expect.objectContaining({ blobName: processedName }),
    ]);
    // Each rendition URL addresses a blob the worker wrote, at its width.
    const [photo] = posting.photos;
    expect(photo?.variants?.large).toEqual({
      url: photo?.blobUrl,
      width: 1000,
      height: 600,
    });
    for (const [rendition, suffix] of [
      ["thumbnail", ".thumbnail.webp"],
      ["medium", ".medium.webp"],
    ] as const) {
      const blobName = new URL(
        photo!.variants![rendition].url,
      ).searchParams.get("blobName");
      expect(blobName).toBe(processedName.replace(/\.webp$/, suffix));
      expect(persistenceApp.stubs.blobService.storage.has(blobName!)).toBe(
        true,
      );
    }

    // The posting now displays it, so it can no longer be deleted as media.
    const deleteAttached = await request(`/media/${ready.mediaId}`, {
      method: "DELETE",
      headers: owner.headers(),
    });
    expect(deleteAttached.status).toBe(409);
    expect(persistenceApp.stubs.blobService.storage.has(processedName)).toBe(
      true,
    );
  });

  it("hides one user's media from another and deletes it for its owner", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const otherUser = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const { mediaId, upload } = await startUpload(owner.headers());
    await putBytes(upload.url, await createPngFixture());

    const foreignRead = await request(`/media/${mediaId}`, {
      headers: otherUser.headers(),
    });
    const foreignComplete = await request(`/media/${mediaId}/complete`, {
      method: "POST",
      headers: otherUser.headers(),
    });
    const foreignDelete = await request(`/media/${mediaId}`, {
      method: "DELETE",
      headers: otherUser.headers(),
    });
    expect(foreignRead.status).toBe(404);
    expect(foreignComplete.status).toBe(404);
    expect(foreignDelete.status).toBe(404);

    const deleted = await request(`/media/${mediaId}`, {
      method: "DELETE",
      headers: owner.headers(),
    });
    expect(deleted.status).toBe(200);

    const afterDelete = await request(`/media/${mediaId}`, {
      headers: owner.headers(),
    });
    expect(afterDelete.status).toBe(404);
  });

  it("refuses non-image uploads, bad ids, and anonymous callers", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const pdf = await request("/media/uploads", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify({
        filename: "doc.pdf",
        contentType: "application/pdf",
        scope: "postings",
      }),
    });
    expect(pdf.status).toBe(415);
    // The frontend shows these verbatim and holds no copy of the limits, so
    // the messages themselves are part of the contract.
    await expect(pdf.json()).resolves.toMatchObject({
      success: false,
      message: "Only JPEG, PNG, and WebP images can be uploaded.",
      error: { code: "UNSUPPORTED_MEDIA_TYPE" },
    });

    const huge = await request("/media/uploads", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify({
        filename: "huge.png",
        contentType: "image/png",
        sizeBytes: 50 * 1024 * 1024,
        scope: "postings",
      }),
    });
    expect(huge.status).toBe(413);
    await expect(huge.json()).resolves.toMatchObject({
      message: "Images must be 5 MB or smaller.",
      error: { code: "PAYLOAD_TOO_LARGE" },
    });

    const noScope = await request("/media/uploads", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify({ filename: "a.png", contentType: "image/png" }),
    });
    expect(noScope.status).toBe(400);

    const badId = await request("/media/not-a-uuid", {
      headers: owner.headers(),
    });
    expect(badId.status).toBe(400);

    const anonymous = await request("/media/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "a.png", contentType: "image/png" }),
    });
    expect(anonymous.status).toBe(401);
  });

  it("backfills the renditions of ready media processed before they existed", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const blobService = persistenceApp.stubs.blobService;
    const legacy = await Promise.all([
      createReadyMedia(owner.userId, { legacy: true }),
      createReadyMedia(owner.userId, { legacy: true }),
    ]);
    const current = await createReadyMedia(owner.userId);
    for (const { mediaId, blobName } of legacy) {
      const body = await createPngFixture(1000, 500);
      blobService.storage.set(blobName, { contentType: "image/webp", body });
      // The backfill bounds its download by the recorded processed size.
      await persistenceApp.prisma.media.update({
        where: { id: mediaId },
        data: { sizeBytes: body.byteLength, width: 1000, height: 500 },
      });
    }
    const backfill = new MediaVariantsBackfillService(
      new MediaRepository(),
      blobService as unknown as BlobService,
    );

    const preview = await backfill.run({ dryRun: true, batchSize: 1 });
    expect(preview.pending.map((item) => item.mediaId).sort()).toEqual(
      legacy.map((item) => item.mediaId).sort(),
    );

    const result = await backfill.run({ dryRun: false, batchSize: 1 });
    expect(result).toMatchObject({ scanned: 2, converted: 2, failed: 0 });

    for (const { mediaId, blobName } of legacy) {
      const row = await persistenceApp.prisma.media.findUniqueOrThrow({
        where: { id: mediaId },
      });
      expect(row.variants).toMatchObject({
        medium: { width: 800, height: 400 },
        thumbnail: { width: 300, height: 150 },
      });
      expect(
        blobService.storage.has(blobName.replace(/\.webp$/, ".medium.webp")),
      ).toBe(true);
    }
    // An item that already has renditions is never selected.
    expect(result.failures).toEqual([]);
    expect(
      preview.pending.some((item) => item.mediaId === current.mediaId),
    ).toBe(false);

    await expect(
      backfill.run({ dryRun: false, batchSize: 1 }),
    ).resolves.toMatchObject({ scanned: 0, converted: 0 });

    // The guarded update refuses a row that is no longer the same image.
    await expect(
      new MediaRepository().setVariants(
        legacy[0]!.mediaId,
        "media/images/other/name.webp",
        {
          medium: { width: 1, height: 1, sizeBytes: 1 },
          thumbnail: { width: 1, height: 1, sizeBytes: 1 },
        },
      ),
    ).resolves.toBe(false);
  });
});
