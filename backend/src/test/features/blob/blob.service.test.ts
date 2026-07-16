import { BlobService } from "@/features/blob/blob.service";
import BadRequestError from "@/errors/http/bad-request.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import ServiceNotImplementedError from "@/errors/http/service-not-implemented.error";

const originalNodeEnv = process.env.NODE_ENV;
const originalAccessTokenSecret = process.env.ACCESS_TOKEN_SECRET;
const originalAzureConnectionString =
  process.env.AZURE_STORAGE_CONNECTION_STRING;
const originalAzureContainerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
const originalPort = process.env.PORT;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.ACCESS_TOKEN_SECRET = originalAccessTokenSecret;
  process.env.AZURE_STORAGE_CONNECTION_STRING = originalAzureConnectionString;
  process.env.AZURE_STORAGE_CONTAINER_NAME = originalAzureContainerName;
  process.env.PORT = originalPort;
});

describe("BlobService", () => {
  it("keeps Azure uploads disabled outside development when no blob config is present", () => {
    process.env.NODE_ENV = "test";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    const service = new BlobService();

    expect(service.isConfigured()).toBe(false);
  });

  it("supports local development uploads when Azure is not configured", async () => {
    process.env.NODE_ENV = "development";
    process.env.ACCESS_TOKEN_SECRET = "blob-test-secret";
    process.env.PORT = "8040";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    const service = new BlobService();
    const uploadTarget = service.createUploadUrl({
      userId: "user-1",
      filename: "photo.png",
      contentType: "image/png",
      scope: "postings",
      requestOrigin: "http://localhost:8040",
    });

    const uploadUrl = new URL(uploadTarget.uploadUrl);
    const blobName = uploadUrl.searchParams.get("blobName");
    const expiresAt = uploadUrl.searchParams.get("expiresAt");
    const token = uploadUrl.searchParams.get("token");

    expect(uploadTarget.blobUrl).toContain("/api/v1/blob/file?blobName=");
    expect(service.isConfigured()).toBe(true);
    expect(blobName).toBeTruthy();
    expect(expiresAt).toBeTruthy();
    expect(token).toBeTruthy();

    await service.uploadLocalBlob({
      blobName: blobName!,
      expiresAt: expiresAt!,
      token: token!,
      contentType: "image/png",
      body: Buffer.from("local-dev-image"),
    });

    const blob = await service.readLocalBlob(blobName!);

    expect(blob.contentType).toBe("image/png");
    expect(blob.body.toString("utf8")).toBe("local-dev-image");
    expect(service.isManagedBlobUrl(uploadTarget.blobUrl, blobName!)).toBe(
      true,
    );
  });

  it("uses the local fallback origin when the request origin is invalid", () => {
    process.env.NODE_ENV = "development";
    process.env.PORT = "8040";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    const service = new BlobService();
    const uploadTarget = service.createUploadUrl({
      userId: "user-1",
      filename: "photo.jpg",
      contentType: " image/jpeg ",
      requestOrigin: "not-a-valid-origin",
    });

    expect(uploadTarget.uploadUrl).toContain("http://localhost:8040/");
    expect(uploadTarget.headers["Content-Type"]).toBe("image/jpeg");
  });

  it("downloads local blobs, computes managed URLs, and derives thumbnail paths", async () => {
    process.env.NODE_ENV = "development";
    process.env.ACCESS_TOKEN_SECRET = "blob-test-secret";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    const service = new BlobService();
    const result = await service.uploadBuffer({
      blobName: "postings/user-1/photo.png",
      body: Buffer.from("thumbnail-source"),
      contentType: "image/png",
    });
    const download = await service.downloadBlob("postings/user-1/photo.png");

    expect(result.blobUrl).toBe(
      service.getBlobUrl("postings/user-1/photo.png"),
    );
    expect(download.body.toString("utf8")).toBe("thumbnail-source");
    expect(download.contentType).toBe("image/png");
    expect(
      service.buildPostingPhotoThumbnailBlobName("postings/user-1/photo.png"),
    ).toBe("postings/user-1/thumbnails/photo.webp");
  });

  it("rejects invalid scope, content types, upload tokens, and expired local uploads", async () => {
    process.env.NODE_ENV = "development";
    process.env.ACCESS_TOKEN_SECRET = "blob-test-secret";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    const service = new BlobService();
    const uploadTarget = service.createUploadUrl({
      userId: "user-1",
      filename: "photo.png",
      contentType: "image/png",
      requestOrigin: "http://localhost:8040",
    });
    const uploadUrl = new URL(uploadTarget.uploadUrl);
    const blobName = uploadUrl.searchParams.get("blobName")!;
    const token = uploadUrl.searchParams.get("token")!;

    expect(() =>
      service.createUploadUrl({
        userId: "user-1",
        filename: "photo.png",
        contentType: "text/plain\r\nx-test: bad",
      }),
    ).toThrow(BadRequestError);
    expect(() =>
      service.createUploadUrl({
        userId: "user-1",
        filename: "photo.png",
        contentType: "image/png",
        scope: "Invalid Scope",
      }),
    ).toThrow(BadRequestError);
    expect(() => service.buildPostingPhotoThumbnailBlobName("/")).toThrow(
      BadRequestError,
    );
    const helper = service as unknown as {
      signLocalUploadToken(blobName: string, expiresAt: string): string;
    };
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    await expect(
      service.uploadLocalBlob({
        blobName,
        expiresAt: expiredAt,
        token: helper.signLocalUploadToken(blobName, expiredAt),
        contentType: "image/png",
        body: Buffer.from("late"),
      }),
    ).rejects.toThrow("Blob upload URL has expired.");
    await expect(
      service.uploadLocalBlob({
        blobName,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        token: "bad-token",
        contentType: "image/png",
        body: Buffer.from("bad"),
      }),
    ).rejects.toThrow("Blob upload token is invalid.");
  });

  it("rejects invalid local blob names and missing files", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    const service = new BlobService();

    await expect(service.readLocalBlob("../escape.txt")).rejects.toThrow(
      BadRequestError,
    );
    await expect(service.readLocalBlob("missing/file.txt")).rejects.toThrow(
      ResourceNotFoundError,
    );
  });

  it("deletes staged blobs for the owning user in local development", async () => {
    process.env.NODE_ENV = "development";
    process.env.ACCESS_TOKEN_SECRET = "blob-test-secret";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    const service = new BlobService();
    await service.uploadBuffer({
      blobName: "organizations/user-1/logo.png",
      body: Buffer.from("logo"),
      contentType: "image/png",
    });

    await service.deleteBlobForUser("user-1", "organizations/user-1/logo.png");

    await expect(
      service.readLocalBlob("organizations/user-1/logo.png"),
    ).rejects.toThrow(ResourceNotFoundError);
  });

  it("rejects deleting blobs for another user", async () => {
    process.env.NODE_ENV = "development";
    process.env.ACCESS_TOKEN_SECRET = "blob-test-secret";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    const service = new BlobService();

    await expect(
      service.deleteBlobForUser("user-2", "organizations/user-1/logo.png"),
    ).rejects.toThrow(BadRequestError);
  });

  it("returns ownership checks as booleans instead of throwing", () => {
    process.env.NODE_ENV = "development";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    const service = new BlobService();

    expect(
      service.isBlobOwnedByUser("user-1", "organizations/user-1/logo.png"),
    ).toBe(true);
    expect(
      service.isBlobOwnedByUser("user-1", "organizations/user-2/logo.png"),
    ).toBe(false);
    expect(service.isBlobOwnedByUser("user-1", "../escape.txt")).toBe(false);
  });

  it("treats missing local blob deletes as no-ops and unmanaged urls as false", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    const service = new BlobService();

    await expect(service.deleteBlob("missing/file.txt")).resolves.toBeUndefined();
    expect(
      service.isManagedBlobUrl(
        "https://example.test/blob.png",
        "organizations/user-1/logo.png",
      ),
    ).toBe(false);
  });

  it("requires complete Azure configuration and validates SAS ttl configuration", () => {
    process.env.NODE_ENV = "test";
    process.env.AZURE_STORAGE_CONNECTION_STRING =
      "DefaultEndpointsProtocol=https;AccountName=rent;AccountKey=key";
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    expect(() => new BlobService()).toThrow(ServiceNotImplementedError);

    process.env.AZURE_STORAGE_CONTAINER_NAME = "uploads";
    process.env.AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS = "59";

    expect(() => new BlobService()).toThrow(ServiceNotImplementedError);

    delete process.env.AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS;
  });
});
