import { BlobService } from "@/features/blob/blob.service";
import {
  buildImageVariantBlobNames,
  listImageVariantBlobNames,
} from "@/features/blob/image-variant-names";
import { testUuid } from "../../support/uuid";
import {
  restoreBlobEnvironmentAfterEach,
  useLocalBlobStorage,
} from "../../support/blob-environment";

const OWNER_ID = testUuid(9100, 1);
const MEDIA_ID = testUuid(9100, 2);
const PROCESSED = `media/images/${OWNER_ID}/${MEDIA_ID}.webp`;

restoreBlobEnvironmentAfterEach();

describe("image variant names", () => {
  it("names the renditions of a processed image beside it", () => {
    expect(buildImageVariantBlobNames(` ${PROCESSED} `)).toEqual({
      large: PROCESSED,
      medium: `media/images/${OWNER_ID}/${MEDIA_ID}.medium.webp`,
      thumbnail: `media/images/${OWNER_ID}/${MEDIA_ID}.thumbnail.webp`,
    });
    expect(listImageVariantBlobNames(PROCESSED)).toEqual([
      PROCESSED,
      `media/images/${OWNER_ID}/${MEDIA_ID}.medium.webp`,
      `media/images/${OWNER_ID}/${MEDIA_ID}.thumbnail.webp`,
    ]);
  });

  it.each([
    ["a variant", `media/images/${OWNER_ID}/${MEDIA_ID}.medium.webp`],
    ["a posting crop", `media/images/${OWNER_ID}/thumbnails/${MEDIA_ID}.webp`],
    ["a pre-media upload", `postings/photos/${OWNER_ID}/1-a.webp`],
    ["a seeded photo", "dev-seed/postings/loft/main.jpg"],
    ["a quarantined upload", `quarantine/images/${OWNER_ID}/${MEDIA_ID}`],
    ["another extension", `media/images/${OWNER_ID}/${MEDIA_ID}.png`],
    ["a traversal", `media/images/../${MEDIA_ID}.webp`],
    ["an empty name", ""],
  ])("has no renditions for %s", (_label, blobName) => {
    expect(buildImageVariantBlobNames(blobName)).toBeNull();
    expect(listImageVariantBlobNames(blobName)).toEqual([]);
  });

  it("keeps variant names readable by the owner and processed-image checks", () => {
    useLocalBlobStorage();
    const service = new BlobService();
    const variants = service.buildImageVariantBlobNames(PROCESSED);

    expect(variants).not.toBeNull();

    for (const blobName of Object.values(variants ?? {})) {
      expect(service.getBlobOwnerId(blobName)).toBe(OWNER_ID);
      expect(service.isProcessedImageBlobName(blobName)).toBe(true);
      expect(service.isQuarantineBlobName(blobName)).toBe(false);
    }
  });
});
