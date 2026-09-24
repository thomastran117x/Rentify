import sharp from "sharp";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { BlobService } from "@/features/blob/blob.service";
import type { MediaRecord } from "@/features/media/media.model";
import {
  mediaVariantsBackfillExitCode,
  MediaVariantsBackfillService,
} from "@/features/media/media-variants-backfill.service";
import { InMemoryMediaRepository } from "../../support/in-memory-media-repository";
import {
  restoreBlobEnvironmentAfterEach,
  useLocalBlobStorage,
} from "../../support/blob-environment";
import { testUuid } from "../../support/uuid";

const USER_ID = testUuid(9200, 1);
let nextMediaIndex = 10;

restoreBlobEnvironmentAfterEach();

function createContext() {
  useLocalBlobStorage();
  const blobService = new BlobService();
  const repository = new InMemoryMediaRepository();

  return {
    blobService,
    repository,
    service: new MediaVariantsBackfillService(
      repository.asRepository(),
      blobService,
    ),
  };
}

type Context = ReturnType<typeof createContext>;

/** A ready item processed before renditions existed, with its stored image. */
async function addLegacyReadyMedia(
  context: Context,
  options: { width?: number; height?: number; stored?: boolean } = {},
): Promise<MediaRecord & { renditions: string[] }> {
  const id = testUuid(9200, nextMediaIndex++);
  const processedBlobName = context.blobService.buildProcessedImageBlobName(
    USER_ID,
    id,
  );
  const names =
    context.blobService.buildImageVariantBlobNames(processedBlobName)!;
  const renditions = [names.large, names.medium, names.thumbnail];

  // Local storage outlives a run and ids repeat between runs.
  for (const blobName of renditions) {
    await context.blobService.deleteBlob(blobName);
  }

  if (options.stored ?? true) {
    await context.blobService.uploadBuffer({
      blobName: processedBlobName,
      body: await sharp({
        create: {
          width: options.width ?? 1600,
          height: options.height ?? 1200,
          channels: 3,
          background: { r: 30, g: 90, b: 160 },
        },
      })
        .webp()
        .toBuffer(),
      contentType: "image/webp",
    });
  }

  const now = new Date();
  const record: MediaRecord = {
    id,
    userId: USER_ID,
    status: "ready",
    scope: "postings",
    originalBlobName: `quarantine/images/${USER_ID}/${id}`,
    processedBlobName,
    declaredContentType: "image/png",
    detectedContentType: "image/png",
    originalFilename: null,
    originalEtag: null,
    sizeBytes: 1,
    width: options.width ?? 1600,
    height: options.height ?? 1200,
    variants: null,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
  };

  context.repository.put(record);
  return { ...record, renditions };
}

async function readDimensions(context: Context, blobName: string) {
  const stored = await context.blobService.readLocalBlob(blobName);
  const { width, height, format } = await sharp(stored.body).metadata();

  return { width, height, format, contentType: stored.contentType };
}

describe("MediaVariantsBackfillService", () => {
  it("writes and records the renditions of ready media that has none", async () => {
    const context = createContext();
    const legacy = await addLegacyReadyMedia(context);
    const [, medium, thumbnail] = legacy.renditions;

    const result = await context.service.run({ dryRun: false, batchSize: 1 });

    expect(result).toMatchObject({
      mode: "backfill",
      scanned: 1,
      converted: 1,
      skipped: 0,
      failed: 0,
      pending: [],
    });
    await expect(readDimensions(context, medium!)).resolves.toEqual({
      width: 800,
      height: 600,
      format: "webp",
      contentType: "image/webp",
    });
    await expect(readDimensions(context, thumbnail!)).resolves.toMatchObject({
      width: 300,
      height: 225,
    });
    expect(
      (await context.repository.findById(legacy.id))?.variants,
    ).toMatchObject({
      medium: { width: 800, height: 600 },
      thumbnail: { width: 300, height: 225 },
    });
    expect(mediaVariantsBackfillExitCode(result)).toBe(0);
  });

  it("does nothing on a second run", async () => {
    const context = createContext();
    await addLegacyReadyMedia(context);
    await context.service.run({ dryRun: false });

    const again = await context.service.run({ dryRun: false });

    expect(again).toMatchObject({ scanned: 0, converted: 0, failed: 0 });
  });

  it("lists what it would convert on a dry run and writes nothing", async () => {
    const context = createContext();
    const legacy = await addLegacyReadyMedia(context);

    const result = await context.service.run({ dryRun: true });

    expect(result).toMatchObject({
      mode: "dry-run",
      scanned: 1,
      converted: 0,
      pending: [
        { mediaId: legacy.id, processedBlobName: legacy.processedBlobName },
      ],
    });
    await expect(
      context.blobService.readLocalBlob(legacy.renditions[1]!),
    ).rejects.toThrow(ResourceNotFoundError);
    expect((await context.repository.findById(legacy.id))?.variants).toBeNull();
  });

  it("reports an item whose processed image is missing and carries on", async () => {
    const context = createContext();
    const missing = await addLegacyReadyMedia(context, { stored: false });
    const present = await addLegacyReadyMedia(context);

    const result = await context.service.run({ dryRun: false });

    expect(result).toMatchObject({ scanned: 2, converted: 1, failed: 1 });
    expect(result.failures).toEqual([
      {
        mediaId: missing.id,
        processedBlobName: missing.processedBlobName,
        message: "The processed image could not be found.",
      },
    ]);
    expect(
      (await context.repository.findById(present.id))?.variants,
    ).not.toBeNull();
    expect(mediaVariantsBackfillExitCode(result)).toBe(1);
  });

  it("reports a failure that is not an Error", async () => {
    const context = createContext();
    await addLegacyReadyMedia(context);
    jest.spyOn(context.blobService, "uploadBuffer").mockRejectedValue("down");

    const result = await context.service.run({ dryRun: false });

    expect(result.failures[0]?.message).toBe("Unknown backfill error.");
  });

  it("deletes what it wrote for an item deleted mid-run", async () => {
    const context = createContext();
    const legacy = await addLegacyReadyMedia(context);
    const setVariants = context.repository.setVariants.bind(context.repository);
    jest
      .spyOn(context.repository, "setVariants")
      .mockImplementationOnce(async (...args) => {
        await context.repository.deleteById(legacy.id);
        return setVariants(...args);
      });

    const result = await context.service.run({ dryRun: false });

    expect(result).toMatchObject({ converted: 0, skipped: 1, failed: 0 });
    for (const blobName of legacy.renditions.slice(1)) {
      await expect(context.blobService.readLocalBlob(blobName)).rejects.toThrow(
        ResourceNotFoundError,
      );
    }
  });

  it("keeps renditions a concurrent run already recorded", async () => {
    const context = createContext();
    const legacy = await addLegacyReadyMedia(context);
    const setVariants = context.repository.setVariants.bind(context.repository);
    jest
      .spyOn(context.repository, "setVariants")
      .mockImplementationOnce(async (...args) => {
        await setVariants(...args);
        return false;
      });

    const result = await context.service.run({ dryRun: false });

    expect(result).toMatchObject({ converted: 0, skipped: 1 });
    await expect(
      context.blobService.readLocalBlob(legacy.renditions[2]!),
    ).resolves.toBeDefined();
  });

  it("refuses a row whose processed name has no renditions", async () => {
    const context = createContext();
    const legacy = await addLegacyReadyMedia(context);
    context.repository.put({
      ...legacy,
      processedBlobName: `postings/photos/${USER_ID}/legacy.webp`,
    });

    const result = await context.service.run({ dryRun: false });

    expect(result.failures[0]?.message).toBe(
      "The processed image name has no renditions.",
    );
  });
});
