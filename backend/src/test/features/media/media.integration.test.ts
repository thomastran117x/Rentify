import { containerTokens } from "@/configuration/bootstrap/container";
import { buildApiPath } from "@/configuration/http/api-path";
import type {
  CreatedMediaUpload,
  MediaProcessingJobPayload,
  MediaView,
} from "@/features/media/media.model";
import { waitForRabbitMqPayload } from "../../support/live-rabbitmq-assertions";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
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

    const { media, upload } = await startUpload(owner.headers(), {
      sizeBytes: fixture.byteLength,
    });
    expect(media).toMatchObject({
      status: "pending_upload",
      scope: "postings",
      url: null,
    });
    expect(upload).not.toHaveProperty("blobUrl");
    expect(upload).not.toHaveProperty("blobName");

    const quarantinedName = new URL(upload.uploadUrl).searchParams.get(
      "blobName",
    );
    expect(quarantinedName).toBe(
      `quarantine/images/${owner.userId}/${media.id}`,
    );

    const early = await request(`/media/${media.id}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });
    expect(early.status).toBe(409);

    expect((await putBytes(upload.uploadUrl, fixture)).status).toBe(201);

    // Quarantined bytes are never served, even to someone holding the name.
    const served = await request(
      `/blob/file?blobName=${encodeURIComponent(quarantinedName!)}`,
    );
    expect(served.status).toBe(404);

    const completed = await request(`/media/${media.id}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });
    expect(completed.status).toBe(202);
    await expect(readData<{ media: MediaView }>(completed)).resolves.toEqual({
      media: expect.objectContaining({
        id: media.id,
        status: "uploaded",
        sizeBytes: fixture.byteLength,
        url: null,
      }),
    });

    await waitForRabbitMqPayload<MediaProcessingJobPayload>(
      persistenceApp.infra.rabbitMq,
      MEDIA_PROCESSING_QUEUE_NAME,
      (payload) => payload.mediaId === media.id,
    );

    const read = await request(`/media/${media.id}`, {
      headers: owner.headers(),
    });
    expect(read.status).toBe(200);
    await expect(readData<{ media: MediaView }>(read)).resolves.toMatchObject({
      media: { status: "uploaded" },
    });
  });

  it("processes a completed upload into a displayable image", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const { media, upload } = await startUpload(owner.headers());
    const quarantinedName = new URL(upload.uploadUrl).searchParams.get(
      "blobName",
    )!;
    await putBytes(upload.uploadUrl, await createPngFixture(10, 6));
    await request(`/media/${media.id}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });

    // What the worker does with the queued job.
    await persistenceApp.container
      .resolve(containerTokens.mediaProcessingService)
      .process(media.id);

    const read = await request(`/media/${media.id}`, {
      headers: owner.headers(),
    });
    const { media: ready } = await readData<{ media: MediaView }>(read);
    const processedName = `media/images/${owner.userId}/${media.id}.webp`;

    expect(ready).toMatchObject({
      status: "ready",
      contentType: "image/png",
      width: 10,
      height: 6,
      rejectionReason: null,
    });
    expect(new URL(ready.url!).searchParams.get("blobName")).toBe(
      processedName,
    );
    expect(persistenceApp.stubs.blobService.storage.has(quarantinedName)).toBe(
      false,
    );
    expect(
      persistenceApp.stubs.blobService.storage.get(processedName)?.contentType,
    ).toBe("image/webp");
  });

  it("rejects an upload whose bytes are not an image", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const { media, upload } = await startUpload(owner.headers());
    await putBytes(upload.uploadUrl, Buffer.from("definitely not a png"));
    await request(`/media/${media.id}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });

    await persistenceApp.container
      .resolve(containerTokens.mediaProcessingService)
      .process(media.id);

    const read = await request(`/media/${media.id}`, {
      headers: owner.headers(),
    });
    await expect(readData<{ media: MediaView }>(read)).resolves.toMatchObject({
      media: {
        status: "rejected",
        url: null,
        rejectionReason: "Uploaded file could not be read as an image.",
      },
    });
  });

  it("attaches a processed image to a posting and refuses an unprocessed one", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const pending = await startUpload(owner.headers());
    const ready = await startUpload(owner.headers());
    await putBytes(ready.upload.uploadUrl, await createPngFixture(8, 8));
    await request(`/media/${ready.media.id}/complete`, {
      method: "POST",
      headers: owner.headers(),
    });
    await persistenceApp.container
      .resolve(containerTokens.mediaProcessingService)
      .process(ready.media.id);

    const refused = await request("/postings", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify(
        buildPostingBody([{ mediaId: pending.media.id, position: 0 }]),
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
        buildPostingBody([{ mediaId: ready.media.id, position: 0 }]),
      ),
    });
    expect(created.status).toBe(201);
    const posting = await readData<{
      photos: Array<{ blobName: string; blobUrl: string }>;
    }>(created);
    expect(posting.photos).toEqual([
      expect.objectContaining({
        blobName: `media/images/${owner.userId}/${ready.media.id}.webp`,
      }),
    ]);
  });

  it("hides one user's media from another and deletes it for its owner", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const otherUser = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const { media, upload } = await startUpload(owner.headers());
    await putBytes(upload.uploadUrl, await createPngFixture());

    const foreignRead = await request(`/media/${media.id}`, {
      headers: otherUser.headers(),
    });
    const foreignComplete = await request(`/media/${media.id}/complete`, {
      method: "POST",
      headers: otherUser.headers(),
    });
    const foreignDelete = await request(`/media/${media.id}`, {
      method: "DELETE",
      headers: otherUser.headers(),
    });
    expect(foreignRead.status).toBe(404);
    expect(foreignComplete.status).toBe(404);
    expect(foreignDelete.status).toBe(404);

    const deleted = await request(`/media/${media.id}`, {
      method: "DELETE",
      headers: owner.headers(),
    });
    expect(deleted.status).toBe(200);

    const afterDelete = await request(`/media/${media.id}`, {
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
      }),
    });
    expect(huge.status).toBe(413);
    await expect(huge.json()).resolves.toMatchObject({
      message: "Images must be 5 MB or smaller.",
      error: { code: "PAYLOAD_TOO_LARGE" },
    });

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
});
