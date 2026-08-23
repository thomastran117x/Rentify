import {
  updatePostingRequestSchema,
  upsertPostingRequestSchema,
} from "@/features/postings/postings.model";

function createBody(overrides: Record<string, unknown> = {}) {
  return {
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
    photos: [
      {
        blobUrl: "https://example.test/photo-1.jpg",
        blobName: "postings/photo-1.jpg",
        position: 0,
      },
    ],
    tags: ["loft"],
    details: {
      guest_capacity: 4,
      property_type: "loft",
      amenities: ["wifi"],
    },
    availabilityStatus: "available",
    availabilityBlocks: [],
    location: {
      latitude: 43.6532,
      longitude: -79.3832,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
    },
    ...overrides,
  };
}

describe("posting upsert schema expiresAt", () => {
  it("accepts an ISO datetime", () => {
    const result = upsertPostingRequestSchema.safeParse(
      createBody({ expiresAt: "2026-09-01T23:59:59.999Z" }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts null, meaning the listing never expires", () => {
    const result = upsertPostingRequestSchema.safeParse(
      createBody({ expiresAt: null }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts an omitted expiry", () => {
    const result = upsertPostingRequestSchema.safeParse(createBody());

    expect(result.success).toBe(true);
  });

  it("rejects a plain calendar date", () => {
    const result = upsertPostingRequestSchema.safeParse(
      createBody({ expiresAt: "2026-09-01" }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects a non-string expiry", () => {
    const result = upsertPostingRequestSchema.safeParse(
      createBody({ expiresAt: 1_788_000_000_000 }),
    );

    expect(result.success).toBe(false);
  });

  it("still rejects genuinely unknown keys", () => {
    const result = upsertPostingRequestSchema.safeParse(
      createBody({ expiresAtt: "2026-09-01T23:59:59.999Z" }),
    );

    expect(result.success).toBe(false);
  });

  it("reaches the update schema too", () => {
    const { availabilityBlocks: _ignored, ...updateBody } = createBody({
      expiresAt: "2026-09-01T23:59:59.999Z",
    });
    const result = updatePostingRequestSchema.safeParse(updateBody);

    expect(result.success).toBe(true);
  });

  it("reaches every posting family", () => {
    const equipment = upsertPostingRequestSchema.safeParse(
      createBody({
        variant: { family: "equipment", subtype: "tool" },
        details: { condition: "Good working order" },
        expiresAt: "2026-09-01T23:59:59.999Z",
      }),
    );
    const vehicle = upsertPostingRequestSchema.safeParse(
      createBody({
        variant: { family: "vehicle", subtype: "car" },
        details: {
          make: "Toyota",
          model: "Corolla",
          year: 2022,
          seats: 5,
          license_class: "Class G",
        },
        expiresAt: "2026-09-01T23:59:59.999Z",
      }),
    );

    expect(equipment.success).toBe(true);
    expect(vehicle.success).toBe(true);
  });
});
