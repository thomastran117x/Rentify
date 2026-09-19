import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import ServiceNotImplementedError from "@/errors/http/service-not-implemented.error";
import UnsupportedMediaTypeError from "@/errors/http/unsupported-media-type.error";
import { BlobService } from "@/features/blob/blob.service";
import type { MediaStatus } from "@/features/media/media.model";
import { MediaService } from "@/features/media/media.service";
import { InMemoryMediaRepository } from "../../support/in-memory-media-repository";
import { testUuid } from "../../support/uuid";
import {
  readLocalUploadUrl,
  restoreBlobEnvironmentAfterEach,
  useLocalBlobStorage,
} from "../../support/blob-environment";
import {
  createGifFixture,
  createJpegFixture,
  createPngFixture,
} from "../../support/image-fixtures";

const USER_1_ID = testUuid(9000, 994259);
const USER_2_ID = testUuid(9000, 994260);

restoreBlobEnvironmentAfterEach();

function createLocalMediaService(): {
  mediaService: MediaService;
  blobService: BlobService;
  mediaRepository: InMemoryMediaRepository;
  queue: { enqueueMediaProcessingJob: jest.Mock<Promise<void>, [string]> };
} {
  useLocalBlobStorage();
  const blobService = new BlobService();
  const mediaRepository = new InMemoryMediaRepository();
  const queue = {
    enqueueMediaProcessingJob: jest.fn(async (_mediaId: string) => undefined),
  };

  return {
    mediaService: new MediaService(
      blobService,
      mediaRepository.asRepository(),
      queue,
    ),
    blobService,
    mediaRepository,
    queue,
  };
}

describe("MediaService", () => {
  describe("createImageUpload", () => {
    it("issues owner-scoped upload credentials for an allowed image", () => {
      const { mediaService, blobService } = createLocalMediaService();

      const target = mediaService.createImageUpload({
        userId: USER_1_ID,
        filename: "photo.png",
        contentType: " image/png ",
        scope: "postings",
        requestOrigin: "http://localhost:8040",
      });

      expect(target.blobName.startsWith(`postings/${USER_1_ID}/`)).toBe(true);
      expect(target.headers["Content-Type"]).toBe("image/png");
      expect(blobService.getBlobOwnerId(target.blobName)).toBe(USER_1_ID);
    });

    it("refuses upload credentials for non-image content types", () => {
      const { mediaService } = createLocalMediaService();

      for (const contentType of [
        "application/pdf",
        "text/html",
        "application/octet-stream",
        "image/svg+xml",
        "image/gif",
        "text/plain\r\nx-test: bad",
      ]) {
        expect(() =>
          mediaService.createImageUpload({
            userId: USER_1_ID,
            filename: "document.pdf",
            contentType,
          }),
        ).toThrow(UnsupportedMediaTypeError);
      }
    });

    it("honours a narrowed allow-list and a declared size limit", () => {
      const { mediaService } = createLocalMediaService();
      process.env.ALLOWED_IMAGE_TYPES = "image/png";
      process.env.MAX_IMAGE_SIZE_BYTES = "1024";

      expect(() =>
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename: "photo.jpg",
          contentType: "image/jpeg",
        }),
      ).toThrow(UnsupportedMediaTypeError);
      expect(() =>
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename: "photo.png",
          contentType: "image/png",
          sizeBytes: 2048,
        }),
      ).toThrow(PayloadTooLargeError);
      expect(
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename: "photo.png",
          contentType: "image/png",
          sizeBytes: 512,
        }).blobName,
      ).toMatch(/\.png$/);
    });

    it("derives the stored extension from the content type, not the filename", () => {
      const { mediaService } = createLocalMediaService();
      const issue = (filename: string, contentType: string) =>
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename,
          contentType,
        }).blobName;

      // A .png filename carrying a JPEG must be stored as .jpg: the filename
      // extension is never treated as proof of format.
      expect(issue("photo.png", "image/jpeg")).toMatch(/\.jpg$/);
      // A filename with no extension at all still produces a correct one.
      expect(issue("screenshot", "image/webp")).toMatch(/\.webp$/);
      // A misleading double extension cannot smuggle one through either.
      expect(issue("payload.php.png", "image/png")).toMatch(/\.png$/);
    });

    it("rejects an invalid scope", () => {
      const { mediaService } = createLocalMediaService();

      expect(() =>
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename: "photo.png",
          contentType: "image/png",
          scope: "Invalid Scope",
        }),
      ).toThrow(BadRequestError);
    });
  });

  describe("completeImageUpload", () => {
    function issueUpload(mediaService: MediaService, contentType: string) {
      return readLocalUploadUrl(
        mediaService.createImageUpload({
          userId: USER_1_ID,
          filename: "photo",
          contentType,
        }).uploadUrl,
      );
    }

    it("stores a valid image under the issued name", async () => {
      const { mediaService, blobService } = createLocalMediaService();
      const upload = issueUpload(mediaService, "image/png");
      const fixture = await createPngFixture();

      await mediaService.completeImageUpload({
        ...upload,
        contentType: "image/png",
        body: fixture,
      });

      const stored = await blobService.readLocalBlob(upload.blobName);
      expect(stored.contentType).toBe("image/png");
      expect(stored.body.equals(fixture)).toBe(true);
    });

    it("validates the bytes of an upload, not just the declared type", async () => {
      const { mediaService } = createLocalMediaService();
      const pngUpload = issueUpload(mediaService, "image/png");

      // Bytes that are not an image at all.
      await expect(
        mediaService.completeImageUpload({
          ...pngUpload,
          contentType: "image/png",
          body: Buffer.from("not-an-image"),
        }),
      ).rejects.toThrow("Uploaded file could not be read as an image.");

      // A real image whose actual format contradicts the declared one.
      await expect(
        mediaService.completeImageUpload({
          ...pngUpload,
          contentType: "image/png",
          body: await createJpegFixture(),
        }),
      ).rejects.toThrow(
        "Uploaded file contents do not match the declared image type.",
      );

      // A format sharp can decode but the policy excludes.
      await expect(
        mediaService.completeImageUpload({
          ...pngUpload,
          contentType: "image/png",
          body: await createGifFixture(),
        }),
      ).rejects.toThrow(UnsupportedMediaTypeError);

      // A declared type the allow-list rejects outright.
      await expect(
        mediaService.completeImageUpload({
          ...pngUpload,
          contentType: "application/pdf",
          body: await createPngFixture(),
        }),
      ).rejects.toThrow(UnsupportedMediaTypeError);

      // A content type that disagrees with the URL the token was issued for.
      await expect(
        mediaService.completeImageUpload({
          ...pngUpload,
          contentType: "image/jpeg",
          body: await createJpegFixture(),
        }),
      ).rejects.toThrow(
        "Content type does not match the requested upload URL.",
      );
    });

    it("enforces size and dimension limits", async () => {
      const { mediaService } = createLocalMediaService();
      process.env.MAX_IMAGE_WIDTH = "16";
      process.env.MAX_IMAGE_HEIGHT = "16";
      const upload = {
        ...issueUpload(mediaService, "image/png"),
        contentType: "image/png",
      };

      await expect(
        mediaService.completeImageUpload({
          ...upload,
          body: await createPngFixture(64, 64),
        }),
      ).rejects.toThrow("Image dimensions exceed the allowed maximum.");

      const oversized = await createPngFixture(8, 8);
      process.env.MAX_IMAGE_SIZE_BYTES = String(oversized.byteLength - 1);

      await expect(
        mediaService.completeImageUpload({ ...upload, body: oversized }),
      ).rejects.toThrow(PayloadTooLargeError);
    });

    it("checks the upload token before inspecting the body", async () => {
      const { mediaService } = createLocalMediaService();
      const upload = issueUpload(mediaService, "image/png");

      await expect(
        mediaService.completeImageUpload({
          ...upload,
          token: "bad-token",
          contentType: "application/pdf",
          body: Buffer.from("not-an-image"),
        }),
      ).rejects.toThrow("Blob upload token is invalid.");
    });
  });

  describe("ownership", () => {
    it("deletes media for its owner only", async () => {
      const { mediaService, blobService } = createLocalMediaService();
      const blobName = `organizations/${USER_1_ID}/logo.png`;
      await blobService.uploadBuffer({
        blobName,
        body: Buffer.from("logo"),
        contentType: "image/png",
      });

      await expect(
        mediaService.deleteMedia(USER_2_ID, blobName),
      ).rejects.toThrow("Blob name is invalid.");
      await expect(
        mediaService.deleteMedia(USER_1_ID, "../escape.txt"),
      ).rejects.toThrow(BadRequestError);

      await mediaService.deleteMedia(USER_1_ID, blobName);

      await expect(blobService.readLocalBlob(blobName)).rejects.toThrow(
        ResourceNotFoundError,
      );
    });

    it("answers ownership checks as booleans", () => {
      const { mediaService } = createLocalMediaService();

      expect(
        mediaService.isOwnedBy(USER_1_ID, `organizations/${USER_1_ID}/a.png`),
      ).toBe(true);
      expect(
        mediaService.isOwnedBy(USER_1_ID, `postings/photos/${USER_1_ID}/a.png`),
      ).toBe(true);
      expect(
        mediaService.isOwnedBy(USER_1_ID, `organizations/${USER_2_ID}/a.png`),
      ).toBe(false);
      // A generated thumbnail belongs to whoever owns the original photo.
      expect(
        mediaService.isOwnedBy(
          USER_1_ID,
          `postings/${USER_1_ID}/thumbnails/a.webp`,
        ),
      ).toBe(true);
      expect(mediaService.isOwnedBy(USER_1_ID, "../escape.txt")).toBe(false);
      expect(() =>
        mediaService.assertOwnedBy(USER_1_ID, `general/${USER_2_ID}/a.png`),
      ).toThrow(BadRequestError);
    });
  });

  it("describes stored media from its blob properties", async () => {
    const { mediaService, blobService } = createLocalMediaService();
    const blobName = `postings/${USER_1_ID}/described.png`;
    await blobService.writeLocalBlob(blobName, Buffer.from("png"), "image/png");

    const media = await mediaService.getMedia(blobName);

    expect(media).toEqual({
      blobName,
      blobUrl: blobService.getBlobUrl(blobName),
      ownerId: USER_1_ID,
      contentType: "image/png",
      sizeBytes: 3,
      lastModified: expect.anything(),
    });
    expect(media.lastModified?.getTime()).toBeGreaterThan(0);
    await expect(
      mediaService.getMedia(`postings/${USER_1_ID}/missing.png`),
    ).rejects.toThrow(ResourceNotFoundError);
  });

  it("reports absent blob properties as null", async () => {
    const blobService = {
      getProperties: jest.fn(async () => ({})),
      getBlobUrl: jest.fn(() => "https://storage.test/general/file.png"),
      getBlobOwnerId: jest.fn(() => null),
    };
    const mediaService = new MediaService(
      blobService as unknown as BlobService,
      new InMemoryMediaRepository().asRepository(),
      { enqueueMediaProcessingJob: jest.fn() },
    );

    await expect(mediaService.getMedia("general/file.png")).resolves.toEqual({
      blobName: "general/file.png",
      blobUrl: "https://storage.test/general/file.png",
      ownerId: null,
      contentType: null,
      sizeBytes: null,
      lastModified: null,
    });
  });

  it("reports storage availability and managed URLs from BlobService", () => {
    const { mediaService, blobService } = createLocalMediaService();
    const blobName = `general/${USER_1_ID}/a.png`;

    expect(mediaService.isConfigured()).toBe(true);
    expect(
      mediaService.isManagedUrl(blobService.getBlobUrl(blobName), blobName),
    ).toBe(true);
    expect(
      mediaService.isManagedUrl("https://example.test/a.png", blobName),
    ).toBe(false);
  });

  describe("media uploads", () => {
    async function startUpload(
      mediaService: MediaService,
      overrides: Partial<{ contentType: string; scope: string }> = {},
    ) {
      return mediaService.createMediaUpload({
        userId: USER_1_ID,
        filename: "photo.png",
        contentType: overrides.contentType ?? "image/png",
        scope: overrides.scope ?? "postings",
        requestOrigin: "http://localhost:8040",
      });
    }

    async function uploadBytes(
      mediaService: MediaService,
      uploadUrl: string,
      body: Buffer,
    ) {
      await mediaService.completeImageUpload({
        ...readLocalUploadUrl(uploadUrl),
        contentType: "image/png",
        body,
      });
    }

    it("records the upload in quarantine before signing a credential", async () => {
      const { mediaService, mediaRepository } = createLocalMediaService();

      const result = await startUpload(mediaService, { scope: " Postings " });
      const record = await mediaRepository.findById(result.media.id);

      expect(record).toMatchObject({
        userId: USER_1_ID,
        status: "pending_upload",
        scope: "postings",
        declaredContentType: "image/png",
        originalFilename: "photo.png",
        originalBlobName: `quarantine/images/${USER_1_ID}/${result.media.id}`,
      });
      expect(readLocalUploadUrl(result.upload.uploadUrl).blobName).toBe(
        record?.originalBlobName,
      );
      expect(result.media).toMatchObject({
        status: "pending_upload",
        url: null,
      });
      // Nothing returned may address the quarantined bytes.
      expect(Object.keys(result.upload).sort()).toEqual([
        "expiresAt",
        "headers",
        "method",
        "uploadUrl",
      ]);
      expect(JSON.stringify(result.media)).not.toContain("quarantine");
    });

    it("defaults the scope and records nothing for a refused upload", async () => {
      const { mediaService, mediaRepository } = createLocalMediaService();

      const result = await mediaService.createMediaUpload({
        userId: USER_1_ID,
        filename: "  ",
        contentType: "image/jpeg",
      });

      expect(result.media.scope).toBe("general");
      expect(
        (await mediaRepository.findById(result.media.id))?.originalFilename,
      ).toBeNull();

      await expect(
        startUpload(mediaService, { contentType: "application/pdf" }),
      ).rejects.toThrow(UnsupportedMediaTypeError);
      process.env.MAX_IMAGE_SIZE_BYTES = "10";
      await expect(
        mediaService.createMediaUpload({
          userId: USER_1_ID,
          filename: "big.png",
          contentType: "image/png",
          sizeBytes: 11,
        }),
      ).rejects.toThrow(PayloadTooLargeError);
      expect(mediaRepository.rows.size).toBe(1);
    });

    it("refuses uploads when no storage is configured", async () => {
      process.env.NODE_ENV = "test";
      delete process.env.AZURE_STORAGE_CONNECTION_STRING;
      delete process.env.AZURE_STORAGE_CONTAINER_NAME;
      const mediaRepository = new InMemoryMediaRepository();
      const mediaService = new MediaService(
        new BlobService(),
        mediaRepository.asRepository(),
        { enqueueMediaProcessingJob: jest.fn() },
      );

      await expect(startUpload(mediaService)).rejects.toThrow(
        ServiceNotImplementedError,
      );
      expect(mediaRepository.rows.size).toBe(0);
    });

    it("queues processing once the bytes have arrived", async () => {
      const { mediaService, mediaRepository, queue } =
        createLocalMediaService();
      const { media, upload } = await startUpload(mediaService);

      await expect(
        mediaService.completeMediaUpload(USER_1_ID, media.id),
      ).rejects.toThrow(ConflictError);
      expect(queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();

      // Bytes are not validated on arrival: that is the worker's job, on both
      // storage paths.
      const body = Buffer.from("not-validated-yet");
      await uploadBytes(mediaService, upload.uploadUrl, body);

      const completed = await mediaService.completeMediaUpload(
        USER_1_ID,
        media.id,
      );

      expect(completed).toMatchObject({
        status: "uploaded",
        sizeBytes: body.byteLength,
        url: null,
      });
      expect(queue.enqueueMediaProcessingJob).toHaveBeenCalledWith(media.id);

      // Repeating it reports the current state without queueing again.
      await expect(
        mediaService.completeMediaUpload(USER_1_ID, media.id),
      ).resolves.toMatchObject({ status: "uploaded" });
      expect(queue.enqueueMediaProcessingJob).toHaveBeenCalledTimes(1);
      expect((await mediaRepository.findById(media.id))?.status).toBe(
        "uploaded",
      );
    });

    it("re-queues an upload whose processing job was lost", async () => {
      const { mediaService, mediaRepository, queue } =
        createLocalMediaService();
      const { media } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(media.id))!;
      mediaRepository.put({
        ...record,
        status: "uploaded",
        updatedAt: new Date(Date.now() - 5 * 60 * 1000),
      });

      await mediaService.completeMediaUpload(USER_1_ID, media.id);

      expect(queue.enqueueMediaProcessingJob).toHaveBeenCalledWith(media.id);
    });

    it("rejects an upload whose stored bytes are over the limit", async () => {
      const { mediaService, mediaRepository, blobService, queue } =
        createLocalMediaService();
      const { media } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(media.id))!;
      // Written directly, as an Azure PUT would be: nothing checked it.
      await blobService.writeLocalBlob(
        record.originalBlobName,
        Buffer.alloc(64),
        "image/png",
      );
      process.env.MAX_IMAGE_SIZE_BYTES = "32";

      await expect(
        mediaService.completeMediaUpload(USER_1_ID, media.id),
      ).rejects.toThrow(PayloadTooLargeError);

      expect(await mediaRepository.findById(media.id)).toMatchObject({
        status: "rejected",
        rejectionReason: "Images must be 32 bytes or smaller.",
      });
      await expect(
        blobService.readLocalBlob(record.originalBlobName),
      ).rejects.toThrow(ResourceNotFoundError);
      expect(queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();
    });

    it("accepts a local upload only while the media awaits its bytes", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { media, upload } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(media.id))!;

      await uploadBytes(mediaService, upload.uploadUrl, Buffer.from("bytes"));

      // Stored under the declared type, whatever header the PUT carried.
      await expect(
        blobService.readLocalBlob(record.originalBlobName),
      ).resolves.toMatchObject({ contentType: "image/png" });

      await mediaService.completeMediaUpload(USER_1_ID, media.id);

      await expect(
        uploadBytes(mediaService, upload.uploadUrl, Buffer.from("again")),
      ).rejects.toThrow("Blob upload URL is no longer valid.");

      process.env.MAX_IMAGE_SIZE_BYTES = "4";
      const second = await startUpload(mediaService);
      await expect(
        uploadBytes(mediaService, second.upload.uploadUrl, Buffer.alloc(5)),
      ).rejects.toThrow(PayloadTooLargeError);
    });

    it("hides another user's media", async () => {
      const { mediaService } = createLocalMediaService();
      const { media } = await startUpload(mediaService);

      await expect(
        mediaService.getMediaView(USER_2_ID, media.id),
      ).rejects.toThrow(ResourceNotFoundError);
      await expect(
        mediaService.completeMediaUpload(USER_2_ID, media.id),
      ).rejects.toThrow(ResourceNotFoundError);
      await expect(
        mediaService.deleteMediaById(USER_2_ID, media.id),
      ).rejects.toThrow(ResourceNotFoundError);
      await expect(
        mediaService.getMediaView(USER_1_ID, media.id),
      ).resolves.toMatchObject({ id: media.id });
    });

    it("exposes a URL only for the processed image of a ready media", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { media } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(media.id))!;
      const processedBlobName = blobService.buildProcessedImageBlobName(
        USER_1_ID,
        media.id,
      );

      mediaRepository.put({ ...record, status: "processing" });
      await expect(
        mediaService.getMediaView(USER_1_ID, media.id),
      ).resolves.toMatchObject({ status: "processing", url: null });

      mediaRepository.put({
        ...record,
        status: "ready",
        processedBlobName,
        detectedContentType: "image/png",
        width: 8,
        height: 8,
      });

      await expect(
        mediaService.getMediaView(USER_1_ID, media.id),
      ).resolves.toMatchObject({
        status: "ready",
        url: blobService.getBlobUrl(processedBlobName),
        width: 8,
        height: 8,
      });
    });

    it("deletes a media item with both of its blobs", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { media, upload } = await startUpload(mediaService);
      await uploadBytes(mediaService, upload.uploadUrl, Buffer.from("bytes"));
      const record = (await mediaRepository.findById(media.id))!;
      const processedBlobName = blobService.buildProcessedImageBlobName(
        USER_1_ID,
        media.id,
      );
      await blobService.writeLocalBlob(
        processedBlobName,
        Buffer.from("webp"),
        "image/webp",
      );
      mediaRepository.put({ ...record, status: "ready", processedBlobName });

      await mediaService.deleteMediaById(USER_1_ID, media.id);

      expect(await mediaRepository.findById(media.id)).toBeNull();
      for (const blobName of [record.originalBlobName, processedBlobName]) {
        await expect(blobService.readLocalBlob(blobName)).rejects.toThrow(
          ResourceNotFoundError,
        );
      }
    });

    it("drops the media record when its processed image is deleted by name", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { media } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(media.id))!;
      const processedBlobName = blobService.buildProcessedImageBlobName(
        USER_1_ID,
        media.id,
      );
      mediaRepository.put({ ...record, status: "ready", processedBlobName });

      await mediaService.deleteMedia(USER_1_ID, processedBlobName);

      expect(await mediaRepository.findById(media.id)).toBeNull();
    });
  });

  describe("resolveAttachableImage", () => {
    async function mediaIn(
      status: MediaStatus,
      overrides: Partial<{ scope: string; rejectionReason: string }> = {},
    ) {
      const context = createLocalMediaService();
      const { media } = await context.mediaService.createMediaUpload({
        userId: USER_1_ID,
        filename: "logo.png",
        contentType: "image/png",
        scope: overrides.scope ?? "organizations",
      });
      const record = (await context.mediaRepository.findById(media.id))!;
      const processedBlobName = context.blobService.buildProcessedImageBlobName(
        USER_1_ID,
        media.id,
      );
      context.mediaRepository.put({
        ...record,
        status,
        processedBlobName: status === "ready" ? processedBlobName : null,
        rejectionReason: overrides.rejectionReason ?? null,
      });

      return { ...context, mediaId: media.id, processedBlobName };
    }

    it("resolves a ready image owned by the user to its processed blob", async () => {
      const { mediaService, blobService, mediaId, processedBlobName } =
        await mediaIn("ready");

      await expect(
        mediaService.resolveAttachableImage(USER_1_ID, mediaId, {
          scope: "organizations",
        }),
      ).resolves.toEqual({
        blobName: processedBlobName,
        blobUrl: blobService.getBlobUrl(processedBlobName),
      });
    });

    it("refuses media that is missing, foreign, unfinished, rejected, or out of scope", async () => {
      const ready = await mediaIn("ready");

      await expect(
        ready.mediaService.resolveAttachableImage(
          USER_1_ID,
          testUuid(9000, 994261),
        ),
      ).rejects.toThrow("Image is not available.");
      await expect(
        ready.mediaService.resolveAttachableImage(USER_2_ID, ready.mediaId),
      ).rejects.toThrow("Image is not available.");
      await expect(
        ready.mediaService.resolveAttachableImage(USER_1_ID, ready.mediaId, {
          scope: "postings",
        }),
      ).rejects.toThrow("Image was not uploaded for postings.");

      for (const status of [
        "pending_upload",
        "uploaded",
        "processing",
      ] as const) {
        const pending = await mediaIn(status);
        await expect(
          pending.mediaService.resolveAttachableImage(
            USER_1_ID,
            pending.mediaId,
          ),
        ).rejects.toThrow("Image is still processing.");
      }

      const rejected = await mediaIn("rejected", {
        rejectionReason: "Uploaded file could not be read as an image.",
      });
      await expect(
        rejected.mediaService.resolveAttachableImage(
          USER_1_ID,
          rejected.mediaId,
        ),
      ).rejects.toThrow(
        "Image was rejected: Uploaded file could not be read as an image.",
      );

      const rejectedWithoutReason = await mediaIn("rejected");
      await expect(
        rejectedWithoutReason.mediaService.resolveAttachableImage(
          USER_1_ID,
          rejectedWithoutReason.mediaId,
        ),
      ).rejects.toThrow(BadRequestError);
    });
  });

  it("never treats a quarantined blob as a managed reference", () => {
    const { mediaService, blobService } = createLocalMediaService();
    const blobName = blobService.buildQuarantineImageBlobName(
      USER_1_ID,
      testUuid(9000, 994262),
    );

    expect(
      mediaService.isManagedUrl(blobService.getBlobUrl(blobName), blobName),
    ).toBe(false);
    expect(mediaService.isOwnedBy(USER_1_ID, blobName)).toBe(true);
  });
});
