import { BlobService } from "@/features/blob/blob.service";

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
});
