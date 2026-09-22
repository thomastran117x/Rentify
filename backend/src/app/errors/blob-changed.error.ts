/**
 * The blob no longer has the ETag a download was made conditional on: it was
 * written again after the caller last read its properties. Internal only; it
 * never reaches an HTTP response.
 */
class BlobChangedError extends Error {
  constructor() {
    super("The blob changed since its properties were read.");
    this.name = "BlobChangedError";
  }
}

export default BlobChangedError;
export { BlobChangedError };
