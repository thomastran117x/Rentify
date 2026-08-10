import { buildApiPath } from "@/configuration/http/api-path";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

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

    const uploadUrlResponse = await request("/blob/upload-url", {
      method: "POST",
      headers: owner.headers(),
      body: JSON.stringify({
        filename: "persistence-photo.txt",
        contentType: "text/plain",
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

    // The issued URL points back at this same upload endpoint.
    const issuedUrl = new URL(uploadTarget.uploadUrl);
    expect(issuedUrl.pathname).toBe(buildApiPath("/blob/upload"));
    expect(issuedUrl.searchParams.get("blobName")).toBe(uploadTarget.blobName);

    const uploadResponse = await request(
      `/blob/upload?blobName=${encodeURIComponent(uploadTarget.blobName)}&expiresAt=${encodeURIComponent(issuedUrl.searchParams.get("expiresAt") ?? "")}&token=${encodeURIComponent(issuedUrl.searchParams.get("token") ?? "")}`,
      {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "persisted blob body",
      },
    );
    expect(uploadResponse.status).toBe(201);

    const fileResponse = await request(
      `/blob/file?blobName=${encodeURIComponent(uploadTarget.blobName)}`,
    );
    expect(fileResponse.status).toBe(200);
    expect(await fileResponse.text()).toBe("persisted blob body");

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

  it("rejects an unauthenticated upload URL request", async () => {
    const response = await request("/blob/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "photo.txt",
        contentType: "text/plain",
      }),
    });

    expect(response.status).toBe(401);
  });
});
