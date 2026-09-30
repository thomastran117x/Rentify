import sharp from "sharp";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import BlobChangedError from "@/errors/blob-changed.error";
import { BlobService } from "@/features/blob/blob.service";
import type {
  MediaRecord,
  MediaRejectionCode,
  MediaStatus,
} from "@/features/media/media.model";
import {
  BestEffortMediaMetrics,
  type MediaMetrics,
} from "@/features/media/media-metrics";
import { MediaProcessingService } from "@/features/media/media-processing.service";
import {
  RecordingMediaMetrics,
  ThrowingMediaMetrics,
} from "../../support/recording-media-metrics";
import { InMemoryMediaRepository } from "../../support/in-memory-media-repository";
import {
  restoreBlobEnvironmentAfterEach,
  useLocalBlobStorage,
} from "../../support/blob-environment";
import {
  createAnimatedWebpFixture,
  createApngFixture,
  createGifFixture,
  createJpegFixture,
  createPngFixture,
  truncateImage,
} from "../../support/image-fixtures";
import { testUuid } from "../../support/uuid";
import { buildImageVariantBlobNames } from "@/features/blob/image-variant-names";

const USER_1_ID = testUuid(9000, 994290);
let nextMediaIndex = 994300;

restoreBlobEnvironmentAfterEach();

function createContext(options: { metrics?: MediaMetrics } = {}) {
  useLocalBlobStorage();
  const blobService = new BlobService();
  const mediaRepository = new InMemoryMediaRepository();
  const metrics = new RecordingMediaMetrics();

  return {
    blobService,
    mediaRepository,
    metrics,
    service: new MediaProcessingService(
      mediaRepository.asRepository(),
      blobService,
      options.metrics ?? metrics,
    ),
  };
}

type Context = ReturnType<typeof createContext>;

/**
 * Stores an upload in quarantine and a row for it in the given state, pinned to
 * the stored blob's ETag as completion would pin it. A `legacy` row predates
 * the ETag and has none.
 */
async function quarantine(
  context: Context,
  body: Buffer | null,
  options: {
    declaredContentType?: string;
    status?: MediaStatus;
    legacy?: boolean;
  } = {},
): Promise<MediaRecord> {
  const id = testUuid(9000, nextMediaIndex++);
  const now = new Date();
  const record: MediaRecord = {
    id,
    userId: USER_1_ID,
    status: options.status ?? "uploaded",
    scope: "postings",
    originalBlobName: context.blobService.buildQuarantineImageBlobName(
      USER_1_ID,
      id,
    ),
    processedBlobName: null,
    declaredContentType: options.declaredContentType ?? "image/png",
    detectedContentType: null,
    originalFilename: "upload",
    originalEtag: null,
    sizeBytes: body?.byteLength ?? null,
    width: null,
    height: null,
    variants: null,
    rejectionReason: null,
    rejectionCode: null,
    processingRequeues: 0,
    processingAttempts: 0,
    processingStartedAt: null,
    processingCompletedAt: null,
    processingError: null,
    createdAt: now,
    updatedAt: now,
  };

  // Local storage outlives a run and ids repeat between runs, so clear what an
  // earlier run may have left for this id.
  await context.blobService.deleteBlob(record.originalBlobName);
  for (const blobName of renditionNames(context, id)) {
    await context.blobService.deleteBlob(blobName);
  }

  if (body) {
    await context.blobService.writeLocalBlob(
      record.originalBlobName,
      body,
      record.declaredContentType,
    );

    if (!options.legacy) {
      record.originalEtag =
        (await context.blobService.getProperties(record.originalBlobName))
          .etag ?? null;
    }
  }

  context.mediaRepository.put(record);
  return record;
}

/** The large, medium, and thumbnail blob names of an item, in that order. */
function renditionNames(context: Context, mediaId: string): string[] {
  const names = buildImageVariantBlobNames(
    context.blobService.buildProcessedImageBlobName(
      USER_1_ID,
      mediaId as MediaRecord["id"],
    ),
  )!;

  return [names.large, names.medium, names.thumbnail];
}

async function expectMissing(context: Context, blobName: string) {
  await expect(context.blobService.readLocalBlob(blobName)).rejects.toThrow(
    ResourceNotFoundError,
  );
}

describe("MediaProcessingService", () => {
  it("re-encodes a valid upload to WebP and marks it ready", async () => {
    const context = createContext();
    const record = await quarantine(context, await createPngFixture(12, 8));

    await context.service.process(record.id);

    // Progress is reported after the download and after rendering, so the
    // media cleanup never takes a slow job for a lost one.
    expect(context.mediaRepository.progressRecorded).toEqual([
      record.id,
      record.id,
    ]);
    const processedBlobName = context.blobService.buildProcessedImageBlobName(
      USER_1_ID,
      record.id,
    );
    const ready = await context.mediaRepository.findById(record.id);
    const stored = await context.blobService.readLocalBlob(processedBlobName);

    expect(ready).toMatchObject({
      status: "ready",
      processedBlobName,
      detectedContentType: "image/png",
      width: 12,
      height: 8,
      sizeBytes: stored.body.byteLength,
      rejectionReason: null,
    });
    expect(stored.contentType).toBe("image/webp");
    await expect(sharp(stored.body).metadata()).resolves.toMatchObject({
      format: "webp",
    });
    await expectMissing(context, record.originalBlobName);
    expect(context.metrics.tagsOf("media.processing.success")).toEqual([
      { scope: "postings" },
    ]);
    expect(context.metrics.calls("media.bytes.processed")).toEqual([
      expect.objectContaining({
        value: stored.body.byteLength,
        tags: { scope: "postings" },
      }),
    ]);
    expect(context.metrics.calls("media.processing.duration")).toEqual([
      expect.objectContaining({
        value: expect.any(Number),
        tags: { scope: "postings", outcome: "ready" },
      }),
    ]);
    expect(
      context.metrics.calls("media.processing.duration")[0]!.value,
    ).toBeGreaterThanOrEqual(0);
    expect(context.metrics.count("media.rejected")).toBe(0);
    context.metrics.assertNoIdentifiers();
  });

  it("processes an image even when every metric call fails", async () => {
    const context = createContext({
      metrics: new BestEffortMediaMetrics(new ThrowingMediaMetrics()),
    });
    const record = await quarantine(context, await createPngFixture());

    await expect(context.service.process(record.id)).resolves.toBeUndefined();
    expect((await context.mediaRepository.findById(record.id))?.status).toBe(
      "ready",
    );
  });

  describe("renditions", () => {
    /**
     * Processes an upload; returns the ready row and each stored rendition, or
     * null for one that was not written.
     */
    async function processRenditions(
      body: Buffer,
      declaredContentType = "image/png",
    ) {
      const context = createContext();
      const record = await quarantine(context, body, { declaredContentType });

      await context.service.process(record.id);

      const ready = (await context.mediaRepository.findById(record.id))!;
      const [large, medium, thumbnail] = await Promise.all(
        renditionNames(context, record.id).map(async (blobName) => {
          const stored = await context.blobService
            .readLocalBlob(blobName)
            .catch((error: unknown) => {
              if (error instanceof ResourceNotFoundError) {
                return null;
              }
              throw error;
            });
          if (!stored) {
            return null;
          }
          const metadata = await sharp(stored.body).metadata();

          return {
            contentType: stored.contentType,
            format: metadata.format,
            width: metadata.width,
            height: metadata.height,
            sizeBytes: stored.body.byteLength,
          };
        }),
      );

      return { ready, large: large!, medium, thumbnail };
    }

    it("writes a medium and a thumbnail beside the processed image", async () => {
      const { ready, large, medium, thumbnail } = await processRenditions(
        await createPngFixture(4000, 3000),
      );

      expect(large).toMatchObject({ width: 2560, height: 1920 });
      for (const rendition of [large, medium, thumbnail]) {
        expect(rendition).toMatchObject({
          contentType: "image/webp",
          format: "webp",
        });
      }
      expect(medium).toMatchObject({ width: 800, height: 600 });
      expect(thumbnail).toMatchObject({ width: 300, height: 225 });
      // The row records what was written, and so doubles as proof it exists.
      expect(ready.variants).toEqual({
        medium: { width: 800, height: 600, sizeBytes: medium!.sizeBytes },
        thumbnail: {
          width: 300,
          height: 225,
          sizeBytes: thumbnail!.sizeBytes,
        },
      });
    });

    it("writes no rendition that would be no smaller than the image", async () => {
      const { ready, large, medium, thumbnail } = await processRenditions(
        await createPngFixture(120, 90),
      );

      // A copy of the same width would only be a duplicate to store and serve.
      expect(large).toMatchObject({ width: 120, height: 90 });
      expect(medium).toBeNull();
      expect(thumbnail).toBeNull();
      expect(ready.variants).toEqual({ medium: null, thumbnail: null });
    });

    it("writes only the renditions narrower than the image", async () => {
      const { ready, medium, thumbnail } = await processRenditions(
        await createPngFixture(500, 400),
      );

      expect(medium).toBeNull();
      expect(thumbnail).toMatchObject({ width: 300, height: 240 });
      expect(ready.variants).toEqual({
        medium: null,
        thumbnail: {
          width: 300,
          height: 240,
          sizeBytes: thumbnail!.sizeBytes,
        },
      });
    });

    it("sizes an upright portrait's renditions by their width", async () => {
      // Stored landscape with orientation 6: displayed as a 1200x1600 portrait.
      const rotatedJpeg = await sharp({
        create: {
          width: 1600,
          height: 1200,
          channels: 3,
          background: { r: 40, g: 120, b: 200 },
        },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();

      const { medium, thumbnail } = await processRenditions(
        rotatedJpeg,
        "image/jpeg",
      );

      // By width, so a srcset's 800w and 300w descriptors are their real
      // widths and a narrow column never gets a copy too small for it.
      expect(medium).toMatchObject({ width: 800, height: 1067 });
      expect(thumbnail).toMatchObject({ width: 300, height: 400 });
    });

    it("sizes renditions from the processed image, not the upload", async () => {
      process.env.MAX_PROCESSED_IMAGE_EDGE = "600";

      const { large, medium, thumbnail } = await processRenditions(
        await createPngFixture(1024, 1024),
      );

      // The upload is wider than a medium, but its capped copy is not.
      expect(large).toMatchObject({ width: 600, height: 600 });
      expect(medium).toBeNull();
      expect(thumbnail).toMatchObject({ width: 300, height: 300 });
    });

    it("writes every rendition again when a retry follows a partial upload", async () => {
      const context = createContext();
      const record = await quarantine(
        context,
        await createPngFixture(900, 600),
      );
      const uploadBuffer = context.blobService.uploadBuffer.bind(
        context.blobService,
      );
      jest
        .spyOn(context.blobService, "uploadBuffer")
        .mockImplementationOnce(uploadBuffer)
        .mockRejectedValueOnce(new Error("storage unavailable"));

      await expect(context.service.process(record.id)).rejects.toThrow(
        "storage unavailable",
      );
      expect((await context.mediaRepository.findById(record.id))?.status).toBe(
        "processing",
      );

      await context.service.process(record.id);

      expect(
        (await context.mediaRepository.findById(record.id))?.variants,
      ).not.toBeNull();
      for (const blobName of renditionNames(context, record.id)) {
        await expect(
          context.blobService.readLocalBlob(blobName),
        ).resolves.toMatchObject({ contentType: "image/webp" });
      }
    });
  });

  it("applies EXIF orientation and drops the metadata", async () => {
    const context = createContext();
    const rotatedJpeg = await sharp({
      create: {
        width: 8,
        height: 4,
        channels: 3,
        background: { r: 200, g: 40, b: 40 },
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const record = await quarantine(context, rotatedJpeg, {
      declaredContentType: "image/jpeg",
    });

    await context.service.process(record.id);

    const ready = (await context.mediaRepository.findById(record.id))!;
    const stored = await context.blobService.readLocalBlob(
      ready.processedBlobName!,
    );
    const metadata = await sharp(stored.body).metadata();

    // Orientation 6 is a quarter turn, so the stored pixels swap axes.
    expect(ready).toMatchObject({ width: 4, height: 8 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  describe("the processed size cap", () => {
    /** Processes an upload and returns the ready row and its stored image. */
    async function processUpload(
      body: Buffer,
      declaredContentType = "image/png",
    ) {
      const context = createContext();
      const record = await quarantine(context, body, { declaredContentType });

      await context.service.process(record.id);

      const ready = (await context.mediaRepository.findById(record.id))!;
      const stored = await context.blobService.readLocalBlob(
        ready.processedBlobName!,
      );

      return { ready, metadata: await sharp(stored.body).metadata() };
    }

    it("scales a large image down to the default longest edge", async () => {
      const { ready, metadata } = await processUpload(
        await createPngFixture(4000, 3000),
      );

      expect(ready).toMatchObject({
        status: "ready",
        width: 2560,
        height: 1920,
      });
      expect(metadata).toMatchObject({ width: 2560, height: 1920 });
    });

    it("never enlarges an image already within the cap", async () => {
      const { ready, metadata } = await processUpload(
        await createPngFixture(1000, 800),
      );

      expect(ready).toMatchObject({ width: 1000, height: 800 });
      expect(metadata).toMatchObject({ width: 1000, height: 800 });
    });

    it("caps a rotated portrait after making it upright", async () => {
      // Stored landscape with orientation 6: displayed as a 3000x4000 portrait.
      const rotatedJpeg = await sharp({
        create: {
          width: 4000,
          height: 3000,
          channels: 3,
          background: { r: 40, g: 120, b: 200 },
        },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();

      const { ready, metadata } = await processUpload(
        rotatedJpeg,
        "image/jpeg",
      );

      expect(ready).toMatchObject({ width: 1920, height: 2560 });
      expect(metadata).toMatchObject({ width: 1920, height: 2560 });
      expect(metadata.orientation).toBeUndefined();
    });

    it("applies a configured cap and keeps a panorama's aspect ratio", async () => {
      process.env.MAX_PROCESSED_IMAGE_EDGE = "256";

      const { ready, metadata } = await processUpload(
        await createPngFixture(2048, 256),
      );

      expect(ready).toMatchObject({ width: 256, height: 32 });
      expect(metadata).toMatchObject({ width: 256, height: 32 });
    });
  });

  it.each([
    [
      "a Display P3",
      () =>
        sharp({
          create: {
            width: 8,
            height: 8,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
          },
        })
          .withIccProfile("p3")
          .jpeg()
          .toBuffer(),
    ],
    [
      "a CMYK",
      () =>
        sharp({
          create: {
            width: 8,
            height: 8,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
          },
        })
          .toColourspace("cmyk")
          .jpeg()
          .toBuffer(),
    ],
  ])("publishes %s JPEG as sRGB", async (_label, body) => {
    const context = createContext();
    const record = await quarantine(context, await body(), {
      declaredContentType: "image/jpeg",
    });

    await context.service.process(record.id);

    const ready = (await context.mediaRepository.findById(record.id))!;
    const stored = await context.blobService.readLocalBlob(
      ready.processedBlobName!,
    );
    const metadata = await sharp(stored.body).metadata();
    const pixels = await sharp(stored.body).raw().toBuffer();

    expect(ready.status).toBe("ready");
    expect(metadata).toMatchObject({ space: "srgb", channels: 3 });
    expect(metadata.icc).toBeUndefined();
    // Still red once converted, rather than CMYK or P3 values read as sRGB.
    expect(pixels[0]).toBeGreaterThan(200);
    expect(pixels[1]).toBeLessThan(30);
    expect(pixels[2]).toBeLessThan(30);
  });

  it("publishes an APNG as its first frame", async () => {
    const context = createContext();
    const record = await quarantine(context, await createApngFixture(8));

    await context.service.process(record.id);

    const ready = (await context.mediaRepository.findById(record.id))!;
    const stored = await context.blobService.readLocalBlob(
      ready.processedBlobName!,
    );
    const { data } = await sharp(stored.body)
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(ready).toMatchObject({
      status: "ready",
      detectedContentType: "image/png",
      width: 8,
      height: 8,
    });
    const metadata = await sharp(stored.body).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.pages).toBeUndefined();
    // The first frame is red; the second, dropped, is blue.
    expect(data[0]).toBeGreaterThan(200);
    expect(data[2]).toBeLessThan(30);
  });

  it.each([
    [
      "bytes that are not an image",
      async () => Buffer.from("not-an-image"),
      "image/png",
      "Uploaded file could not be read as an image.",
      "corrupt",
    ],
    [
      "an image that is not the declared type",
      () => createJpegFixture(),
      "image/png",
      "Uploaded file contents do not match the declared image type.",
      "type_mismatch",
    ],
    [
      "a format outside the policy",
      () => createGifFixture(),
      "image/png",
      "Uploaded file contents do not match the declared image type.",
      "type_mismatch",
    ],
    [
      "an animated image",
      () => createAnimatedWebpFixture(),
      "image/webp",
      "Animated or multi-page images are not supported.",
      "animated",
    ],
    [
      "truncated image data",
      async () => truncateImage(await createPngFixture(64, 64)),
      "image/png",
      null,
      "corrupt",
    ],
  ])(
    "rejects %s and removes it from quarantine",
    async (_label, body, declaredContentType, reason, code) => {
      const context = createContext();
      const record = await quarantine(context, await body(), {
        declaredContentType,
      });

      // A refusal is final: it returns rather than throwing for a retry.
      await expect(context.service.process(record.id)).resolves.toBeUndefined();

      const rejected = await context.mediaRepository.findById(record.id);
      expect(rejected?.status).toBe("rejected");
      expect(rejected?.processedBlobName).toBeNull();
      expect(rejected?.rejectionCode).toBe(code);
      if (reason) {
        expect(rejected?.rejectionReason).toBe(reason);
      } else {
        expect(rejected?.rejectionReason).toEqual(expect.any(String));
      }
      await expectMissing(context, record.originalBlobName);
      await expectMissing(
        context,
        context.blobService.buildProcessedImageBlobName(USER_1_ID, record.id),
      );
    },
  );

  it("holds the real bytes to the size, dimension, and allow-list policy", async () => {
    const context = createContext();
    const png = await createPngFixture(32, 32);
    const oversized = await quarantine(context, png);
    const tooWide = await quarantine(context, png);
    const narrowedOut = await quarantine(context, await createJpegFixture(), {
      declaredContentType: "image/jpeg",
    });

    process.env.MAX_IMAGE_SIZE_BYTES = String(png.byteLength - 1);
    await context.service.process(oversized.id);
    delete process.env.MAX_IMAGE_SIZE_BYTES;

    process.env.MAX_IMAGE_WIDTH = "16";
    await context.service.process(tooWide.id);
    delete process.env.MAX_IMAGE_WIDTH;

    process.env.ALLOWED_IMAGE_TYPES = "image/png";
    await context.service.process(narrowedOut.id);

    await expect(
      context.mediaRepository.findById(oversized.id),
    ).resolves.toMatchObject({
      status: "rejected",
      rejectionReason: expect.stringMatching(/^Images must be/),
      rejectionCode: "too_large",
    });
    await expect(
      context.mediaRepository.findById(tooWide.id),
    ).resolves.toMatchObject({
      status: "rejected",
      rejectionReason: "Image dimensions exceed the allowed maximum.",
      rejectionCode: "dimensions",
    });
    await expect(
      context.mediaRepository.findById(narrowedOut.id),
    ).resolves.toMatchObject({
      status: "rejected",
      rejectionReason: "Only PNG images can be uploaded.",
      rejectionCode: "unsupported_type",
    });
    expect(context.metrics.tagsOf("media.rejected")).toEqual([
      { code: "too_large", stage: "processing" },
      { code: "dimensions", stage: "processing" },
      { code: "unsupported_type", stage: "processing" },
    ]);
    expect(context.metrics.tagsOf("media.processing.duration")).toEqual([
      { scope: "postings", outcome: "rejected" },
      { scope: "postings", outcome: "rejected" },
      { scope: "postings", outcome: "rejected" },
    ]);
    expect(context.metrics.count("media.processing.success")).toBe(0);
    context.metrics.assertNoIdentifiers();
  });

  it("rejects an item whose upload has disappeared", async () => {
    const context = createContext();
    const record = await quarantine(context, null);

    await context.service.process(record.id);

    await expect(
      context.mediaRepository.findById(record.id),
    ).resolves.toMatchObject({
      status: "rejected",
      rejectionReason: "The uploaded file could not be found.",
      rejectionCode: "missing_upload",
    });
    expect(context.metrics.tagsOf("media.rejected")).toEqual([
      { code: "missing_upload", stage: "processing" },
    ]);
  });

  describe("the pinned upload", () => {
    const UPLOAD_CHANGED_REASON = "The upload changed after it was completed.";

    /** Writes new bytes over a quarantined upload, as a reused SAS could. */
    async function overwrite(context: Context, record: MediaRecord) {
      await context.blobService.writeLocalBlob(
        record.originalBlobName,
        Buffer.from("x".repeat(4096)),
        "text/plain",
      );
    }

    async function expectRejected(
      context: Context,
      record: MediaRecord,
      rejectionReason: string,
      rejectionCode: MediaRejectionCode,
    ) {
      await expect(
        context.mediaRepository.findById(record.id),
      ).resolves.toMatchObject({
        status: "rejected",
        rejectionReason,
        rejectionCode,
      });
      await expectMissing(context, record.originalBlobName);
      await expectMissing(
        context,
        context.blobService.buildProcessedImageBlobName(USER_1_ID, record.id),
      );
    }

    it("downloads only the completed bytes, capped one past the limit", async () => {
      const context = createContext();
      const record = await quarantine(context, await createPngFixture());
      const download = jest.spyOn(context.blobService, "downloadBlob");
      process.env.MAX_IMAGE_SIZE_BYTES = "4096";

      await context.service.process(record.id);

      expect(download).toHaveBeenCalledWith(record.originalBlobName, {
        ifMatch: record.originalEtag,
        maxBytes: 4096,
      });
      expect((await context.mediaRepository.findById(record.id))?.status).toBe(
        "ready",
      );
    });

    it("rejects an upload overwritten after completion without downloading it", async () => {
      const context = createContext();
      const record = await quarantine(context, await createPngFixture());
      await overwrite(context, record);
      const download = jest.spyOn(context.blobService, "downloadBlob");
      // The replacement is also oversized; the change is still the reason.
      process.env.MAX_IMAGE_SIZE_BYTES = "1024";

      await expect(context.service.process(record.id)).resolves.toBeUndefined();

      expect(download).not.toHaveBeenCalled();
      await expectRejected(
        context,
        record,
        UPLOAD_CHANGED_REASON,
        "upload_changed",
      );
    });

    it.each([
      ["an empty upload", 0, "The uploaded file is empty.", "empty"],
      [
        "an oversized upload",
        64,
        "Images must be 32 bytes or smaller.",
        "too_large",
      ],
    ] as const)(
      "rejects %s from its properties without downloading it",
      async (_label, sizeBytes, reason, code) => {
        const context = createContext();
        const record = await quarantine(context, Buffer.alloc(sizeBytes));
        const download = jest.spyOn(context.blobService, "downloadBlob");
        process.env.MAX_IMAGE_SIZE_BYTES = "32";

        await context.service.process(record.id);

        expect(download).not.toHaveBeenCalled();
        await expectRejected(context, record, reason, code);
      },
    );

    it.each([
      [
        "changed during the download",
        new BlobChangedError(),
        UPLOAD_CHANGED_REASON,
        "upload_changed",
      ],
      [
        "grew past the limit during the download",
        new PayloadTooLargeError("Blob is larger than the allowed maximum."),
        "Images must be 8 MB or smaller.",
        "too_large",
      ],
      [
        "disappeared during the download",
        new ResourceNotFoundError("Blob not found."),
        "The uploaded file could not be found.",
        "missing_upload",
      ],
    ] as const)(
      "rejects an upload that %s, without a retry",
      async (_label, error, reason, code) => {
        const context = createContext();
        const record = await quarantine(context, await createPngFixture());
        process.env.MAX_IMAGE_SIZE_BYTES = String(8 * 1024 * 1024);
        jest
          .spyOn(context.blobService, "downloadBlob")
          .mockRejectedValueOnce(error);

        await expect(
          context.service.process(record.id),
        ).resolves.toBeUndefined();

        await expectRejected(context, record, reason, code);
      },
    );

    it("still processes a row completed before the ETag was recorded", async () => {
      const context = createContext();
      const record = await quarantine(context, await createPngFixture(), {
        legacy: true,
      });
      // Rewritten with valid bytes: without a recorded ETag nothing can tell.
      await context.blobService.writeLocalBlob(
        record.originalBlobName,
        await createPngFixture(6, 4),
        "image/png",
      );

      await context.service.process(record.id);

      await expect(
        context.mediaRepository.findById(record.id),
      ).resolves.toMatchObject({
        status: "ready",
        originalEtag: null,
        width: 6,
        height: 4,
      });
    });

    it("still holds a legacy row to the size limit", async () => {
      const context = createContext();
      const record = await quarantine(context, Buffer.alloc(64), {
        legacy: true,
      });
      process.env.MAX_IMAGE_SIZE_BYTES = "32";

      await context.service.process(record.id);

      await expectRejected(
        context,
        record,
        "Images must be 32 bytes or smaller.",
        "too_large",
      );
    });

    it("retries when the properties cannot be read", async () => {
      const context = createContext();
      const record = await quarantine(context, await createPngFixture());
      jest
        .spyOn(context.blobService, "getProperties")
        .mockRejectedValueOnce(new Error("storage unavailable"));

      await expect(context.service.process(record.id)).rejects.toThrow(
        "storage unavailable",
      );
      expect((await context.mediaRepository.findById(record.id))?.status).toBe(
        "processing",
      );

      await context.service.process(record.id);
      expect((await context.mediaRepository.findById(record.id))?.status).toBe(
        "ready",
      );
    });
  });

  it("ignores items that are missing or not waiting for processing", async () => {
    const context = createContext();
    const download = jest.spyOn(context.blobService, "downloadBlob");
    const png = await createPngFixture();

    for (const status of ["pending_upload", "ready", "rejected"] as const) {
      const record = await quarantine(context, png, { status });
      await context.service.process(record.id);
      expect((await context.mediaRepository.findById(record.id))?.status).toBe(
        status,
      );
    }
    await context.service.process(testUuid(9000, 994399));

    expect(download).not.toHaveBeenCalled();
    // Nothing was claimed, so nothing was timed or counted.
    expect(context.metrics.recorded).toEqual([]);
  });

  it("resumes an item left in processing by an interrupted run", async () => {
    const context = createContext();
    const record = await quarantine(context, await createPngFixture(), {
      status: "processing",
    });

    await context.service.process(record.id);

    expect((await context.mediaRepository.findById(record.id))?.status).toBe(
      "ready",
    );
  });

  it("surfaces storage failures so the job is retried", async () => {
    const context = createContext();
    const record = await quarantine(context, await createPngFixture());
    jest
      .spyOn(context.blobService, "downloadBlob")
      .mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(context.service.process(record.id)).rejects.toThrow(
      "storage unavailable",
    );
    expect((await context.mediaRepository.findById(record.id))?.status).toBe(
      "processing",
    );
    expect(context.metrics.tagsOf("media.processing.duration")).toEqual([
      { scope: "postings", outcome: "failed" },
    ]);
    expect(context.metrics.count("media.processing.success")).toBe(0);
    await context.service.recordProcessingFailure(
      record.id,
      new Error("storage unavailable"),
    );
    await expect(
      context.mediaRepository.findById(record.id),
    ).resolves.toMatchObject({
      processingAttempts: 1,
      processingCompletedAt: null,
      processingError: "Error: storage unavailable",
    });

    await context.service.process(record.id);
    // Each claim is counted; the retry is the second.
    await expect(
      context.mediaRepository.findById(record.id),
    ).resolves.toMatchObject({
      status: "ready",
      processingAttempts: 2,
      processingStartedAt: expect.any(Date),
      processingCompletedAt: expect.any(Date),
    });
    expect(context.metrics.tagsOf("media.processing.duration")).toEqual([
      { scope: "postings", outcome: "failed" },
      { scope: "postings", outcome: "ready" },
    ]);
    expect(context.metrics.count("media.processing.success")).toBe(1);
  });

  it("discards its output when the item was deleted mid-run", async () => {
    const context = createContext();
    const record = await quarantine(context, await createPngFixture());
    const repository = context.mediaRepository;
    const markReady = repository.markReady.bind(repository);
    jest
      .spyOn(repository, "markReady")
      .mockImplementationOnce(async (...args) => {
        await repository.deleteById(record.id);
        return markReady(...args);
      });

    await context.service.process(record.id);

    for (const blobName of renditionNames(context, record.id)) {
      await expectMissing(context, blobName);
    }
    expect(context.metrics.count("media.processing.success")).toBe(0);
    expect(context.metrics.tagsOf("media.processing.duration")).toEqual([
      { scope: "postings", outcome: "discarded" },
    ]);
  });

  it("keeps the output when a duplicate job already finished the item", async () => {
    const context = createContext();
    const record = await quarantine(context, await createPngFixture(1000, 750));
    const repository = context.mediaRepository;
    const markReady = repository.markReady.bind(repository);
    jest
      .spyOn(repository, "markReady")
      .mockImplementationOnce(async (...args) => {
        await markReady(...args);
        return false;
      });

    await context.service.process(record.id);

    for (const blobName of renditionNames(context, record.id)) {
      await expect(
        context.blobService.readLocalBlob(blobName),
      ).resolves.toMatchObject({ contentType: "image/webp" });
    }
    // The job that marked it ready counted it; this one does not.
    expect(context.metrics.count("media.processing.success")).toBe(0);
    expect(context.metrics.count("media.bytes.processed")).toBe(0);
    expect(context.metrics.tagsOf("media.processing.duration")).toEqual([
      { scope: "postings", outcome: "discarded" },
    ]);
    await expectMissing(context, record.originalBlobName);
  });

  it("treats a failed quarantine cleanup as non-fatal", async () => {
    const context = createContext();
    const record = await quarantine(context, await createPngFixture());
    jest
      .spyOn(context.blobService, "deleteBlob")
      .mockRejectedValueOnce(new Error("delete failed"));

    await expect(context.service.process(record.id)).resolves.toBeUndefined();
    expect((await context.mediaRepository.findById(record.id))?.status).toBe(
      "ready",
    );
  });

  describe("markProcessingFailed", () => {
    it("rejects an unfinished item and keeps its upload for a replay", async () => {
      const context = createContext();
      const record = await quarantine(context, await createPngFixture());

      await context.service.markProcessingFailed(record.id);

      await expect(
        context.mediaRepository.findById(record.id),
      ).resolves.toMatchObject({
        status: "rejected",
        rejectionReason: "The image could not be processed.",
        rejectionCode: "processing_failed",
      });
      await expect(
        context.blobService.readLocalBlob(record.originalBlobName),
      ).resolves.toBeDefined();

      // A repeat finds it already rejected and is not counted again.
      await context.service.markProcessingFailed(record.id);
      expect(context.metrics.tagsOf("media.rejected")).toEqual([
        { code: "processing_failed", stage: "dead_letter" },
      ]);
    });

    it("leaves finished and missing items alone", async () => {
      const context = createContext();
      const record = await quarantine(context, await createPngFixture(), {
        status: "ready",
      });

      await context.service.markProcessingFailed(record.id);
      await context.service.markProcessingFailed(testUuid(9000, 994398));

      expect((await context.mediaRepository.findById(record.id))?.status).toBe(
        "ready",
      );
      expect(context.metrics.count("media.rejected")).toBe(0);
      await expect(
        context.blobService.readLocalBlob(record.originalBlobName),
      ).resolves.toBeDefined();
    });
  });
});
