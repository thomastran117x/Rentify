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
import { testUuid } from "../../support/uuid";

function createBaseUpsertBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    variant: { family: "place", subtype: "workspace" },
    name: "Studio",
    description: "Bright place",
    pricing: { currency: "cad", daily: { amount: 100 } },
    photos: [
      {
        blobUrl: "https://example.blob.core.windows.net/postings/photo-1.jpg",
        blobName: "postings/photo-1.jpg",
        position: 0,
      },
    ],
    tags: [],
    details: { guest_capacity: 2, property_type: "studio", amenities: [] },
    availabilityStatus: "available",
    availabilityBlocks: [],
    location: {
      latitude: 43.7,
      longitude: -79.4,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
    },
    ...overrides,
  } as any;
}

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
    instantBooking: false,
    reviewCount: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    publishedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  } as any;
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

  it("accepts organization filters and the organization sort values", () => {
    const result = publicSearchPostingsQuerySchema.safeParse({
      organization: "  Maya Santos Organization  ",
      organizationId: "6f1c8b2e-6b0a-4f0e-9b6e-2f9a1c2d3e4f",
      sort: "organizationAsc",
    });

    expect(result.success).toBe(true);
    expect(result.data?.organization).toBe("Maya Santos Organization");
    expect(result.data?.organizationId).toBe(
      "6f1c8b2e-6b0a-4f0e-9b6e-2f9a1c2d3e4f",
    );
    expect(result.data?.sort).toBe("organizationAsc");

    expect(
      publicSearchPostingsQuerySchema.safeParse({ sort: "organizationDesc" })
        .success,
    ).toBe(true);
  });

  it("accepts deterministic seeded organization ids", () => {
    // Seeded ids are well-formed 8-4-4-4-12 identifiers but carry zeroed
    // version and variant bits, so an RFC 4122 check rejects them and the
    // organization filter stops working against seeded data.
    for (const organizationId of [
      "00000000-0000-0000-1040-000000000016",
      "00000000-0000-0000-1040-000000000001",
      "00000000-0000-0000-2000-000000000003",
    ]) {
      const result = publicSearchPostingsQuerySchema.safeParse({
        organizationId,
      });

      expect(result.success).toBe(true);
      expect(result.data?.organizationId).toBe(organizationId);
    }
  });

  it("rejects a malformed organization id and a blank organization name", () => {
    expect(
      publicSearchPostingsQuerySchema.safeParse({ organizationId: "org-1" })
        .success,
    ).toBe(false);
    expect(
      publicSearchPostingsQuerySchema.safeParse({ organization: "   " })
        .success,
    ).toBe(false);
    expect(
      publicSearchPostingsQuerySchema.safeParse({
        organization: "a".repeat(161),
      }).success,
    ).toBe(false);
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

    const firstId = testUuid(2000, 1);
    const secondId = testUuid(2000, 2);

    expect(
      postingBatchIdsQuerySchema.parse([firstId, firstId, secondId]),
    ).toEqual([firstId, secondId]);

    const invalidIds = postingBatchIdsQuerySchema.safeParse(["posting 1"]);
    expect(invalidIds.success).toBe(false);

    // Batch ids go through the same identifier schema as the route param, so a
    // syntactically safe but non-identifier value is rejected too.
    expect(postingBatchIdsQuerySchema.safeParse(["posting-1"]).success).toBe(
      false,
    );
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

  it("accepts valid minBookingDurationDays and advanceNoticeDays fields", () => {
    const result = placeUpsertPostingRequestSchema.safeParse(
      createBaseUpsertBody({
        minBookingDurationDays: 2,
        maxBookingDurationDays: 7,
        advanceNoticeDays: 1,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.minBookingDurationDays).toBe(2);
    expect(result.data?.maxBookingDurationDays).toBe(7);
    expect(result.data?.advanceNoticeDays).toBe(1);
  });

  it("accepts advanceNoticeDays of 0 (same-day booking)", () => {
    const result = placeUpsertPostingRequestSchema.safeParse(
      createBaseUpsertBody({ advanceNoticeDays: 0 }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.advanceNoticeDays).toBe(0);
  });

  it("rejects minBookingDurationDays below 1", () => {
    const result = placeUpsertPostingRequestSchema.safeParse(
      createBaseUpsertBody({ minBookingDurationDays: 0 }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["minBookingDurationDays"] }),
      ]),
    );
  });

  it("rejects advanceNoticeDays above 365", () => {
    const result = placeUpsertPostingRequestSchema.safeParse(
      createBaseUpsertBody({ advanceNoticeDays: 366 }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["advanceNoticeDays"] }),
      ]),
    );
  });

  it("accepts valid cancellationPolicy values", () => {
    for (const policy of ["flexible", "moderate", "strict"] as const) {
      const result = placeUpsertPostingRequestSchema.safeParse(
        createBaseUpsertBody({
          cancellationPolicy: policy,
          cancellationPolicyNotes: "Full refund if cancelled 48h ahead.",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.data?.cancellationPolicy).toBe(policy);
      expect(result.data?.cancellationPolicyNotes).toBe(
        "Full refund if cancelled 48h ahead.",
      );
    }
  });

  it("rejects an invalid cancellationPolicy value", () => {
    const result = placeUpsertPostingRequestSchema.safeParse(
      createBaseUpsertBody({ cancellationPolicy: "super_strict" }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["cancellationPolicy"] }),
      ]),
    );
  });

  it("rejects cancellationPolicyNotes exceeding 500 characters", () => {
    const result = placeUpsertPostingRequestSchema.safeParse(
      createBaseUpsertBody({
        cancellationPolicy: "flexible",
        cancellationPolicyNotes: "x".repeat(501),
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["cancellationPolicyNotes"] }),
      ]),
    );
  });

  it("passes through omitted booking rule fields as undefined", () => {
    const result = placeUpsertPostingRequestSchema.safeParse(
      createBaseUpsertBody(),
    );

    expect(result.success).toBe(true);
    expect(result.data?.minBookingDurationDays).toBeUndefined();
    expect(result.data?.advanceNoticeDays).toBeUndefined();
    expect(result.data?.cancellationPolicy).toBeUndefined();
    expect(result.data?.cancellationPolicyNotes).toBeUndefined();
  });
});
