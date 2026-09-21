import { buildApiPath } from "@/configuration/http/api-path";
import { BlobCleanupRepository } from "@/features/blob/blob-cleanup.repository";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  createReadyMedia,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { createPngFixture } from "../../support/image-fixtures";

/**
 * Exercises the blob endpoints that remain: the development-only stand-ins for
 * Azure's upload and public read endpoints. Uploads are started, completed, and
 * deleted through /media; see media.integration.test.ts. Blob storage itself is
 * held in memory by the harness.
 */
describe("Blob persistence integration", () => {
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

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("serves a processed image but never a quarantined upload", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const media = await createReadyMedia(owner.userId);
    const quarantined = `quarantine/images/${owner.userId}/${media.mediaId}`;
    persistenceApp.stubs.blobService.storage.set(quarantined, {
      contentType: "image/png",
      body: await createPngFixture(),
    });

    const processed = await request(
      `/blob/file?blobName=${encodeURIComponent(media.blobName)}`,
    );
    expect(processed.status).toBe(200);
    expect(processed.headers.get("content-type")).toBe("image/webp");

    for (const blobName of [quarantined, ` /Quarantine/images/x`]) {
      const response = await request(
        `/blob/file?blobName=${encodeURIComponent(blobName)}`,
      );
      expect(response.status).toBe(404);
    }
  });

  it("refuses a local upload for a name no pending media was issued for", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const blobName = `postings/${owner.userId}/direct.png`;

    // The harness token is valid for any name, so this reaches the media
    // check rather than failing on the signature.
    const response = await request(
      `/blob/upload?blobName=${encodeURIComponent(blobName)}&expiresAt=2099-01-01T00:00:00.000Z&token=test-upload-token`,
      {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(await createPngFixture()),
      },
    );

    expect(response.status).toBe(400);
    expect(persistenceApp.stubs.blobService.storage.has(blobName)).toBe(false);
  });

  it("keeps a ready media row when cleanup removes its leftover quarantined upload", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const ready = await createReadyMedia(owner.userId);
    const abandonedId = "8d6f1c2a-3b4e-4f5a-9b6c-7d8e9f0a1b2c";
    const abandonedName = `quarantine/images/${owner.userId}/${abandonedId}`;
    await persistenceApp.prisma.media.create({
      data: {
        id: abandonedId,
        userId: owner.userId,
        status: "pending_upload",
        scope: "postings",
        originalBlobName: abandonedName,
        declaredContentType: "image/png",
      },
    });
    const readyRow = await persistenceApp.prisma.media.findUniqueOrThrow({
      where: { id: ready.mediaId },
    });

    // As blob-cleanup --delete reports after removing both quarantined
    // uploads: the ready item's leftover and the abandoned item's.
    const removed = await new BlobCleanupRepository().deleteAbandonedMedia({
      deletedBlobNames: [readyRow.originalBlobName, abandonedName],
      olderThan: new Date(Date.now() + 60_000),
    });

    expect(removed).toBe(1);
    await expect(
      persistenceApp.prisma.media.findUnique({ where: { id: ready.mediaId } }),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(
      persistenceApp.prisma.media.findUnique({ where: { id: abandonedId } }),
    ).resolves.toBeNull();
  });
});
