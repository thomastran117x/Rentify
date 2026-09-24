import { BlobService } from "@/features/blob/blob.service";
import { describeImageVariants } from "@/features/media/image-variants";
import {
  restoreBlobEnvironmentAfterEach,
  useAzureBlobStorage,
  useLocalBlobStorage,
} from "../../support/blob-environment";
import { testUuid } from "../../support/uuid";

const OWNER_ID = testUuid(9300, 1);
const MEDIA_ID = testUuid(9300, 2);
const PROCESSED = `media/images/${OWNER_ID}/${MEDIA_ID}.webp`;
const MEDIUM = `media/images/${OWNER_ID}/${MEDIA_ID}.medium.webp`;
const THUMBNAIL = `media/images/${OWNER_ID}/${MEDIA_ID}.thumbnail.webp`;

restoreBlobEnvironmentAfterEach();

describe("describeImageVariants", () => {
  it.each([
    ["Azure", useAzureBlobStorage],
    ["local development", useLocalBlobStorage],
  ])(
    "addresses each rendition where storage serves it on %s",
    (_label, useStorage) => {
      useStorage();
      const blobService = new BlobService();

      expect(
        describeImageVariants(PROCESSED, blobService.getBlobUrl(PROCESSED)),
      ).toEqual({
        thumbnail: blobService.getBlobUrl(THUMBNAIL),
        medium: blobService.getBlobUrl(MEDIUM),
        large: blobService.getBlobUrl(PROCESSED),
      });
    },
  );

  it("keeps the stored URL as the large rendition", () => {
    const stored = `https://cdn.test/uploads/${PROCESSED}`;

    expect(describeImageVariants(PROCESSED, stored)).toEqual({
      thumbnail: `https://cdn.test/uploads/${THUMBNAIL}`,
      medium: `https://cdn.test/uploads/${MEDIUM}`,
      large: stored,
    });
  });

  it.each([
    [
      "a seeded photo",
      "dev-seed/postings/loft/main.jpg",
      "https://example.com/dev-seed/postings/loft/main.jpg",
    ],
    [
      "a pre-media upload",
      `postings/photos/${OWNER_ID}/1-a.webp`,
      `https://cdn.test/uploads/postings/photos/${OWNER_ID}/1-a.webp`,
    ],
    [
      "a posting crop",
      `media/images/${OWNER_ID}/thumbnails/${MEDIA_ID}.webp`,
      `https://cdn.test/uploads/media/images/${OWNER_ID}/thumbnails/${MEDIA_ID}.webp`,
    ],
    [
      "a URL for another blob",
      PROCESSED,
      `https://cdn.test/uploads/media/images/${OWNER_ID}/other.webp`,
    ],
    [
      "a signed URL",
      PROCESSED,
      `https://cdn.test/uploads/${PROCESSED}?sig=abc`,
    ],
    [
      "a local URL for another blob",
      PROCESSED,
      `http://localhost:8040/api/v1/blob/file?blobName=${encodeURIComponent(MEDIUM)}`,
    ],
    ["an unparseable URL", PROCESSED, "not a url"],
    ["no name", null, `https://cdn.test/uploads/${PROCESSED}`],
    ["no URL", PROCESSED, undefined],
  ])("has no renditions for %s", (_label, blobName, blobUrl) => {
    expect(describeImageVariants(blobName, blobUrl)).toBeNull();
  });
});
