import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import ServiceNotImplementedError from "@/errors/http/service-not-implemented.error";
import UnsupportedMediaTypeError from "@/errors/http/unsupported-media-type.error";
import { BlobService } from "@/features/blob/blob.service";
import type { MediaScope, MediaStatus } from "@/features/media/media.model";
import { MediaService } from "@/features/media/media.service";
import { InMemoryMediaRepository } from "../../support/in-memory-media-repository";
import { testUuid } from "../../support/uuid";
import {
  readLocalUploadUrl,
  restoreBlobEnvironmentAfterEach,
  useLocalBlobStorage,
} from "../../support/blob-environment";
import { createPngFixture } from "../../support/image-fixtures";

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
  describe("createMediaUpload allow-list", () => {
    it("refuses upload credentials for non-image content types", async () => {
      const { mediaService, mediaRepository } = createLocalMediaService();

      for (const contentType of [
        "application/pdf",
        "text/html",
        "application/octet-stream",
        "image/svg+xml",
        "image/gif",
        "text/plain\r\nx-test: bad",
      ]) {
        await expect(
          mediaService.createMediaUpload({
            userId: USER_1_ID,
            filename: "document.pdf",
            contentType,
            scope: "postings",
          }),
        ).rejects.toThrow(UnsupportedMediaTypeError);
      }
      expect(mediaRepository.rows.size).toBe(0);
    });

    it("honours a narrowed allow-list", async () => {
      const { mediaService } = createLocalMediaService();
      process.env.ALLOWED_IMAGE_TYPES = "image/png";

      await expect(
        mediaService.createMediaUpload({
          userId: USER_1_ID,
          filename: "photo.jpg",
          contentType: "image/jpeg",
          scope: "postings",
        }),
      ).rejects.toThrow(UnsupportedMediaTypeError);
      await expect(
        mediaService.createMediaUpload({
          userId: USER_1_ID,
          filename: "photo.png",
          contentType: "image/png",
          scope: "postings",
        }),
      ).resolves.toMatchObject({ mediaId: expect.any(String) });
    });

    it("never derives anything from the client's filename", async () => {
      const { mediaService, mediaRepository } = createLocalMediaService();

      const { mediaId } = await mediaService.createMediaUpload({
        userId: USER_1_ID,
        filename: "../../photo.png.exe",
        contentType: "image/jpeg",
        scope: "postings",
      });

      expect(await mediaRepository.findById(mediaId)).toMatchObject({
        originalBlobName: `quarantine/images/${USER_1_ID}/${mediaId}`,
        declaredContentType: "image/jpeg",
        originalFilename: "../../photo.png.exe",
      });
    });
  });

  describe("receiveLocalUploadBytes", () => {
    it("checks the upload token before anything else", async () => {
      const { mediaService } = createLocalMediaService();
      const { upload } = await mediaService.createMediaUpload({
        userId: USER_1_ID,
        filename: "photo.png",
        contentType: "image/png",
        scope: "postings",
      });

      await expect(
        mediaService.receiveLocalUploadBytes({
          ...readLocalUploadUrl(upload.url),
          token: "bad-token",
          contentType: "application/pdf",
          body: Buffer.from("not-an-image"),
        }),
      ).rejects.toThrow("Blob upload token is invalid.");
    });

    it("only accepts uploads for a quarantine name with a media record", async () => {
      const { mediaService, blobService } = createLocalMediaService();
      const helper = blobService as unknown as {
        signLocalUploadToken(blobName: string, expiresAt: string): string;
      };
      const expiresAt = new Date(Date.now() + 60_000).toISOString();

      for (const blobName of [
        `postings/${USER_1_ID}/direct.png`,
        blobService.buildQuarantineImageBlobName(
          USER_1_ID,
          testUuid(9000, 994265),
        ),
      ]) {
        await expect(
          mediaService.receiveLocalUploadBytes({
            blobName,
            expiresAt,
            token: helper.signLocalUploadToken(blobName, expiresAt),
            contentType: "image/png",
            body: await createPngFixture(),
          }),
        ).rejects.toThrow("Blob upload URL is no longer valid.");
      }
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
        mediaService.deleteReplacedImageByBlobName(USER_2_ID, blobName),
      ).rejects.toThrow("Blob name is invalid.");
      await expect(
        mediaService.deleteReplacedImageByBlobName(USER_1_ID, "../escape.txt"),
      ).rejects.toThrow(BadRequestError);

      await mediaService.deleteReplacedImageByBlobName(USER_1_ID, blobName);

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
      overrides: Partial<{ contentType: string; scope: MediaScope }> = {},
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
      await mediaService.receiveLocalUploadBytes({
        ...readLocalUploadUrl(uploadUrl),
        contentType: "image/png",
        body,
      });
    }

    it("records the upload in quarantine before signing a credential", async () => {
      const { mediaService, mediaRepository } = createLocalMediaService();

      const result = await startUpload(mediaService, {
        scope: "organizations",
      });
      const record = await mediaRepository.findById(result.mediaId);

      expect(record).toMatchObject({
        userId: USER_1_ID,
        status: "pending_upload",
        scope: "organizations",
        declaredContentType: "image/png",
        originalFilename: "photo.png",
        originalBlobName: `quarantine/images/${USER_1_ID}/${result.mediaId}`,
      });
      expect(readLocalUploadUrl(result.upload.url).blobName).toBe(
        record?.originalBlobName,
      );
      // Only the id and a write-only upload target: no media view, and nothing
      // that could be rendered or that addresses the quarantined bytes to read.
      expect(Object.keys(result).sort()).toEqual(["mediaId", "upload"]);
      expect(Object.keys(result.upload).sort()).toEqual([
        "expiresAt",
        "headers",
        "method",
        "url",
      ]);
      expect(result.upload.method).toBe("PUT");
      expect(result.upload.headers).toEqual({
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": "image/png",
      });
      expect(
        JSON.stringify({ ...result, upload: { ...result.upload, url: "" } }),
      ).not.toContain("quarantine");
      await expect(
        mediaService.getMediaView(USER_1_ID, result.mediaId),
      ).resolves.toMatchObject({ status: "pending_upload", url: null });
    });

    it("records nothing for a refused upload", async () => {
      const { mediaService, mediaRepository } = createLocalMediaService();

      const result = await mediaService.createMediaUpload({
        userId: USER_1_ID,
        filename: "  ",
        contentType: "image/jpeg",
        scope: "postings",
      });

      const record = await mediaRepository.findById(result.mediaId);
      expect(record?.scope).toBe("postings");
      expect(record?.originalFilename).toBeNull();

      await expect(
        startUpload(mediaService, { contentType: "application/pdf" }),
      ).rejects.toThrow(UnsupportedMediaTypeError);
      process.env.MAX_IMAGE_SIZE_BYTES = "10";
      await expect(
        mediaService.createMediaUpload({
          userId: USER_1_ID,
          filename: "big.png",
          contentType: "image/png",
          scope: "postings",
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
      const { mediaId, upload } = await startUpload(mediaService);

      await expect(
        mediaService.completeMediaUpload(USER_1_ID, mediaId),
      ).rejects.toThrow(ConflictError);
      expect(queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();

      // Bytes are not validated on arrival: that is the worker's job, on both
      // storage paths.
      const body = Buffer.from("not-validated-yet");
      await uploadBytes(mediaService, upload.url, body);

      const completed = await mediaService.completeMediaUpload(
        USER_1_ID,
        mediaId,
      );

      expect(completed).toMatchObject({
        status: "uploaded",
        sizeBytes: body.byteLength,
        url: null,
      });
      expect(queue.enqueueMediaProcessingJob).toHaveBeenCalledWith(mediaId);

      // Repeating it reports the current state without queueing again.
      await expect(
        mediaService.completeMediaUpload(USER_1_ID, mediaId),
      ).resolves.toMatchObject({ status: "uploaded" });
      expect(queue.enqueueMediaProcessingJob).toHaveBeenCalledTimes(1);
      expect((await mediaRepository.findById(mediaId))?.status).toBe(
        "uploaded",
      );
    });

    it("re-queues an upload whose processing job was lost", async () => {
      const { mediaService, mediaRepository, queue } =
        createLocalMediaService();
      const { mediaId } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(mediaId))!;
      mediaRepository.put({
        ...record,
        status: "uploaded",
        updatedAt: new Date(Date.now() - 5 * 60 * 1000),
      });

      await mediaService.completeMediaUpload(USER_1_ID, mediaId);

      expect(queue.enqueueMediaProcessingJob).toHaveBeenCalledWith(mediaId);
    });

    it("rejects an upload whose stored bytes are over the limit", async () => {
      const { mediaService, mediaRepository, blobService, queue } =
        createLocalMediaService();
      const { mediaId } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(mediaId))!;
      // Written directly, as an Azure PUT would be: nothing checked it.
      await blobService.writeLocalBlob(
        record.originalBlobName,
        Buffer.alloc(64),
        "image/png",
      );
      process.env.MAX_IMAGE_SIZE_BYTES = "32";

      await expect(
        mediaService.completeMediaUpload(USER_1_ID, mediaId),
      ).rejects.toThrow(PayloadTooLargeError);

      expect(await mediaRepository.findById(mediaId)).toMatchObject({
        status: "rejected",
        rejectionReason: "Images must be 32 bytes or smaller.",
      });
      await expect(
        blobService.readLocalBlob(record.originalBlobName),
      ).rejects.toThrow(ResourceNotFoundError);
      expect(queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();
    });

    it("pins the completed bytes by their ETag", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { mediaId, upload } = await startUpload(mediaService);
      await uploadBytes(mediaService, upload.url, Buffer.from("bytes"));
      const record = (await mediaRepository.findById(mediaId))!;
      const { etag } = await blobService.getProperties(record.originalBlobName);

      await mediaService.completeMediaUpload(USER_1_ID, mediaId);

      expect(etag).toEqual(expect.any(String));
      expect((await mediaRepository.findById(mediaId))?.originalEtag).toBe(
        etag,
      );
    });

    it("records no ETag when storage reports none", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { mediaId } = await startUpload(mediaService);
      jest
        .spyOn(blobService, "getProperties")
        .mockResolvedValueOnce({ contentLength: 5 });

      await mediaService.completeMediaUpload(USER_1_ID, mediaId);

      expect(await mediaRepository.findById(mediaId)).toMatchObject({
        status: "uploaded",
        sizeBytes: 5,
        originalEtag: null,
      });
    });

    it("rejects an empty upload", async () => {
      const { mediaService, mediaRepository, blobService, queue } =
        createLocalMediaService();
      const { mediaId, upload } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(mediaId))!;
      await uploadBytes(mediaService, upload.url, Buffer.alloc(0));

      await expect(
        mediaService.completeMediaUpload(USER_1_ID, mediaId),
      ).rejects.toThrow(
        expect.objectContaining({
          status: 422,
          message: "The uploaded file is empty.",
        }),
      );

      expect(await mediaRepository.findById(mediaId)).toMatchObject({
        status: "rejected",
        rejectionReason: "The uploaded file is empty.",
      });
      await expect(
        blobService.readLocalBlob(record.originalBlobName),
      ).rejects.toThrow(ResourceNotFoundError);
      expect(queue.enqueueMediaProcessingJob).not.toHaveBeenCalled();
    });

    it("still reports the size limit when deleting the oversized upload fails", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { mediaId } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(mediaId))!;
      await blobService.writeLocalBlob(
        record.originalBlobName,
        Buffer.alloc(64),
        "image/png",
      );
      process.env.MAX_IMAGE_SIZE_BYTES = "32";
      jest
        .spyOn(blobService, "deleteBlob")
        .mockRejectedValueOnce(new Error("storage unavailable"));

      await expect(
        mediaService.completeMediaUpload(USER_1_ID, mediaId),
      ).rejects.toThrow(PayloadTooLargeError);
      expect((await mediaRepository.findById(mediaId))?.status).toBe(
        "rejected",
      );
    });

    it("accepts a local upload only while the media awaits its bytes", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { mediaId, upload } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(mediaId))!;

      await uploadBytes(mediaService, upload.url, Buffer.from("bytes"));

      // Stored under the declared type, whatever header the PUT carried.
      await expect(
        blobService.readLocalBlob(record.originalBlobName),
      ).resolves.toMatchObject({ contentType: "image/png" });

      await mediaService.completeMediaUpload(USER_1_ID, mediaId);

      await expect(
        uploadBytes(mediaService, upload.url, Buffer.from("again")),
      ).rejects.toThrow("Blob upload URL is no longer valid.");

      process.env.MAX_IMAGE_SIZE_BYTES = "4";
      const second = await startUpload(mediaService);
      await expect(
        uploadBytes(mediaService, second.upload.url, Buffer.alloc(5)),
      ).rejects.toThrow(PayloadTooLargeError);
    });

    it("hides another user's media", async () => {
      const { mediaService } = createLocalMediaService();
      const { mediaId } = await startUpload(mediaService);

      await expect(
        mediaService.getMediaView(USER_2_ID, mediaId),
      ).rejects.toThrow(ResourceNotFoundError);
      await expect(
        mediaService.completeMediaUpload(USER_2_ID, mediaId),
      ).rejects.toThrow(ResourceNotFoundError);
      await expect(
        mediaService.deleteMediaById(USER_2_ID, mediaId),
      ).rejects.toThrow(ResourceNotFoundError);
      await expect(
        mediaService.getMediaView(USER_1_ID, mediaId),
      ).resolves.toMatchObject({ id: mediaId });
    });

    it("exposes a URL only for the processed image of a ready media", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { mediaId } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(mediaId))!;
      const processedBlobName = blobService.buildProcessedImageBlobName(
        USER_1_ID,
        mediaId,
      );

      mediaRepository.put({ ...record, status: "processing" });
      await expect(
        mediaService.getMediaView(USER_1_ID, mediaId),
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
        mediaService.getMediaView(USER_1_ID, mediaId),
      ).resolves.toMatchObject({
        status: "ready",
        url: blobService.getBlobUrl(processedBlobName),
        width: 8,
        height: 8,
        // Processed before renditions existed, and not yet backfilled.
        variants: null,
      });
    });

    it("exposes rendition URLs once the ready media records them", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { mediaId } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(mediaId))!;
      const processedBlobName = blobService.buildProcessedImageBlobName(
        USER_1_ID,
        mediaId,
      );
      const variants = {
        medium: { width: 8, height: 8, sizeBytes: 2 },
        thumbnail: { width: 8, height: 8, sizeBytes: 1 },
      };

      mediaRepository.put({ ...record, status: "processing", variants });
      await expect(
        mediaService.getMediaView(USER_1_ID, mediaId),
      ).resolves.toMatchObject({ url: null, variants: null });

      mediaRepository.put({
        ...record,
        status: "ready",
        processedBlobName,
        variants,
      });
      const names = blobService.buildImageVariantBlobNames(processedBlobName)!;

      await expect(
        mediaService.getMediaView(USER_1_ID, mediaId),
      ).resolves.toMatchObject({
        variants: {
          thumbnail: blobService.getBlobUrl(names.thumbnail),
          medium: blobService.getBlobUrl(names.medium),
          large: blobService.getBlobUrl(processedBlobName),
        },
      });
    });

    async function writeRenditions(
      blobService: BlobService,
      processedBlobName: string,
    ): Promise<string[]> {
      const variants =
        blobService.buildImageVariantBlobNames(processedBlobName);
      const blobNames = variants ? Object.values(variants) : [];

      for (const blobName of blobNames) {
        await blobService.writeLocalBlob(
          blobName,
          Buffer.from("webp"),
          "image/webp",
        );
      }

      return blobNames;
    }

    it("deletes a media item with its upload and every rendition", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { mediaId, upload } = await startUpload(mediaService);
      await uploadBytes(mediaService, upload.url, Buffer.from("bytes"));
      const record = (await mediaRepository.findById(mediaId))!;
      const processedBlobName = blobService.buildProcessedImageBlobName(
        USER_1_ID,
        mediaId,
      );
      const renditions = await writeRenditions(blobService, processedBlobName);
      mediaRepository.put({ ...record, status: "ready", processedBlobName });

      await mediaService.deleteMediaById(USER_1_ID, mediaId);

      expect(await mediaRepository.findById(mediaId)).toBeNull();
      expect(renditions).toHaveLength(3);
      for (const blobName of [record.originalBlobName, ...renditions]) {
        await expect(blobService.readLocalBlob(blobName)).rejects.toThrow(
          ResourceNotFoundError,
        );
      }
    });

    it("refuses to delete an image that is still attached", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { mediaId } = await mediaService.createMediaUpload({
        userId: USER_1_ID,
        filename: "logo.png",
        contentType: "image/png",
        scope: "organizations",
      });
      const record = (await mediaRepository.findById(mediaId))!;
      const processedBlobName = blobService.buildProcessedImageBlobName(
        USER_1_ID,
        mediaId,
      );
      await blobService.writeLocalBlob(
        processedBlobName,
        Buffer.from("webp"),
        "image/webp",
      );
      mediaRepository.put({ ...record, status: "ready", processedBlobName });
      mediaRepository.attachedBlobNames.add(processedBlobName);

      await expect(
        mediaService.deleteMediaById(USER_1_ID, mediaId),
      ).rejects.toThrow(ConflictError);

      expect(await mediaRepository.findById(mediaId)).not.toBeNull();
      await expect(
        blobService.readLocalBlob(processedBlobName),
      ).resolves.toBeDefined();
    });

    it("drops the media record and every rendition when its processed image is deleted by name", async () => {
      const { mediaService, mediaRepository, blobService } =
        createLocalMediaService();
      const { mediaId } = await startUpload(mediaService);
      const record = (await mediaRepository.findById(mediaId))!;
      const processedBlobName = blobService.buildProcessedImageBlobName(
        USER_1_ID,
        mediaId,
      );
      const renditions = await writeRenditions(blobService, processedBlobName);
      mediaRepository.put({ ...record, status: "ready", processedBlobName });

      await mediaService.deleteReplacedImageByBlobName(
        USER_1_ID,
        processedBlobName,
      );

      expect(await mediaRepository.findById(mediaId)).toBeNull();
      for (const blobName of renditions) {
        await expect(blobService.readLocalBlob(blobName)).rejects.toThrow(
          ResourceNotFoundError,
        );
      }
    });
  });

  describe("resolveImageReference", () => {
    const FIELDS = {
      mediaId: "logoMediaId",
      url: "logoUrl",
      blobName: "logoBlobName",
    };

    async function mediaIn(
      status: MediaStatus,
      overrides: Partial<{ scope: MediaScope; rejectionReason: string }> = {},
    ) {
      const context = createLocalMediaService();
      const { mediaId } = await context.mediaService.createMediaUpload({
        userId: USER_1_ID,
        filename: "logo.png",
        contentType: "image/png",
        scope: overrides.scope ?? "organizations",
      });
      const record = (await context.mediaRepository.findById(mediaId))!;
      const processedBlobName = context.blobService.buildProcessedImageBlobName(
        USER_1_ID,
        mediaId,
      );
      context.mediaRepository.put({
        ...record,
        status,
        processedBlobName: status === "ready" ? processedBlobName : null,
        rejectionReason: overrides.rejectionReason ?? null,
      });

      return { ...context, mediaId, processedBlobName };
    }

    function resolve(
      context: { mediaService: MediaService },
      input: Parameters<MediaService["resolveImageReference"]>[1],
      storedBlobNames: string[] = [],
      userId = USER_1_ID,
    ) {
      return context.mediaService.resolveImageReference(userId, input, {
        scope: "organizations",
        storedBlobNames: new Set(storedBlobNames),
        fields: FIELDS,
      });
    }

    it("resolves a new image to the processed blob of a ready media item", async () => {
      const ready = await mediaIn("ready");

      await expect(resolve(ready, { mediaId: ready.mediaId })).resolves.toEqual(
        {
          blobName: ready.processedBlobName,
          blobUrl: ready.blobService.getBlobUrl(ready.processedBlobName),
        },
      );
    });

    it("refuses media that is missing, foreign, unfinished, rejected, or for another scope", async () => {
      const ready = await mediaIn("ready");

      await expect(
        resolve(ready, { mediaId: testUuid(9000, 994261) }),
      ).rejects.toThrow("Image is not available.");
      await expect(
        resolve(ready, { mediaId: ready.mediaId }, [], USER_2_ID),
      ).rejects.toThrow("Image is not available.");

      const posting = await mediaIn("ready", { scope: "postings" });
      await expect(
        resolve(posting, { mediaId: posting.mediaId }),
      ).rejects.toThrow("Image was not uploaded for organizations.");

      for (const status of [
        "pending_upload",
        "uploaded",
        "processing",
      ] as const) {
        const pending = await mediaIn(status);
        await expect(
          resolve(pending, { mediaId: pending.mediaId }),
        ).rejects.toThrow("Image is still processing.");
      }

      const rejected = await mediaIn("rejected", {
        rejectionReason: "Uploaded file could not be read as an image.",
      });
      await expect(
        resolve(rejected, { mediaId: rejected.mediaId }),
      ).rejects.toThrow(
        "Image was rejected: Uploaded file could not be read as an image.",
      );
      const rejectedWithoutReason = await mediaIn("rejected");
      await expect(
        resolve(rejectedWithoutReason, {
          mediaId: rejectedWithoutReason.mediaId,
        }),
      ).rejects.toThrow("Image was rejected.");
    });

    it("keeps, clears, or leaves out the stored image", async () => {
      const context = createLocalMediaService();
      const stored = `media/images/${USER_1_ID}/stored.webp`;
      const storedUrl = context.blobService.getBlobUrl(stored);

      await expect(
        resolve(context, { url: ` ${storedUrl} `, blobName: ` ${stored} ` }, [
          stored,
        ]),
      ).resolves.toEqual({ blobUrl: storedUrl, blobName: stored });
      await expect(
        resolve(context, { url: null, blobName: null }, [stored]),
      ).resolves.toBeNull();
      await expect(resolve(context, {}, [stored])).resolves.toBeUndefined();
    });

    it("refuses a new image by blob name, even one the user owns", async () => {
      const context = createLocalMediaService();
      const owned = `organizations/${USER_1_ID}/logo.png`;

      await expect(
        resolve(context, {
          url: context.blobService.getBlobUrl(owned),
          blobName: owned,
        }),
      ).rejects.toThrow(
        "A new image must be uploaded and sent as logoMediaId.",
      );
    });

    it("refuses malformed references with the request's own field names", async () => {
      const context = createLocalMediaService();
      const stored = `media/images/${USER_1_ID}/stored.webp`;

      await expect(
        resolve(context, {
          mediaId: testUuid(9000, 994262),
          url: "https://example.test/a.png",
          blobName: "a.png",
        }),
      ).rejects.toThrow(
        "Send either logoMediaId or logoUrl and logoBlobName, not both.",
      );
      await expect(
        resolve(context, { url: "https://example.test/a.png" }, [stored]),
      ).rejects.toThrow(
        "logoUrl and logoBlobName must be sent together, or both be null.",
      );
      await expect(
        resolve(
          context,
          { url: "https://example.test/a.png", blobName: stored },
          [stored],
        ),
      ).rejects.toThrow(
        "logoUrl does not match the stored image for logoBlobName.",
      );
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
