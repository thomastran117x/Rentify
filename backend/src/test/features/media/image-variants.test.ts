import { BlobService } from "@/features/blob/blob.service";
import {
  buildImageVariants,
  containsImageVariantsReference,
  ImageVariantsResolver,
  referenceImageVariants,
  withoutImageVariantsReferences,
} from "@/features/media/image-variants";
import type { RecordedRenditions } from "@/features/media/media.model";
import {
  restoreBlobEnvironmentAfterEach,
  useConnectionStringBlobStorage,
  useLocalBlobStorage,
} from "../../support/blob-environment";
import { testUuid } from "../../support/uuid";

const OWNER_ID = testUuid(9300, 1);
const MEDIA_ID = testUuid(9300, 2);
const PROCESSED = `media/images/${OWNER_ID}/${MEDIA_ID}.webp`;
const MEDIUM = `media/images/${OWNER_ID}/${MEDIA_ID}.medium.webp`;
const THUMBNAIL = `media/images/${OWNER_ID}/${MEDIA_ID}.thumbnail.webp`;
const STORED_URL = `https://cdn.test/uploads/${PROCESSED}`;

const RECORDED: RecordedRenditions = {
  width: 1600,
  height: 1200,
  variants: {
    medium: { width: 800, height: 600, sizeBytes: 5000 },
    thumbnail: { width: 300, height: 225, sizeBytes: 900 },
  },
};

restoreBlobEnvironmentAfterEach();

describe("referenceImageVariants", () => {
  it("marks a processed image for the resolver", () => {
    expect(referenceImageVariants(` ${PROCESSED} `, STORED_URL)).toEqual({
      $imageVariants: { blobName: PROCESSED, blobUrl: STORED_URL },
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
    ["a signed URL", PROCESSED, `${STORED_URL}?sig=abc`],
    [
      "a local URL for another blob",
      PROCESSED,
      `http://localhost:8040/api/v1/blob/file?blobName=${encodeURIComponent(MEDIUM)}`,
    ],
    ["an unparseable URL", PROCESSED, "not a url"],
    ["no name", null, STORED_URL],
    ["no URL", PROCESSED, undefined],
  ])("has nothing to reference for %s", (_label, blobName, blobUrl) => {
    expect(referenceImageVariants(blobName, blobUrl)).toBeNull();
  });
});

describe("buildImageVariants", () => {
  it.each([
    ["Azure", useConnectionStringBlobStorage],
    ["local development", useLocalBlobStorage],
  ])(
    "addresses each rendition where storage serves it on %s",
    (_label, useStorage) => {
      useStorage();
      const blobService = new BlobService();

      expect(
        buildImageVariants(
          PROCESSED,
          blobService.getBlobUrl(PROCESSED),
          RECORDED,
        ),
      ).toEqual({
        thumbnail: {
          url: blobService.getBlobUrl(THUMBNAIL),
          width: 300,
          height: 225,
        },
        medium: {
          url: blobService.getBlobUrl(MEDIUM),
          width: 800,
          height: 600,
        },
        large: {
          url: blobService.getBlobUrl(PROCESSED),
          width: 1600,
          height: 1200,
        },
      });
    },
  );

  it("gives the large rendition for one that was not written", () => {
    const large = { url: STORED_URL, width: 500, height: 400 };

    expect(
      buildImageVariants(PROCESSED, STORED_URL, {
        width: 500,
        height: 400,
        variants: {
          medium: null,
          thumbnail: { width: 300, height: 240, sizeBytes: 900 },
        },
      }),
    ).toEqual({
      thumbnail: {
        url: `https://cdn.test/uploads/${THUMBNAIL}`,
        width: 300,
        height: 240,
      },
      medium: large,
      large,
    });
  });

  it.each([
    ["no media row", undefined],
    ["renditions not yet backfilled", { ...RECORDED, variants: null }],
    ["unknown dimensions", { ...RECORDED, width: null }],
  ])("has none with %s", (_label, recorded) => {
    expect(buildImageVariants(PROCESSED, STORED_URL, recorded)).toBeNull();
  });

  it("has none for a URL that does not address the image", () => {
    expect(
      buildImageVariants(PROCESSED, "https://cdn.test/other.webp", RECORDED),
    ).toBeNull();
  });
});

describe("ImageVariantsResolver", () => {
  function createResolver(
    recorded: Record<string, RecordedRenditions> = { [PROCESSED]: RECORDED },
  ) {
    const findRecordedRenditions = jest.fn(
      async (names: string[]) =>
        new Map(
          names.flatMap((name) =>
            recorded[name] ? [[name, recorded[name]] as const] : [],
          ),
        ),
    );

    return {
      findRecordedRenditions,
      resolver: new ImageVariantsResolver({ findRecordedRenditions }),
    };
  }

  it("resolves every reference in a payload with one lookup, without changing it", async () => {
    const legacy = `media/images/${OWNER_ID}/${testUuid(9300, 3)}.webp`;
    const payload = {
      data: {
        postings: [
          {
            primaryPhotoVariants: referenceImageVariants(PROCESSED, STORED_URL),
            photos: [
              { variants: referenceImageVariants(PROCESSED, STORED_URL) },
              {
                variants: referenceImageVariants(
                  legacy,
                  `https://cdn.test/uploads/${legacy}`,
                ),
              },
            ],
          },
        ],
        createdAt: new Date("2026-09-28T00:00:00.000Z"),
      },
    };
    const snapshot = structuredClone(payload);
    const { findRecordedRenditions, resolver } = createResolver();

    const resolved = await resolver.resolve(payload);

    expect(findRecordedRenditions).toHaveBeenCalledTimes(1);
    expect(findRecordedRenditions).toHaveBeenCalledWith([PROCESSED, legacy]);
    const [posting] = resolved.data.postings;
    expect(posting?.primaryPhotoVariants).toMatchObject({
      medium: { url: `https://cdn.test/uploads/${MEDIUM}`, width: 800 },
    });
    expect(posting?.photos[0]?.variants).toEqual(posting?.primaryPhotoVariants);
    // No media row records it, so it has no renditions.
    expect(posting?.photos[1]?.variants).toBeNull();
    expect(resolved.data.createdAt).toBe(payload.data.createdAt);
    // A cached object passed in is left as it was.
    expect(payload).toEqual(snapshot);
    expect(containsImageVariantsReference(resolved)).toBe(false);
  });

  it("returns a payload with no references as it is, without a lookup", async () => {
    const payload = { data: { name: "Loft", variants: null } };
    const { findRecordedRenditions, resolver } = createResolver();

    await expect(resolver.resolve(payload)).resolves.toBe(payload);
    expect(findRecordedRenditions).not.toHaveBeenCalled();
    expect(containsImageVariantsReference(payload)).toBe(false);
  });

  it("can clear every reference when they cannot be resolved", () => {
    const payload = {
      items: [{ variants: referenceImageVariants(PROCESSED, STORED_URL) }],
    };

    expect(containsImageVariantsReference(payload)).toBe(true);
    expect(withoutImageVariantsReferences(payload)).toEqual({
      items: [{ variants: null }],
    });
  });
});
