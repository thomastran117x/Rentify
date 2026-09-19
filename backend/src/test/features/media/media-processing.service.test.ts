import sharp from "sharp";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { BlobService } from "@/features/blob/blob.service";
import type { MediaRecord, MediaStatus } from "@/features/media/media.model";
import { MediaProcessingService } from "@/features/media/media-processing.service";
import { InMemoryMediaRepository } from "../../support/in-memory-media-repository";
import {
  restoreBlobEnvironmentAfterEach,
  useLocalBlobStorage,
} from "../../support/blob-environment";
import {
  createGifFixture,
  createJpegFixture,
  createPngFixture,
  truncateImage,
} from "../../support/image-fixtures";
import { testUuid } from "../../support/uuid";

const USER_1_ID = testUuid(9000, 994290);
let nextMediaIndex = 994300;

restoreBlobEnvironmentAfterEach();

function createContext() {
  useLocalBlobStorage();
  const blobService = new BlobService();
  const mediaRepository = new InMemoryMediaRepository();

  return {
    blobService,
    mediaRepository,
    service: new MediaProcessingService(
      mediaRepository.asRepository(),
      blobService,
    ),
  };
}

type Context = ReturnType<typeof createContext>;

/** Stores an upload in quarantine and a row for it in the given state. */
async function quarantine(
  context: Context,
  body: Buffer | null,
  options: { declaredContentType?: string; status?: MediaStatus } = {},
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
    sizeBytes: body?.byteLength ?? null,
    width: null,
    height: null,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
  };

  if (body) {
    await context.blobService.writeLocalBlob(
      record.originalBlobName,
      body,
      record.declaredContentType,
    );
  }

  context.mediaRepository.put(record);
  return record;
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

  it.each([
    [
      "bytes that are not an image",
      async () => Buffer.from("not-an-image"),
      "image/png",
      "Uploaded file could not be read as an image.",
    ],
    [
      "an image that is not the declared type",
      () => createJpegFixture(),
      "image/png",
      "Uploaded file contents do not match the declared image type.",
    ],
    [
      "a format outside the policy",
      () => createGifFixture(),
      "image/png",
      "Uploaded file contents do not match the declared image type.",
    ],
    [
      "truncated image data",
      async () => truncateImage(await createPngFixture(64, 64)),
      "image/png",
      null,
    ],
  ])(
    "rejects %s and removes it from quarantine",
    async (_label, body, declaredContentType, reason) => {
      const context = createContext();
      const record = await quarantine(context, await body(), {
        declaredContentType,
      });

      await context.service.process(record.id);

      const rejected = await context.mediaRepository.findById(record.id);
      expect(rejected?.status).toBe("rejected");
      expect(rejected?.processedBlobName).toBeNull();
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
    });
    await expect(
      context.mediaRepository.findById(tooWide.id),
    ).resolves.toMatchObject({
      status: "rejected",
      rejectionReason: "Image dimensions exceed the allowed maximum.",
    });
    await expect(
      context.mediaRepository.findById(narrowedOut.id),
    ).resolves.toMatchObject({
      status: "rejected",
      rejectionReason: "Only PNG images can be uploaded.",
    });
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

    await context.service.process(record.id);
    expect((await context.mediaRepository.findById(record.id))?.status).toBe(
      "ready",
    );
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

    await expectMissing(
      context,
      context.blobService.buildProcessedImageBlobName(USER_1_ID, record.id),
    );
  });

  it("keeps the output when a duplicate job already finished the item", async () => {
    const context = createContext();
    const record = await quarantine(context, await createPngFixture());
    const repository = context.mediaRepository;
    const markReady = repository.markReady.bind(repository);
    jest
      .spyOn(repository, "markReady")
      .mockImplementationOnce(async (...args) => {
        await markReady(...args);
        return false;
      });

    await context.service.process(record.id);

    const processedBlobName = context.blobService.buildProcessedImageBlobName(
      USER_1_ID,
      record.id,
    );
    await expect(
      context.blobService.readLocalBlob(processedBlobName),
    ).resolves.toMatchObject({ contentType: "image/webp" });
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
    it("rejects an unfinished item and clears its quarantine", async () => {
      const context = createContext();
      const record = await quarantine(context, await createPngFixture());

      await context.service.markProcessingFailed(record.id);

      await expect(
        context.mediaRepository.findById(record.id),
      ).resolves.toMatchObject({
        status: "rejected",
        rejectionReason: "The image could not be processed.",
      });
      await expectMissing(context, record.originalBlobName);
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
      await expect(
        context.blobService.readLocalBlob(record.originalBlobName),
      ).resolves.toBeDefined();
    });
  });
});
