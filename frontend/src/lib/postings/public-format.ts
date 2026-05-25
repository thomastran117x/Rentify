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
