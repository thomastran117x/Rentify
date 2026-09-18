import { buildApiPath } from "@/configuration/http/api-path";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { createPngFixture } from "../../support/image-fixtures";

/**
 * Exercises the blob endpoints end to end over HTTP. Blob storage itself is a
 * third-party SDK, and the production service's local-disk fallback is
 * development-only, so the harness backs it with in-memory storage. The
 * upload is still issued, stored, read back, and deleted through the API.
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

  async function readData<TData>(response: Response): Promise<TData> {
    const body = (await response.json()) as { data: TData };
    return body.data;
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

  it("issues an upload URL, stores the upload, and serves it back", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const fixture = await createPngFixture();

    const uploadUrlResponse = await request("/blob/upload-url", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify({
        filename: "persistence-photo.png",
        contentType: "image/png",
        sizeBytes: fixture.byteLength,
        scope: "postings/photos",
      }),
    });
    expect(uploadUrlResponse.status).toBe(201);

    const uploadTarget = await readData<{
      uploadUrl: string;
      blobName: string;
      method: string;
    }>(uploadUrlResponse);
    expect(uploadTarget.blobName).toContain("persistence-photo");
    expect(uploadTarget.blobName.endsWith(".png")).toBe(true);

    // The issued URL points back at this same upload endpoint.
    const issuedUrl = new URL(uploadTarget.uploadUrl);
    expect(issuedUrl.pathname).toBe(buildApiPath("/blob/upload"));
    expect(issuedUrl.searchParams.get("blobName")).toBe(uploadTarget.blobName);

    const uploadResponse = await request(
      `/blob/upload?blobName=${encodeURIComponent(uploadTarget.blobName)}&expiresAt=${encodeURIComponent(issuedUrl.searchParams.get("expiresAt") ?? "")}&token=${encodeURIComponent(issuedUrl.searchParams.get("token") ?? "")}`,
      {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(fixture),
      },
    );
    expect(uploadResponse.status).toBe(201);

    const fileResponse = await request(
      `/blob/file?blobName=${encodeURIComponent(uploadTarget.blobName)}`,
    );
    expect(fileResponse.status).toBe(200);
    expect(Buffer.from(await fileResponse.arrayBuffer()).equals(fixture)).toBe(
      true,
    );

    const deleteResponse = await request(
      `/blob?blobName=${encodeURIComponent(uploadTarget.blobName)}`,
      { method: "DELETE", headers: owner.headers() },
    );
    expect(deleteResponse.status).toBe(200);

    const afterDeleteResponse = await request(
      `/blob/file?blobName=${encodeURIComponent(uploadTarget.blobName)}`,
    );
    expect(afterDeleteResponse.status).toBe(404);
  });

  it("refuses upload credentials for a non-image content type", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const response = await request("/blob/upload-url", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify({
        filename: "contract.pdf",
        contentType: "application/pdf",
        scope: "postings/photos",
      }),
    });

    expect(response.status).toBe(415);

    const body = (await response.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("refuses an upload whose bytes are not the declared image", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const uploadUrlResponse = await request("/blob/upload-url", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify({
        filename: "persistence-photo.png",
        contentType: "image/png",
        scope: "postings/photos",
      }),
    });
    expect(uploadUrlResponse.status).toBe(201);

    const uploadTarget = await readData<{
      uploadUrl: string;
      blobName: string;
    }>(uploadUrlResponse);
    const issuedUrl = new URL(uploadTarget.uploadUrl);

    const uploadResponse = await request(
      `/blob/upload?blobName=${encodeURIComponent(uploadTarget.blobName)}&expiresAt=${encodeURIComponent(issuedUrl.searchParams.get("expiresAt") ?? "")}&token=${encodeURIComponent(issuedUrl.searchParams.get("token") ?? "")}`,
      {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: "this is not a png",
      },
    );

    expect(uploadResponse.status).toBe(415);

    // Nothing was stored, so the blob is not readable afterwards.
    const fileResponse = await request(
      `/blob/file?blobName=${encodeURIComponent(uploadTarget.blobName)}`,
    );
    expect(fileResponse.status).toBe(404);
  });

  it("rejects an oversized declared size before issuing credentials", async () => {
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });

    const response = await request("/blob/upload-url", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify({
        filename: "huge.png",
        contentType: "image/png",
        sizeBytes: 50 * 1024 * 1024,
        scope: "postings/photos",
      }),
    });

    expect(response.status).toBe(413);
  });

  it("rejects an unauthenticated upload URL request", async () => {
    const response = await request("/blob/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "photo.png",
        contentType: "image/png",
      }),
    });

    expect(response.status).toBe(401);
  });
});
