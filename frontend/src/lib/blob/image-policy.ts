// Mirrors the server policy in backend/src/app/features/blob/image-policy.ts.
// The backend remains authoritative - it rejects anything outside this set with
// a 415 regardless of what the client does. This copy exists so the UI can fail
// fast with a clear message instead of round-tripping a file that cannot work.
// Keep the two in step; the backend list is the one that matters.

export const ALLOWED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedImageContentType =
  (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

export const IMAGE_ACCEPT_ATTRIBUTE = ALLOWED_IMAGE_CONTENT_TYPES.join(",");

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export const UNSUPPORTED_IMAGE_MESSAGE =
  "Only JPEG, PNG, and WebP images can be uploaded.";

export const OVERSIZED_IMAGE_MESSAGE =
  "That image is larger than the 5 MB limit.";

// Browsers leave File.type empty for some sources - a drag from certain apps,
// an unrecognised extension, a file picked on a platform with no MIME database.
// Previously that became "application/octet-stream" and was sent anyway; now it
// is resolved from the extension so a genuine image still uploads.
const EXTENSION_CONTENT_TYPES: Record<string, AllowedImageContentType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function isAllowedImageContentType(
  value: string,
): value is AllowedImageContentType {
  return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * Resolves the content type to declare for a file, or null when the file is not
 * an image this application accepts.
 */
export function resolveImageContentType(
  file: File,
): AllowedImageContentType | null {
  const declared = file.type.trim().toLowerCase();

  if (declared) {
    return isAllowedImageContentType(declared) ? declared : null;
  }

  const extension = file.name.split(".").pop()?.trim().toLowerCase();

  if (!extension) {
    return null;
  }

  return EXTENSION_CONTENT_TYPES[extension] ?? null;
}

/**
 * Returns null when the file is acceptable, or the message to show the user.
 */
export function validateImageFile(file: File): string | null {
  if (!resolveImageContentType(file)) {
    return UNSUPPORTED_IMAGE_MESSAGE;
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return OVERSIZED_IMAGE_MESSAGE;
  }

  return null;
}
