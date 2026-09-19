import { BlobService } from "@/features/blob/blob.service";
import BadRequestError from "@/errors/http/bad-request.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import ServiceNotImplementedError from "@/errors/http/service-not-implemented.error";
import { testUuid } from "../../support/uuid";
import {
  readLocalUploadUrl,
  restoreBlobEnvironmentAfterEach,
  useAzureBlobStorage,
  useLocalBlobStorage,
} from "../../support/blob-environment";

const USER_1_ID = testUuid(9000, 994257);

restoreBlobEnvironmentAfterEach();

describe("BlobService", () => {
  it("keeps Azure uploads disabled outside development when no blob config is present", () => {
    process.env.NODE_ENV = "test";
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    const service = new BlobService();

    expect(service.isConfigured()).toBe(false);
    expect(() =>
      service.assertLocalUploadToken("general/a/b.png", "x", "y"),
    ).toThrow(ServiceNotImplementedError);
  });

  it("signs local upload URLs and round-trips the bytes written under them", async () => {
    useLocalBlobStorage();

    const service = new BlobService();
    const blobName = service.buildBlobName({
      ownerId: USER_1_ID,
      extension: ".png",
      scope: "postings",
    });
    const uploadTarget = service.createUploadUrl({
      blobName,
      contentType: "image/png",
      requestOrigin: "http://localhost:8040",
    });
    const signed = readLocalUploadUrl(uploadTarget.uploadUrl);

    expect(service.isConfigured()).toBe(true);
    expect(uploadTarget.blobName).toBe(blobName);
    expect(uploadTarget.blobUrl).toContain("/api/v1/blob/file?blobName=");
    expect(uploadTarget.headers["Content-Type"]).toBe("image/png");
    expect(signed.blobName).toBe(blobName);
    expect(() =>
      service.assertLocalUploadToken(
        signed.blobName,
        signed.expiresAt,
        signed.token,
      ),
    ).not.toThrow();

    await service.writeLocalBlob(blobName, Buffer.from("stored"), "image/png");
    const blob = await service.readLocalBlob(blobName);

    expect(blob.contentType).toBe("image/png");
    expect(blob.body.toString("utf8")).toBe("stored");
    expect(service.isManagedBlobUrl(uploadTarget.blobUrl, blobName)).toBe(true);
  });

  // Storage is policy-free: which types may be uploaded is MediaService's call.
  it("applies only a generic content-type shape check when signing", () => {
    useLocalBlobStorage();

    const service = new BlobService();
    const blobName = `general/${USER_1_ID}/file.bin`;

    expect(
      service.createUploadUrl({ blobName, contentType: " Application/PDF " })
        .headers["Content-Type"],
    ).toBe("application/pdf");
    expect(() =>
      service.createUploadUrl({
        blobName,
        contentType: "text/plain\r\nx-test: bad",
      }),
    ).toThrow(BadRequestError);
    expect(() =>
      service.createUploadUrl({
        blobName: "../escape.png",
        contentType: "a/b",
      }),
    ).toThrow(BadRequestError);
  });

  it("uses the local fallback origin when the request origin is invalid", () => {
    useLocalBlobStorage();

    const service = new BlobService();
    const uploadTarget = service.createUploadUrl({
      blobName: `general/${USER_1_ID}/photo.jpg`,
      contentType: "image/jpeg",
      requestOrigin: "not-a-valid-origin",
    });

    expect(uploadTarget.uploadUrl).toContain("http://localhost:8040/");
  });

  it("signs Azure upload URLs for the requested blob", () => {
    useAzureBlobStorage();

    const service = new BlobService();
    const blobName = `postings/${USER_1_ID}/photo.webp`;
    const uploadTarget = service.createUploadUrl({
      blobName,
      contentType: "image/webp",
    });

    expect(uploadTarget.container).toBe("uploads");
    expect(uploadTarget.blobUrl).toBe(
      `https://rent.blob.core.windows.net/uploads/${blobName}`,
    );
    expect(uploadTarget.uploadUrl.startsWith(`${uploadTarget.blobUrl}?`)).toBe(
      true,
    );
    expect(new URL(uploadTarget.uploadUrl).searchParams.get("sp")).toBe("cw");
  });

  it("builds owner-scoped blob names and reads the owner back out", () => {
    useLocalBlobStorage();

    const service = new BlobService();
    const defaultScoped = service.buildBlobName({
      ownerId: USER_1_ID,
      extension: ".png",
    });
    const nested = service.buildBlobName({
      ownerId: USER_1_ID,
      extension: ".webp",
      scope: " Postings/Photos ",
    });

    expect(defaultScoped).toMatch(
      new RegExp(`^general/${USER_1_ID}/\\d+-[0-9a-f-]+\\.png$`),
    );
    expect(nested.startsWith(`postings/photos/${USER_1_ID}/`)).toBe(true);
    expect(service.getBlobOwnerId(defaultScoped)).toBe(USER_1_ID);
    expect(service.getBlobOwnerId(nested)).toBe(USER_1_ID);
    expect(
      service.getBlobOwnerId(
        service.buildPostingPhotoThumbnailBlobName(defaultScoped),
      ),
    ).toBe(USER_1_ID);
    expect(
      service.getBlobOwnerId(
        service.buildPostingPhotoThumbnailBlobName(nested),
      ),
    ).toBe(USER_1_ID);
    expect(service.getBlobOwnerId("general/file.png")).toBeNull();
    expect(service.getBlobOwnerId("thumbnails/file.webp")).toBeNull();
    expect(service.getBlobOwnerId("../escape/owner/file.png")).toBeNull();
    expect(() =>
      service.buildBlobName({
        ownerId: USER_1_ID,
        extension: ".png",
        scope: "Invalid Scope",
      }),
    ).toThrow(BadRequestError);
  });

  it("rejects invalid and expired local upload tokens", () => {
    useLocalBlobStorage();

    const service = new BlobService();
    const blobName = `general/${USER_1_ID}/photo.png`;
    const helper = service as unknown as {
      signLocalUploadToken(blobName: string, expiresAt: string): string;
    };
    const expiredAt = new Date(Date.now() - 1000).toISOString();

    expect(() =>
      service.assertLocalUploadToken(
        blobName,
        expiredAt,
        helper.signLocalUploadToken(blobName, expiredAt),
      ),
    ).toThrow("Blob upload URL has expired.");
    expect(() =>
      service.assertLocalUploadToken(
        blobName,
        new Date(Date.now() + 60_000).toISOString(),
        "bad-token",
      ),
    ).toThrow("Blob upload token is invalid.");
  });

  // Load-bearing: uploadBuffer is the trusted server-side path used by
  // thumbnail generation, so it keeps the generic content-type check and still
  // accepts a buffer that is not really a decodable image.
  it("downloads local blobs, computes managed URLs, and derives thumbnail paths", async () => {
    useLocalBlobStorage();

    const service = new BlobService();
    const result = await service.uploadBuffer({
      blobName: `postings/${USER_1_ID}/photo.png`,
      body: Buffer.from("thumbnail-source"),
      contentType: "image/png",
    });
    const download = await service.downloadBlob(
      `postings/${USER_1_ID}/photo.png`,
    );

    expect(result.blobUrl).toBe(
      service.getBlobUrl(`postings/${USER_1_ID}/photo.png`),
    );
    expect(download.body.toString("utf8")).toBe("thumbnail-source");
    expect(download.contentType).toBe("image/png");
    expect(
      service.buildPostingPhotoThumbnailBlobName(
        `postings/${USER_1_ID}/photo.png`,
      ),
    ).toBe(`postings/${USER_1_ID}/thumbnails/photo.webp`);
    expect(() => service.buildPostingPhotoThumbnailBlobName("/")).toThrow(
      BadRequestError,
    );
  });

  it("rejects invalid local blob names and missing files", async () => {
    useLocalBlobStorage();

    const service = new BlobService();

    await expect(service.readLocalBlob("../escape.txt")).rejects.toThrow(
      BadRequestError,
    );
    await expect(service.readLocalBlob("missing/file.txt")).rejects.toThrow(
      ResourceNotFoundError,
    );
  });

  it("deletes local blobs, treating missing ones as no-ops", async () => {
    useLocalBlobStorage();

    const service = new BlobService();
    const blobName = `organizations/${USER_1_ID}/logo.png`;
    await service.uploadBuffer({
      blobName,
      body: Buffer.from("logo"),
      contentType: "image/png",
    });

    await service.deleteBlob(blobName);

    await expect(service.readLocalBlob(blobName)).rejects.toThrow(
      ResourceNotFoundError,
    );
    await expect(
      service.deleteBlob("missing/file.txt"),
    ).resolves.toBeUndefined();
    expect(
      service.isManagedBlobUrl("https://example.test/blob.png", blobName),
    ).toBe(false);
  });

  it("reads local blob properties and reports missing blobs", async () => {
    useLocalBlobStorage();

    const service = new BlobService();
    const blobName = `general/${USER_1_ID}/properties.png`;
    await service.writeLocalBlob(blobName, Buffer.from("12345"), "image/png");

    const properties = await service.getProperties(blobName);

    expect(properties.contentType).toBe("image/png");
    expect(properties.contentLength).toBe(5);
    // fs.stat builds its Date in Node's realm, so toBeInstanceOf(Date) fails.
    expect(properties.lastModified?.getTime()).toBeGreaterThan(0);
    await expect(
      service.getProperties(`general/${USER_1_ID}/missing.png`),
    ).rejects.toThrow(ResourceNotFoundError);
    await expect(service.getProperties("../escape.png")).rejects.toThrow(
      BadRequestError,
    );
  });

  it("reads Azure blob properties and maps a 404 to not found", async () => {
    useAzureBlobStorage();

    const service = new BlobService();
    const lastModified = new Date("2026-09-01T00:00:00.000Z");
    const getProperties = jest
      .fn()
      .mockResolvedValueOnce({
        contentType: "image/webp",
        contentLength: 42,
        lastModified,
        etag: "ignored",
      })
      .mockRejectedValueOnce(
        Object.assign(new Error("BlobNotFound"), { statusCode: 404 }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("ServerBusy"), { statusCode: 503 }),
      );
    const helper = service as unknown as {
      createBlobClient(blobName: string): { getProperties: jest.Mock };
    };
    helper.createBlobClient = () => ({ getProperties });
    const blobName = `postings/${USER_1_ID}/photo.webp`;

    await expect(service.getProperties(blobName)).resolves.toEqual({
      contentType: "image/webp",
      contentLength: 42,
      lastModified,
    });
    await expect(service.getProperties(blobName)).rejects.toThrow(
      ResourceNotFoundError,
    );
    await expect(service.getProperties(blobName)).rejects.toThrow("ServerBusy");
  });

  it("requires complete Azure configuration", () => {
    process.env.NODE_ENV = "test";
    process.env.AZURE_STORAGE_CONNECTION_STRING =
      "DefaultEndpointsProtocol=https;AccountName=rent;AccountKey=key";
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    expect(() => new BlobService()).toThrow(ServiceNotImplementedError);
  });

  it("lists Azure blobs with the metadata needed by maintenance tools", async () => {
    useAzureBlobStorage();
    const service = new BlobService();
    const lastModified = new Date("2026-09-01T00:00:00.000Z");
    const helper = service as unknown as {
      createContainerClient(): {
        listBlobsFlat(): AsyncIterable<{
          name: string;
          properties: {
            contentType?: string;
            lastModified?: Date;
            contentLength?: number;
          };
        }>;
      };
    };
    helper.createContainerClient = () => ({
      async *listBlobsFlat() {
        yield {
          name: "postings/user/photo.png",
          properties: {
            contentType: "image/png",
            lastModified,
            contentLength: 42,
          },
        };
      },
    });

    const blobs = [];
    for await (const blob of service.listAzureBlobs()) {
      blobs.push(blob);
    }

    expect(blobs).toEqual([
      {
        name: "postings/user/photo.png",
        contentType: "image/png",
        lastModified,
        contentLength: 42,
      },
    ]);
  });

  it("rejects Azure inventory when only local development storage is available", async () => {
    useLocalBlobStorage();
    const service = new BlobService();

    const consumeInventory = async () => {
      for await (const blob of service.listAzureBlobs()) {
        void blob;
      }
    };

    await expect(consumeInventory()).rejects.toThrow(
      ServiceNotImplementedError,
    );
  });
});
