import {
  getPostingSearchableAttributeDefinitions,
  getPostingVariantDefinition,
  isPostingFamilyValue,
  isPostingSubtypeValue,
  postingVariantCatalog,
} from "@/features/postings/postings.variants";

describe("postings.variants", () => {
  it("returns the matching family and subtype definitions for valid variants", () => {
    const result = getPostingVariantDefinition("place", "entire_place");

    expect(result).toEqual({
      family: postingVariantCatalog.place,
      subtype: {
        label: "Entire place",
      },
    });
  });

  it("returns null when the subtype does not belong to the family", () => {
    expect(getPostingVariantDefinition("place", "car")).toBeNull();
  });

  it("returns searchable attribute definitions for valid variants", () => {
    expect(getPostingSearchableAttributeDefinitions("vehicle", "car")).toEqual({
      fuel_type: { kind: "string" },
      license_class: { kind: "string" },
      make: { kind: "string" },
      model: { kind: "string" },
      seats: { kind: "integer", min: 1, max: 200 },
      transmission: { kind: "string" },
      year: { kind: "integer", min: 1886, max: 9999 },
    });
  });

  it("returns null searchable attributes for invalid family and subtype pairs", () => {
    expect(
      getPostingSearchableAttributeDefinitions("equipment", "shared_room"),
    ).toBeNull();
  });

  it("recognizes valid family and subtype values", () => {
    expect(isPostingFamilyValue("place")).toBe(true);
    expect(isPostingFamilyValue("aircraft")).toBe(false);
    expect(isPostingSubtypeValue("workspace")).toBe(true);
    expect(isPostingSubtypeValue("yacht")).toBe(false);
  });
});
