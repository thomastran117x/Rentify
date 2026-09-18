// The backend is the only authority on what can be uploaded. It rejects
// anything outside its configured policy before issuing credentials, and its
// messages name the deployed limits ("Only PNG images can be uploaded.",
// "Images must be 5 MB or smaller."). The client deliberately holds no copy of
// those limits - a hard-coded one drifts from the deployment as soon as an
// operator changes MAX_IMAGE_SIZE_BYTES or narrows ALLOWED_IMAGE_TYPES - so
// callers send the file's size and type and show whatever the server says.
//
// What remains here is purely client-side: choosing which content type to
// declare, and a hint for the file picker.

// A picker hint only. It lists the full built-in set, which is always a
// superset of what a deployment accepts because the backend allow-list can
// only narrow, so it never hides a file the server would take.
export const IMAGE_ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/webp";

// Browsers leave File.type empty for some sources - a drag from certain apps,
// an unrecognised extension, a platform with no MIME database. Sending that as
// "application/octet-stream" guarantees a rejection even when the file is a
// perfectly good PNG, so fall back to the extension first.
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * The content type to declare when requesting upload credentials. Never
 * decides acceptability: an unsupported type is sent as-is so the server can
 * reject it with an accurate message.
 */
export function resolveUploadContentType(file: File): string {
  const declared = file.type.trim().toLowerCase();

  if (declared) {
    return declared;
  }

  const extension = file.name.includes(".")
    ? file.name.split(".").pop()?.trim().toLowerCase()
    : undefined;

  return (
    (extension && EXTENSION_CONTENT_TYPES[extension]) ||
    "application/octet-stream"
  );
}
