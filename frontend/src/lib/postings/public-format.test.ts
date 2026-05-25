import { describe, expect, it } from "vitest";
import {
  formatPostingAttributeLabel,
  formatPostingAttributeValue,
  formatPostingPrice,
  formatPublishedDate,
  humanizePostingValue,
  isRenderablePreviewImageUrl,
} from "./public-format";

describe("public posting format helpers", () => {
  it("humanizes labels and applies known overrides", () => {
    expect(humanizePostingValue("guest_capacity")).toBe("Guest Capacity");
    expect(formatPostingAttributeLabel("guest_capacity")).toBe(
      "Guest capacity",
    );
    expect(formatPostingAttributeLabel("vehicle_type")).toBe("Vehicle Type");
  });

  it("formats prices and published dates", () => {
    expect(formatPostingPrice(1450, "CAD")).toContain("1,450");
    expect(formatPublishedDate("2026-05-24T00:00:00.000Z")).toBeTruthy();
    expect(formatPublishedDate("not-a-date")).toBeNull();
  });

  it("formats attribute values across supported types", () => {
    expect(formatPostingAttributeValue(true)).toBe("Yes");
    expect(formatPostingAttributeValue(12.5)).toBe("12.5");
    expect(formatPostingAttributeValue(["wifi", "projector"])).toBe(
      "Wi-Fi, Projector",
    );
    expect(formatPostingAttributeValue("pet_friendly")).toBe("Pet Friendly");
  });

  it("filters placeholder preview image URLs", () => {
    expect(isRenderablePreviewImageUrl()).toBe(false);
    expect(isRenderablePreviewImageUrl("notaurl")).toBe(false);
    expect(isRenderablePreviewImageUrl("https://example.com/mock.jpg")).toBe(
      false,
    );
    expect(
      isRenderablePreviewImageUrl("https://cdn.rentify.test/photo.jpg"),
    ).toBe(true);
  });
});
