import { describe, expect, it } from "vitest";
import {
  formatPostingAttributeLabel,
  formatPostingAttributeValue,
  formatPostingPrice,
  formatPublishedDate,
  humanizePostingValue,
  isRenderablePreviewImageUrl,
  resolvePhotoPreviewImage,
  resolvePostingCardImage,
} from "./public-format";

const VARIANTS = {
  thumbnail: "https://cdn.test/media/images/u/m.thumbnail.webp",
  medium: "https://cdn.test/media/images/u/m.medium.webp",
  large: "https://cdn.test/media/images/u/m.webp",
};

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

describe("resolvePostingCardImage", () => {
  it("keeps the card crop while it exists", () => {
    expect(
      resolvePostingCardImage({
        primaryThumbnailUrl: "https://cdn.test/thumbnails/m.webp",
        primaryPhotoUrl: VARIANTS.large,
        primaryPhotoVariants: VARIANTS,
      }),
    ).toEqual({ src: "https://cdn.test/thumbnails/m.webp", variants: null });
  });

  it("otherwise offers the primary photo's renditions", () => {
    expect(
      resolvePostingCardImage({
        primaryPhotoUrl: VARIANTS.large,
        primaryPhotoVariants: VARIANTS,
      }),
    ).toEqual({ src: VARIANTS.large, variants: VARIANTS });
    expect(
      resolvePostingCardImage({ primaryPhotoUrl: "https://cdn.test/a.jpg" }),
    ).toEqual({ src: "https://cdn.test/a.jpg", variants: null });
  });

  it("has nothing to show for seeded or missing photos", () => {
    expect(
      resolvePostingCardImage({
        primaryPhotoUrl: "https://example.com/dev-seed/main.jpg",
      }),
    ).toBeNull();
    expect(resolvePostingCardImage({})).toBeNull();
  });
});

describe("resolvePhotoPreviewImage", () => {
  it("prefers renditions to the card crop", () => {
    expect(
      resolvePhotoPreviewImage({
        blobUrl: VARIANTS.large,
        thumbnailBlobUrl: "https://cdn.test/thumbnails/m.webp",
        variants: VARIANTS,
      }),
    ).toEqual({ src: VARIANTS.large, variants: VARIANTS });
  });

  it("falls back to the crop, then the photo", () => {
    expect(
      resolvePhotoPreviewImage({
        blobUrl: "https://cdn.test/a.jpg",
        thumbnailBlobUrl: "https://cdn.test/thumbnails/a.webp",
      }),
    ).toEqual({ src: "https://cdn.test/thumbnails/a.webp", variants: null });
    expect(
      resolvePhotoPreviewImage({ blobUrl: "https://cdn.test/a.jpg" }),
    ).toEqual({ src: "https://cdn.test/a.jpg", variants: null });
  });

  it("has nothing to show for seeded or missing photos", () => {
    expect(
      resolvePhotoPreviewImage({
        blobUrl: "https://example.com/seed.jpg",
        variants: VARIANTS,
      }),
    ).toBeNull();
    expect(resolvePhotoPreviewImage(null)).toBeNull();
  });
});
