import type { MediaRecord } from "@/features/media/media.model";
import {
  keepsQuarantinedUpload,
  rejectMedia,
} from "@/features/media/media-rejection";
import { RecordingMediaMetrics } from "../../support/recording-media-metrics";
import { testUuid } from "../../support/uuid";

const MEDIA_ID = testUuid(9000, 994600);
const USER_ID = testUuid(9000, 994601);

function record(): MediaRecord {
  return {
    id: MEDIA_ID,
    userId: USER_ID,
    status: "processing",
    scope: "postings",
    originalBlobName: `quarantine/images/${USER_ID}/${MEDIA_ID}`,
  } as MediaRecord;
}

function createDependencies(rejected = true) {
  return {
    mediaRepository: {
      markRejected: jest.fn(async () => rejected),
    },
    blobService: { deleteBlob: jest.fn(async () => undefined) },
    logger: { warn: jest.fn() },
    metrics: new RecordingMediaMetrics(),
  };
}

describe("rejectMedia", () => {
  it("records the reason and code, then deletes the upload", async () => {
    const dependencies = createDependencies();

    await expect(
      rejectMedia(
        dependencies,
        record(),
        "Not an image.",
        "corrupt",
        "processing",
      ),
    ).resolves.toBe(true);

    expect(dependencies.mediaRepository.markRejected).toHaveBeenCalledWith(
      MEDIA_ID,
      "Not an image.",
      "corrupt",
    );
    expect(dependencies.blobService.deleteBlob).toHaveBeenCalledWith(
      record().originalBlobName,
    );
    expect(dependencies.metrics.tagsOf("media.rejected")).toEqual([
      { code: "corrupt", stage: "processing" },
    ]);
    dependencies.metrics.assertNoIdentifiers();
  });

  it("keeps the upload of a processing failure so it can be replayed", async () => {
    const dependencies = createDependencies();

    await expect(
      rejectMedia(
        dependencies,
        record(),
        "The image could not be processed.",
        "processing_failed",
        "dead_letter",
      ),
    ).resolves.toBe(true);

    expect(dependencies.blobService.deleteBlob).not.toHaveBeenCalled();
    expect(dependencies.metrics.tagsOf("media.rejected")).toEqual([
      { code: "processing_failed", stage: "dead_letter" },
    ]);
  });

  it("leaves the upload alone when another actor already finished the item", async () => {
    const dependencies = createDependencies(false);

    await expect(
      rejectMedia(
        dependencies,
        record(),
        "Not an image.",
        "corrupt",
        "processing",
      ),
    ).resolves.toBe(false);

    expect(dependencies.blobService.deleteBlob).not.toHaveBeenCalled();
    // The actor that did reject it has already counted it.
    expect(dependencies.metrics.count("media.rejected")).toBe(0);
  });

  it("keeps an upload for processing failures only", () => {
    expect(keepsQuarantinedUpload("processing_failed")).toBe(true);
    for (const code of [
      "corrupt",
      "too_large",
      "abandoned",
      "malware",
      "moderation",
    ] as const) {
      expect(keepsQuarantinedUpload(code)).toBe(false);
    }
  });
});
