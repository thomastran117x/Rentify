import { access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import BlobChangedError from "@/errors/blob-changed.error";
import { BlobService } from "@/features/blob/blob.service";
import BadRequestError from "@/errors/http/bad-request.error";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
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
const LOCAL_STORAGE_ROOT = path.resolve(process.cwd(), "tmp", "blob-storage");

function localBlobPath(container: string, blobName: string): string {
  return path.join(LOCAL_STORAGE_ROOT, container, ...blobName.split("/"));
}

interface FakeBlockBlobClient {
  container: string;
  blobName: string;
  url: string;
  getProperties: jest.Mock;
  deleteIfExists: jest.Mock;
  download: jest.Mock;
  uploadData: jest.Mock;
}

/**
 * Swaps the container factory for one that records which container each
 * operation reached, so routing can be checked without a storage account.
 */
function recordAzureContainers(
  service: BlobService,
  // Containers that answer 404 to every read.
  emptyContainers: string[] = [],
): FakeBlockBlobClient[] {
  const clients: FakeBlockBlobClient[] = [];
  const helper = service as unknown as {
    createContainerClient(container: string): unknown;
  };
  helper.createContainerClient = (container: string) => ({
    getBlockBlobClient: (blobName: string) => {
      const isEmpty = emptyContainers.includes(container);
      const notFound = () =>
        Promise.reject(
          Object.assign(new Error("BlobNotFound"), { statusCode: 404 }),
        );
      const client: FakeBlockBlobClient = {
        container,
        blobName,
        url: `https://fake/${container}/${blobName}`,
        getProperties: jest.fn(async () =>
          isEmpty ? notFound() : { etag: `"${container}"` },
        ),
        deleteIfExists: jest.fn(async () => undefined),
        download: jest.fn(async () =>
          isEmpty
            ? notFound()
            : {
                readableStreamBody: Readable.from([Buffer.from(container)]),
                contentType: "image/png",
              },
        ),
        uploadData: jest.fn(async () => undefined),
      };
      clients.push(client);
      return client;
    },
  });
  return clients;
}

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
    const blobName = service.buildQuarantineImageBlobName(
      USER_1_ID,
      testUuid(9000, 994264),
    );
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
    // The bytes sit in the quarantine root, which the public read never sees.
    await expect(
      access(localBlobPath("quarantine", blobName)),
    ).resolves.toBeUndefined();
    await expect(service.readPublicLocalBlob(blobName)).rejects.toThrow(
      ResourceNotFoundError,
    );
    expect(service.isManagedBlobUrl(uploadTarget.blobUrl, blobName)).toBe(
      false,
    );
  });

  it("only signs uploads for quarantine names", () => {
    useLocalBlobStorage();
    const local = new BlobService();
    useAzureBlobStorage();
    const azure = new BlobService();

    for (const service of [local, azure]) {
      expect(() =>
        service.createUploadUrl({
          blobName: `media/images/${USER_1_ID}/x.webp`,
          contentType: "image/webp",
        }),
      ).toThrow("Uploads may only target quarantine blobs.");
    }
  });

  // Storage is policy-free: which types may be uploaded is MediaService's call.
  it("applies only a generic content-type shape check when signing", () => {
    useLocalBlobStorage();

    const service = new BlobService();
    const blobName = `quarantine/images/${USER_1_ID}/file`;

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
      blobName: `quarantine/images/${USER_1_ID}/photo`,
      contentType: "image/jpeg",
      requestOrigin: "not-a-valid-origin",
    });

    expect(uploadTarget.uploadUrl).toContain("http://localhost:8040/");
  });

  it("signs Azure upload URLs against the quarantine container only", () => {
    useAzureBlobStorage();

    const service = new BlobService();
    const blobName = `quarantine/images/${USER_1_ID}/photo`;
    const uploadTarget = service.createUploadUrl({
      blobName,
      contentType: "image/webp",
    });

    expect(uploadTarget.container).toBe("uploads-quarantine");
    expect(uploadTarget.blobUrl).toBe(
      `https://rent.blob.core.windows.net/uploads-quarantine/${blobName}`,
    );
    expect(uploadTarget.uploadUrl.startsWith(`${uploadTarget.blobUrl}?`)).toBe(
      true,
    );
    expect(new URL(uploadTarget.uploadUrl).searchParams.get("sp")).toBe("cw");
  });

  it("routes Azure operations to a container by blob name", async () => {
    useAzureBlobStorage();
    const service = new BlobService();
    const clients = recordAzureContainers(service);
    const quarantined = `quarantine/images/${USER_1_ID}/upload`;
    const processed = `media/images/${USER_1_ID}/upload.webp`;

    for (const blobName of [quarantined, processed]) {
      await service.getProperties(blobName);
      await service.downloadBlob(blobName);
      await service.deleteBlob(blobName);
    }
    await service.uploadBuffer({
      blobName: processed,
      body: Buffer.from("webp"),
      contentType: "image/webp",
    });

    expect(
      clients.map((client) => [client.container, client.blobName]),
    ).toEqual([
      ["quarantine", quarantined],
      ["quarantine", quarantined],
      ["quarantine", quarantined],
      ["public", processed],
      ["public", processed],
      ["public", processed],
      ["public", processed],
    ]);
  });

  it("deletes from a named container when blob-cleanup asks for one", async () => {
    useAzureBlobStorage();
    const service = new BlobService();
    const clients = recordAzureContainers(service);
    const leftover = `quarantine/images/${USER_1_ID}/leftover`;

    await service.deleteBlob(leftover, "public");

    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({
      container: "public",
      blobName: leftover,
    });
    expect(clients[0]!.deleteIfExists).toHaveBeenCalledTimes(1);
  });

  it("deletes a local blob from a named root", async () => {
    useLocalBlobStorage();
    const service = new BlobService();
    const leftover = `quarantine/images/${USER_1_ID}/local-leftover`;
    const helper = service as unknown as {
      resolveLocalBlobPaths(
        blobName: string,
        container: string,
      ): { blobPath: string };
    };
    // Plant a quarantine name in the public root, as an old flat layout would.
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { blobPath } = helper.resolveLocalBlobPaths(leftover, "public");
    await mkdir(path.dirname(blobPath), { recursive: true });
    await writeFile(blobPath, "old");
    await writeFile(`${blobPath}.meta.json`, "{}");

    // The public read still refuses it by name.
    await expect(service.readPublicLocalBlob(leftover)).rejects.toThrow(
      ResourceNotFoundError,
    );
    await service.deleteBlob(leftover, "public");

    await expect(access(blobPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  describe("legacy quarantine fallback", () => {
    const upload = `quarantine/images/${USER_1_ID}/pre-split`;

    function azureService(fallback: boolean) {
      useAzureBlobStorage();
      process.env.MEDIA_QUARANTINE_LEGACY_FALLBACK = String(fallback);
      const service = new BlobService();
      const clients = recordAzureContainers(service, ["quarantine"]);
      return { service, clients };
    }

    it("reads a pre-split upload from the public container when enabled", async () => {
      const { service, clients } = azureService(true);

      const properties = await service.getProperties(upload);
      const download = await service.downloadBlob(upload, {
        ifMatch: properties.etag,
        maxBytes: 64,
      });

      expect(properties.etag).toBe('"public"');
      expect(download.body.toString()).toBe("public");
      expect(clients.map((client) => client.container)).toEqual([
        "quarantine",
        "public",
        "quarantine",
        "public",
      ]);
      // The conditional read goes to the same blob the properties came from.
      expect(clients[3]!.download).toHaveBeenCalledWith(0, 65, {
        conditions: { ifMatch: '"public"' },
      });
    });

    it("deletes a quarantine name from both locations when enabled", async () => {
      const { service, clients } = azureService(true);

      await service.deleteBlob(upload);
      // blob-cleanup names its container, so it never fans out.
      await service.deleteBlob(upload, "quarantine");

      expect(clients.map((client) => client.container)).toEqual([
        "quarantine",
        "public",
        "quarantine",
      ]);
    });

    it("looks only in the quarantine container when disabled", async () => {
      const { service, clients } = azureService(false);

      await expect(service.getProperties(upload)).rejects.toThrow(
        ResourceNotFoundError,
      );
      await expect(service.downloadBlob(upload)).rejects.toThrow(
        ResourceNotFoundError,
      );
      await service.deleteBlob(upload);

      expect(clients.map((client) => client.container)).toEqual([
        "quarantine",
        "quarantine",
        "quarantine",
      ]);
    });

    it("never falls back for public names or for other errors", async () => {
      useAzureBlobStorage();
      process.env.MEDIA_QUARANTINE_LEGACY_FALLBACK = "true";
      const service = new BlobService();
      const clients = recordAzureContainers(service, ["public"]);

      await expect(
        service.getProperties(`media/images/${USER_1_ID}/gone.webp`),
      ).rejects.toThrow(ResourceNotFoundError);
      expect(clients).toHaveLength(1);

      const helper = service as unknown as {
        createContainerClient(container: string): unknown;
      };
      const getProperties = jest.fn(async () =>
        Promise.reject(
          Object.assign(new Error("ServerBusy"), { statusCode: 503 }),
        ),
      );
      helper.createContainerClient = () => ({
        getBlockBlobClient: () => ({ getProperties }),
      });

      await expect(service.getProperties(upload)).rejects.toThrow("ServerBusy");
      expect(getProperties).toHaveBeenCalledTimes(1);
    });

    it("reads and deletes a pre-split local upload from the flat root", async () => {
      useLocalBlobStorage();
      process.env.MEDIA_QUARANTINE_LEGACY_FALLBACK = "true";
      const service = new BlobService();
      const name = `quarantine/images/${USER_1_ID}/local-pre-split`;
      const legacyPath = path.join(LOCAL_STORAGE_ROOT, ...name.split("/"));
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, "legacy");
      await writeFile(
        `${legacyPath}.meta.json`,
        JSON.stringify({ contentType: "image/png" }),
      );

      const properties = await service.getProperties(name);
      const download = await service.downloadBlob(name, {
        ifMatch: properties.etag,
        maxBytes: 64,
      });

      expect(properties.contentLength).toBe(6);
      expect(download).toEqual({
        body: Buffer.from("legacy"),
        contentType: "image/png",
      });

      await service.deleteBlob(name);
      await expect(access(legacyPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(service.getProperties(name)).rejects.toThrow(
        ResourceNotFoundError,
      );
    });

    it("ignores the flat root when disabled", async () => {
      useLocalBlobStorage();
      process.env.MEDIA_QUARANTINE_LEGACY_FALLBACK = "false";
      const service = new BlobService();
      const name = `quarantine/images/${USER_1_ID}/local-ignored`;
      const legacyPath = path.join(LOCAL_STORAGE_ROOT, ...name.split("/"));
      const { mkdir, rm, writeFile } = await import("node:fs/promises");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, "legacy");
      await writeFile(`${legacyPath}.meta.json`, "{}");

      try {
        await expect(service.getProperties(name)).rejects.toThrow(
          ResourceNotFoundError,
        );
        await expect(service.downloadBlob(name)).rejects.toThrow(
          ResourceNotFoundError,
        );
      } finally {
        await rm(legacyPath, { force: true });
        await rm(`${legacyPath}.meta.json`, { force: true });
      }
    });
  });

  it("names the real containers behind each route", () => {
    useAzureBlobStorage();
    const service = new BlobService();
    const helper = service as unknown as {
      createContainerClient(container: string): { containerName: string };
    };

    expect(helper.createContainerClient("public").containerName).toBe(
      "uploads",
    );
    expect(helper.createContainerClient("quarantine").containerName).toBe(
      "uploads-quarantine",
    );
    expect(service.getBlobUrl(`media/images/${USER_1_ID}/a.webp`)).toBe(
      `https://rent.blob.core.windows.net/uploads/media/images/${USER_1_ID}/a.webp`,
    );
  });

  it("never gives a quarantined blob a public URL", () => {
    useLocalBlobStorage();
    const local = new BlobService();
    useAzureBlobStorage();
    const azure = new BlobService();
    const blobName = `quarantine/images/${USER_1_ID}/upload`;
    const azureUrl = `https://rent.blob.core.windows.net/uploads/${blobName}`;

    for (const service of [local, azure]) {
      expect(() => service.getBlobUrl(blobName)).toThrow(BadRequestError);
      expect(() => service.getBlobUrl(" /Quarantine/images/x")).toThrow(
        BadRequestError,
      );
      expect(service.isManagedBlobUrl(azureUrl, blobName)).toBe(false);
    }
  });

  it("reads the owner back out of stored blob names", () => {
    useLocalBlobStorage();

    const service = new BlobService();

    // Names stored before media existed keep resolving their owner, including
    // under a nested scope and for their derived thumbnails.
    for (const blobName of [
      `general/${USER_1_ID}/1-a.png`,
      `postings/photos/${USER_1_ID}/1-a.webp`,
      service.buildPostingPhotoThumbnailBlobName(`postings/${USER_1_ID}/a.png`),
    ]) {
      expect(service.getBlobOwnerId(blobName)).toBe(USER_1_ID);
    }
    expect(service.getBlobOwnerId("general/file.png")).toBeNull();
    expect(service.getBlobOwnerId("thumbnails/file.webp")).toBeNull();
    expect(service.getBlobOwnerId("../escape/owner/file.png")).toBeNull();
  });

  it("names quarantined uploads and processed images by media id", () => {
    useLocalBlobStorage();

    const service = new BlobService();
    const mediaId = testUuid(9000, 994263);
    const quarantined = service.buildQuarantineImageBlobName(
      USER_1_ID,
      mediaId,
    );
    const processed = service.buildProcessedImageBlobName(USER_1_ID, mediaId);

    expect(quarantined).toBe(`quarantine/images/${USER_1_ID}/${mediaId}`);
    expect(processed).toBe(`media/images/${USER_1_ID}/${mediaId}.webp`);
    expect(service.getBlobOwnerId(quarantined)).toBe(USER_1_ID);
    expect(service.getBlobOwnerId(processed)).toBe(USER_1_ID);
    expect(
      service.getBlobOwnerId(
        service.buildPostingPhotoThumbnailBlobName(processed),
      ),
    ).toBe(USER_1_ID);

    expect(service.isQuarantineBlobName(quarantined)).toBe(true);
    expect(service.isQuarantineBlobName(" /Quarantine/x ")).toBe(true);
    expect(service.isQuarantineBlobName("quarantine")).toBe(true);
    expect(service.isQuarantineBlobName("media/../quarantine/x")).toBe(true);
    expect(service.isQuarantineBlobName(processed)).toBe(false);
    expect(service.isQuarantineBlobName("postings/quarantine/x.png")).toBe(
      false,
    );
    expect(service.isProcessedImageBlobName(processed)).toBe(true);
    expect(service.isProcessedImageBlobName(quarantined)).toBe(false);
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
    // Server-written blobs land in the public root, where /blob/file reads.
    await expect(
      access(localBlobPath("public", `postings/${USER_1_ID}/photo.png`)),
    ).resolves.toBeUndefined();
    await expect(
      service.readPublicLocalBlob(`postings/${USER_1_ID}/photo.png`),
    ).resolves.toMatchObject({ contentType: "image/png" });
    expect(
      service.buildPostingPhotoThumbnailBlobName(
        `postings/${USER_1_ID}/photo.png`,
      ),
    ).toBe(`postings/${USER_1_ID}/thumbnails/photo.webp`);
    expect(() => service.buildPostingPhotoThumbnailBlobName("/")).toThrow(
      BadRequestError,
    );
  });

  it("checks the ETag and the limit before reading a local blob", async () => {
    useLocalBlobStorage();

    const service = new BlobService();
    const blobName = `quarantine/images/${USER_1_ID}/conditional`;
    await service.writeLocalBlob(blobName, Buffer.alloc(16), "image/png");
    const { etag } = await service.getProperties(blobName);

    await expect(
      service.downloadBlob(blobName, { ifMatch: etag, maxBytes: 16 }),
    ).resolves.toMatchObject({ body: Buffer.alloc(16) });
    await expect(
      service.downloadBlob(blobName, { ifMatch: '"stale"' }),
    ).rejects.toThrow(BlobChangedError);
    await expect(
      service.downloadBlob(blobName, { maxBytes: 15 }),
    ).rejects.toThrow(PayloadTooLargeError);
    await expect(
      service.downloadBlob(`quarantine/images/${USER_1_ID}/missing`, {
        maxBytes: 15,
      }),
    ).rejects.toThrow(ResourceNotFoundError);
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
    expect(properties.etag).toMatch(/^"[0-9a-f]+-5"$/);

    // Rewriting the file changes the synthesized ETag.
    await service.writeLocalBlob(blobName, Buffer.from("123456"), "image/png");
    const rewritten = await service.getProperties(blobName);
    expect(rewritten.etag).not.toBe(properties.etag);
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
        etag: '"0x8DD1"',
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
      etag: '"0x8DD1"',
    });
    await expect(service.getProperties(blobName)).rejects.toThrow(
      ResourceNotFoundError,
    );
    await expect(service.getProperties(blobName)).rejects.toThrow("ServerBusy");
  });

  describe("Azure downloads", () => {
    function azureDownloadResponse(
      chunks: Buffer[],
      contentType: string | undefined = "image/png",
    ) {
      return { readableStreamBody: Readable.from(chunks), contentType };
    }

    function useAzureClient(download: jest.Mock) {
      useAzureBlobStorage();
      const service = new BlobService();
      const getProperties = jest.fn();
      const downloadToBuffer = jest.fn();
      const helper = service as unknown as {
        createBlobClient(blobName: string): unknown;
      };
      helper.createBlobClient = () => ({
        download,
        getProperties,
        downloadToBuffer,
      });
      return { service, getProperties, downloadToBuffer };
    }

    const blobName = `quarantine/images/${USER_1_ID}/upload`;

    it("downloads a whole blob in one request and maps a 404 to not found", async () => {
      const download = jest
        .fn()
        .mockResolvedValueOnce(
          azureDownloadResponse([Buffer.from("by"), Buffer.from("tes")]),
        )
        .mockRejectedValueOnce(
          Object.assign(new Error("BlobNotFound"), { statusCode: 404 }),
        )
        .mockRejectedValueOnce(
          Object.assign(new Error("ServerBusy"), { statusCode: 503 }),
        );
      const { service, getProperties, downloadToBuffer } =
        useAzureClient(download);

      await expect(service.downloadBlob(blobName)).resolves.toEqual({
        body: Buffer.from("bytes"),
        contentType: "image/png",
      });
      await expect(service.downloadBlob(blobName)).rejects.toThrow(
        ResourceNotFoundError,
      );
      await expect(service.downloadBlob(blobName)).rejects.toThrow(
        "ServerBusy",
      );
      expect(download).toHaveBeenNthCalledWith(1, 0, undefined, {
        conditions: undefined,
      });
      // The content type comes with the download; nothing else is requested.
      expect(getProperties).not.toHaveBeenCalled();
      expect(downloadToBuffer).not.toHaveBeenCalled();
    });

    it("asks for one byte past the limit, conditional on the ETag", async () => {
      const download = jest
        .fn()
        .mockResolvedValueOnce(azureDownloadResponse([Buffer.alloc(16)]));
      const { service } = useAzureClient(download);

      await expect(
        service.downloadBlob(blobName, { ifMatch: '"0x8DD1"', maxBytes: 16 }),
      ).resolves.toMatchObject({ body: Buffer.alloc(16) });
      expect(download).toHaveBeenCalledWith(0, 17, {
        conditions: { ifMatch: '"0x8DD1"' },
      });
    });

    it("stops reading once a blob passes the limit", async () => {
      // Endless: if the download read to the end, this test would never finish.
      async function* chunks() {
        for (;;) {
          yield Buffer.alloc(8);
        }
      }
      const stream = Readable.from(chunks());
      const download = jest.fn().mockResolvedValueOnce({
        readableStreamBody: stream,
        contentType: "image/png",
      });
      const { service } = useAzureClient(download);

      await expect(
        service.downloadBlob(blobName, { maxBytes: 12 }),
      ).rejects.toThrow(PayloadTooLargeError);
      expect(stream.destroyed).toBe(true);
    });

    it("reports a changed blob as BlobChangedError", async () => {
      const download = jest.fn().mockRejectedValueOnce(
        Object.assign(new Error("ConditionNotMet"), {
          statusCode: 412,
          code: "ConditionNotMet",
        }),
      );
      const { service } = useAzureClient(download);

      await expect(
        service.downloadBlob(blobName, { ifMatch: '"0x8DD1"', maxBytes: 16 }),
      ).rejects.toThrow(BlobChangedError);
    });

    it("reads an empty blob, whose range is unsatisfiable, as no bytes", async () => {
      const download = jest
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error("InvalidRange"), { statusCode: 416 }),
        )
        .mockResolvedValueOnce({ contentType: undefined });
      const { service } = useAzureClient(download);

      await expect(
        service.downloadBlob(blobName, { maxBytes: 16 }),
      ).resolves.toEqual({ body: Buffer.alloc(0) });
      await expect(service.downloadBlob(blobName)).resolves.toEqual({
        body: Buffer.alloc(0),
        contentType: undefined,
      });
    });
  });

  it("requires complete Azure configuration", () => {
    useAzureBlobStorage();
    delete process.env.AZURE_STORAGE_CONTAINER_NAME;

    expect(() => new BlobService()).toThrow(ServiceNotImplementedError);

    useAzureBlobStorage();
    delete process.env.AZURE_STORAGE_QUARANTINE_CONTAINER_NAME;

    expect(() => new BlobService()).toThrow(
      "Azure Blob Storage requires AZURE_STORAGE_CONNECTION_STRING, AZURE_STORAGE_CONTAINER_NAME, and AZURE_STORAGE_QUARANTINE_CONTAINER_NAME.",
    );
  });

  it("refuses a quarantine container that is the public container", () => {
    useAzureBlobStorage();
    process.env.AZURE_STORAGE_QUARANTINE_CONTAINER_NAME = " UPLOADS ";

    expect(() => new BlobService()).toThrow(
      "AZURE_STORAGE_QUARANTINE_CONTAINER_NAME must differ from AZURE_STORAGE_CONTAINER_NAME.",
    );
  });

  it("lists both Azure containers with the metadata needed by maintenance tools", async () => {
    useAzureBlobStorage();
    const service = new BlobService();
    const lastModified = new Date("2026-09-01T00:00:00.000Z");
    const helper = service as unknown as {
      createContainerClient(container: string): {
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
    // The public container also holds a quarantine/ leftover from before the
    // split, which is reported where it really is.
    const contents: Record<string, string[]> = {
      public: ["postings/user/photo.png", "quarantine/images/user/legacy"],
      quarantine: ["quarantine/images/user/upload"],
    };
    helper.createContainerClient = (container) => ({
      async *listBlobsFlat() {
        for (const name of contents[container] ?? []) {
          yield {
            name,
            properties: {
              contentType: "image/png",
              lastModified,
              contentLength: 42,
            },
          };
        }
      },
    });

    const blobs = [];
    for await (const blob of service.listAzureBlobs()) {
      blobs.push(blob);
    }

    const metadata = {
      contentType: "image/png",
      lastModified,
      contentLength: 42,
    };
    expect(blobs).toEqual([
      { name: "postings/user/photo.png", container: "public", ...metadata },
      {
        name: "quarantine/images/user/legacy",
        container: "public",
        ...metadata,
      },
      {
        name: "quarantine/images/user/upload",
        container: "quarantine",
        ...metadata,
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
