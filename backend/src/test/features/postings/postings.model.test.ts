import {
  placePostingDetailsSchema,
  placeUpsertPostingRequestSchema,
  postingBatchIdsQuerySchema,
  publicSearchPostingsQuerySchema,
  searchAttributeFilterSchema,
  toPublicPostingRecord,
  parsePostingDetailsForVariant,
  isPostingPubliclyVisible,
  isPostingSearchIndexable,
  type PostingRecord,
} from "@/features/postings/postings.model";

function createPostingRecord(
  overrides: Partial<PostingRecord> = {},
): PostingRecord {
  return {
    id: "posting-1",
    ownerId: "owner-1",
    status: "published",
    variant: {
      family: "place",
      subtype: "entire_place",
    },
    name: "Sunny loft",
    description: "Bright loft with workspace",
    pricing: {
      currency: "CAD",
      daily: {
        amount: 150,
      },
    },
    pricingCurrency: "CAD",
    photos: [
      {
        id: "photo-1",
        blobUrl: "https://example.blob.core.windows.net/postings/photo-1.jpg",
        blobName: "postings/photo-1.jpg",
        thumbnailBlobUrl:
          "https://example.blob.core.windows.net/postings/thumbnails/photo-1.webp",
        thumbnailBlobName: "postings/thumbnails/photo-1.webp",
        position: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ],
    tags: ["loft"],
    details: {
      guest_capacity: 4,
      property_type: "loft",
      amenities: ["wifi"],
    },
    availabilityStatus: "available",
    effectiveMaxBookingDurationDays: 30,
    availabilityBlocks: [],
    location: {
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      postalCode: "M5H 2N2",
      latitude: 43.65321,
      longitude: -79.38319,
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    publishedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("postings.model", () => {
  it("parses variant-specific posting details and keeps custom safe fields", () => {
    expect(
      parsePostingDetailsForVariant(
        {
          family: "place",
          subtype: "workspace",
        },
        {
          guest_capacity: 4,
          property_type: " loft ",
          amenities: [" wifi ", "wifi", " desk "],
          owner_note: "  Bring ID  ",
        },
      ),
    ).toEqual({
      guest_capacity: 4,
      property_type: "loft",
      amenities: ["wifi", "desk"],
      owner_note: "Bring ID",
    });
  });

  it("rejects reserved detail keys", () => {
    const result = placePostingDetailsSchema.safeParse({
      guest_capacity: 4,
      property_type: "loft",
      amenities: [],
      constructor: "boom",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["constructor"],
          message: "Reserved detail keys are not allowed.",
        }),
      ]),
    );
  });

  it("rejects posting tags containing commas", () => {
    const result = placeUpsertPostingRequestSchema.safeParse({
      variant: {
        family: "place",
        subtype: "workspace",
      },
      name: "Studio",
      description: "Bright place",
      pricing: {
        currency: "cad",
        daily: {
          amount: 100,
        },
      },
      photos: [
        {
          blobUrl: "https://example.blob.core.windows.net/postings/photo-1.jpg",
          blobName: "postings/photo-1.jpg",
          position: 0,
        },
      ],
      tags: ["camera, lens"],
      details: {
        guest_capacity: 4,
        property_type: "loft",
        amenities: [],
      },
      availabilityStatus: "available",
      availabilityBlocks: [],
      location: {
        latitude: 43.7,
        longitude: -79.4,
        city: "Toronto",
        region: "Ontario",
        country: "Canada",
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["tags", 0],
          message: "Tags cannot contain commas.",
        }),
      ]),
    );
  });

  it("requires paired availability and geo search parameters", () => {
    const result = publicSearchPostingsQuerySchema.safeParse({
      latitude: "43.6532",
      radiusKm: "12",
      startAt: "2026-06-01T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["startAt"],
          message: "startAt and endAt must be provided together.",
        }),
        expect.objectContaining({
          path: ["latitude"],
          message: "latitude and longitude must be provided together.",
        }),
        expect.objectContaining({
          path: ["longitude"],
          message: "latitude and longitude must be provided together.",
        }),
        expect.objectContaining({
          path: ["radiusKm"],
          message: "radiusKm requires both latitude and longitude.",
        }),
      ]),
    );
  });

  it("validates attribute filters and batch ids", () => {
    const filterResult = searchAttributeFilterSchema.safeParse({
      key: "bedrooms",
      min: 5,
      max: 2,
    });

    expect(filterResult.success).toBe(false);
    expect(filterResult.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["min"],
          message: "Attribute minimum cannot exceed attribute maximum.",
        }),
      ]),
    );

    expect(
      postingBatchIdsQuerySchema.parse(["posting-1", "posting-1", "posting_2"]),
    ).toEqual(["posting-1", "posting_2"]);

    const invalidIds = postingBatchIdsQuerySchema.safeParse(["posting 1"]);
    expect(invalidIds.success).toBe(false);
  });

  it("builds a public posting projection with rounded coordinates and primary media", () => {
    const publicPosting = toPublicPostingRecord(
      createPostingRecord({
        maxBookingDurationDays: undefined,
        effectiveMaxBookingDurationDays: 999,
      }),
    );

    expect(publicPosting.primaryPhotoUrl).toBe(
      "https://example.blob.core.windows.net/postings/photo-1.jpg",
    );
    expect(publicPosting.primaryThumbnailUrl).toBe(
      "https://example.blob.core.windows.net/postings/thumbnails/photo-1.webp",
    );
    expect(publicPosting.effectiveMaxBookingDurationDays).toBe(30);
    expect(publicPosting.location).toMatchObject({
      latitude: 43.65,
      longitude: -79.38,
    });
  });

  it("reports public visibility and indexability from posting status", () => {
    expect(
      isPostingPubliclyVisible({ status: "published", archivedAt: undefined }),
    ).toBe(true);
    expect(
      isPostingPubliclyVisible({ status: "paused", archivedAt: undefined }),
    ).toBe(false);
    expect(
      isPostingPubliclyVisible({
        status: "published",
        archivedAt: "2026-05-01T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(isPostingSearchIndexable("published")).toBe(true);
    expect(isPostingSearchIndexable("draft")).toBe(false);
  });
});
