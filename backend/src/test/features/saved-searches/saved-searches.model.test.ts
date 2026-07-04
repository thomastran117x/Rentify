import {
  createSavedSearchRequestSchema,
  savedSearchParamsSchema,
  updateSavedSearchRequestSchema,
} from "@/features/saved-searches/saved-searches.model";

describe("savedSearchParamsSchema", () => {
  it("accepts an empty object", () => {
    const result = savedSearchParamsSchema.parse({});
    expect(result).toEqual({});
  });

  it("accepts all supported filter fields", () => {
    const result = savedSearchParamsSchema.parse({
      family: "equipment",
      subtype: "camera",
      city: "Vancouver",
      minDailyPrice: 10,
      maxDailyPrice: 200,
      tags: ["studio", "mirrorless"],
      availabilityStatus: "available",
      instantBooking: true,
      cancellationPolicy: "flexible",
    });

    expect(result).toEqual({
      family: "equipment",
      subtype: "camera",
      city: "Vancouver",
      minDailyPrice: 10,
      maxDailyPrice: 200,
      tags: ["studio", "mirrorless"],
      availabilityStatus: "available",
      instantBooking: true,
      cancellationPolicy: "flexible",
    });
  });

  it("rejects invalid family enum", () => {
    expect(() =>
      savedSearchParamsSchema.parse({ family: "boat" }),
    ).toThrow();
  });

  it("rejects negative prices", () => {
    expect(() =>
      savedSearchParamsSchema.parse({ minDailyPrice: -1 }),
    ).toThrow();
    expect(() =>
      savedSearchParamsSchema.parse({ maxDailyPrice: -50 }),
    ).toThrow();
  });

  it("rejects more than 10 tags", () => {
    expect(() =>
      savedSearchParamsSchema.parse({
        tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
      }),
    ).toThrow();
  });
});

describe("createSavedSearchRequestSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = createSavedSearchRequestSchema.parse({
      name: "My Camera Search",
      searchParams: { family: "equipment" },
    });

    expect(result.name).toBe("My Camera Search");
    expect(result.alertEnabled).toBe(true);
  });

  it("allows alertEnabled to be explicitly false", () => {
    const result = createSavedSearchRequestSchema.parse({
      name: "Silent watch",
      searchParams: {},
      alertEnabled: false,
    });

    expect(result.alertEnabled).toBe(false);
  });

  it("rejects empty name", () => {
    expect(() =>
      createSavedSearchRequestSchema.parse({
        name: "  ",
        searchParams: {},
      }),
    ).toThrow();
  });

  it("rejects name longer than 120 characters", () => {
    expect(() =>
      createSavedSearchRequestSchema.parse({
        name: "a".repeat(121),
        searchParams: {},
      }),
    ).toThrow();
  });
});

describe("updateSavedSearchRequestSchema", () => {
  it("accepts partial updates", () => {
    expect(
      updateSavedSearchRequestSchema.parse({ alertEnabled: false }),
    ).toEqual({ alertEnabled: false });

    expect(
      updateSavedSearchRequestSchema.parse({ name: "New Name" }),
    ).toEqual({ name: "New Name" });

    expect(
      updateSavedSearchRequestSchema.parse({
        searchParams: { city: "Toronto" },
      }),
    ).toEqual({ searchParams: { city: "Toronto" } });
  });

  it("rejects an empty update object", () => {
    expect(() => updateSavedSearchRequestSchema.parse({})).toThrow();
  });

  it("rejects invalid name in update", () => {
    expect(() =>
      updateSavedSearchRequestSchema.parse({ name: "" }),
    ).toThrow();
  });
});
