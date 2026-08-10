import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { BlobController } from "@/features/blob/blob.controller";
import {
  createJwtClaims,
  createRouteTestApp,
} from "../../support/integration-app";
import { bearerHeaders } from "../../support/route-request";

function createApp() {
  const blobService = {
    createUploadUrl: jest.fn((input: { filename: string; scope?: string }) => ({
      method: "PUT" as const,
      uploadUrl: "http://localhost/upload",
      expiresAt: "2026-06-30T00:00:00.000Z",
      blobName: `postings/${input.filename}`,
      blobUrl: `http://localhost/blob/postings/${input.filename}`,
      container: "rent",
      headers: {
        "x-ms-blob-type": "BlockBlob" as const,
        "content-type": "image/jpeg",
      },
      scope: input.scope,
    })),
    uploadLocalBlob: jest.fn(async () => undefined),
    readLocalBlob: jest.fn(async () => ({
      contentType: "text/plain",
      body: Buffer.from("hello"),
    })),
    deleteBlobForUser: jest.fn(async () => undefined),
  };

  const registry = new Map<unknown, unknown>([
    [containerTokens.blobController, new BlobController(blobService as never)],
    [
      containerTokens.tokenService,
      { verifyAccessToken: jest.fn(async () => createJwtClaims()) },
    ],
  ]);

  return { app: createRouteTestApp(registry), blobService };
}

describe("Blob routes integration", () => {
  it("creates an upload URL scoped to the signed-in user", async () => {
    const { app, blobService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/blob/upload-url")}`,
      {
        method: "POST",
        headers: bearerHeaders("user-token"),
        body: JSON.stringify({
          filename: "photo.jpg",
          contentType: "image/jpeg",
          scope: "postings/photos",
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(blobService.createUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        filename: "photo.jpg",
        contentType: "image/jpeg",
        scope: "postings/photos",
      }),
    );
  });

  it("accepts a local upload for a signed upload target", async () => {
    const { app, blobService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/blob/upload?blobName=postings/photo.jpg&expiresAt=2026-06-30T00:00:00.000Z&token=upload-token")}`,
      {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "hello",
      },
    );

    expect(response.status).toBe(201);
    expect(blobService.uploadLocalBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        blobName: "postings/photo.jpg",
        contentType: "text/plain",
      }),
    );
  });

  it("serves a stored local blob without authentication", async () => {
    const { app, blobService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/blob/file?blobName=postings/photo.jpg")}`,
    );

    expect(response.status).toBe(200);
    expect(blobService.readLocalBlob).toHaveBeenCalledWith(
      "postings/photo.jpg",
    );
  });

  it("deletes a blob on behalf of its owner", async () => {
    const { app, blobService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/blob?blobName=organizations/user-1/logo.png")}`,
      { method: "DELETE", headers: bearerHeaders("user-token") },
    );

    expect(response.status).toBe(200);
    expect(blobService.deleteBlobForUser).toHaveBeenCalledWith(
      "user-1",
      "organizations/user-1/logo.png",
    );
  });

  it("rejects an unauthenticated delete", async () => {
    const { app, blobService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/blob?blobName=organizations/user-1/logo.png")}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(401);
    expect(blobService.deleteBlobForUser).not.toHaveBeenCalled();
  });
});
