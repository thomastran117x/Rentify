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
    const issued = new URL(uploadUrl);
    return request(`/blob/upload${issued.search}`, {
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

  it("hides one user's media from another and deletes it for its owner", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const otherUser = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const { media, upload } = await startUpload(owner.headers());
    await putBytes(upload.uploadUrl, await createPngFixture());

    for (const [path, method] of [
      [`/media/${media.id}`, "GET"],
      [`/media/${media.id}/complete`, "POST"],
      [`/media/${media.id}`, "DELETE"],
    ] as const) {
      const response = await request(path, {
        method,
        headers: otherUser.headers(),
      });
      expect(response.status).toBe(404);
    }

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
