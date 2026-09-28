import type { ImageVariants } from "@/lib/media/api";

export type PublicPostingAvailabilityStatus =
  | "available"
  | "limited"
  | "unavailable";

const ATTRIBUTE_LABEL_OVERRIDES: Record<string, string> = {
  guest_capacity: "Guest capacity",
  property_type: "Property type",
  pet_friendly: "Pet friendly",
  weight_lb: "Weight (lb)",
  license_class: "License class",
};

const VALUE_TOKEN_OVERRIDES: Record<string, string> = {
  wifi: "Wi-Fi",
};

export function humanizePostingValue(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatPostingPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPublishedDate(value?: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

export function isRenderablePreviewImageUrl(value?: string): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.hostname !== "example.com";
  } catch {
    return false;
  }
}

/** An image to draw, with the renditions to choose from when it has them. */
export interface PreviewImage {
  src: string;
  variants: ImageVariants | null;
}

/**
 * The image a posting card shows. The 640x480 card crop is kept while it
 * exists, since it is already card-sized; otherwise the primary photo, with
 * its renditions so the browser fetches the medium one, not the full image.
 */
export function resolvePostingCardImage(posting: {
  primaryThumbnailUrl?: string;
  primaryPhotoUrl?: string;
  primaryPhotoVariants?: ImageVariants | null;
}): PreviewImage | null {
  if (isRenderablePreviewImageUrl(posting.primaryThumbnailUrl)) {
    return { src: posting.primaryThumbnailUrl, variants: null };
  }

  if (isRenderablePreviewImageUrl(posting.primaryPhotoUrl)) {
    return {
      src: posting.primaryPhotoUrl,
      variants: posting.primaryPhotoVariants ?? null,
    };
  }

  return null;
}

/**
 * The image for a photo drawn smaller than a card, such as a list thumbnail.
 * Its renditions are offered first, since even the thumbnail rendition is
 * smaller than the card crop. The crop, or else the photo, is the plain URL, so
 * a rendition that fails to load falls back to the crop, not the full image.
 */
export function resolvePhotoPreviewImage(
  photo:
    | {
        blobUrl?: string;
        thumbnailBlobUrl?: string;
        variants?: ImageVariants | null;
      }
    | null
    | undefined,
): PreviewImage | null {
  const url = [photo?.thumbnailBlobUrl, photo?.blobUrl].find(
    isRenderablePreviewImageUrl,
  );

  if (!url) {
    return null;
  }

  return {
    src: url,
    variants:
      photo?.variants && isRenderablePreviewImageUrl(photo.blobUrl)
        ? photo.variants
        : null,
  };
}

export function formatPostingAttributeLabel(key: string): string {
  return ATTRIBUTE_LABEL_OVERRIDES[key] ?? humanizePostingValue(key);
}

export function formatPostingAttributeValue(
  value: string | number | boolean | string[],
): string {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value);
  }

  if (Array.isArray(value)) {
    return value.map(formatPostingTextValue).join(", ");
  }

  return formatPostingTextValue(value);
}

function formatPostingTextValue(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const overridden = VALUE_TOKEN_OVERRIDES[trimmed.toLowerCase()];

  if (overridden) {
    return overridden;
  }

  if (trimmed.includes("_") || trimmed.includes("-")) {
    return humanizePostingValue(trimmed.replace(/-/g, "_"));
  }

  if (trimmed === trimmed.toLowerCase()) {
    return trimmed.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return trimmed;
}
