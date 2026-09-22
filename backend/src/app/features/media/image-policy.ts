import sharp from "sharp";
import type { Metadata } from "sharp";
import {
  SUPPORTED_IMAGE_CONTENT_TYPES,
  isSupportedImageContentType,
  type SupportedImageContentType,
} from "@/configuration/environment/constants";
import { environment } from "@/configuration/environment/index";
import PayloadTooLargeError from "@/errors/http/payload-too-large.error";
import UnprocessableEntityError from "@/errors/http/unprocessable-entity.error";
import UnsupportedMediaTypeError from "@/errors/http/unsupported-media-type.error";

// Duplicated from blob.service.ts rather than shared: that module still needs
// the pattern to sanitize stored metadata, and a two-line regex is cheaper to
// repeat than a new shared module is to justify.
const SAFE_CONTENT_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

// sharp reports a format name, not a media type. Anything sharp can decode but
// that is absent here (gif, tiff, avif, svg, ...) is deliberately unmapped and
// therefore rejected.
const SHARP_FORMAT_CONTENT_TYPES: Record<string, SupportedImageContentType> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const IMAGE_FORMAT_LABELS: Record<SupportedImageContentType, string> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
};

// Rejection messages are built from the deployed policy, not written out. The
// frontend shows them verbatim and holds no copy of the limits, so a narrowed
// allow-list or a changed size ceiling is described accurately without a
// client release.
function describeAllowedFormats(allowedContentTypes: string[]): string {
  const labels = allowedContentTypes.map((contentType) =>
    isSupportedImageContentType(contentType)
      ? IMAGE_FORMAT_LABELS[contentType]
      : contentType,
  );

  if (labels.length <= 2) {
    return labels.join(" and ");
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

export function formatByteLimit(bytes: number): string {
  const mebibyte = 1024 * 1024;

  if (bytes >= mebibyte) {
    const value = bytes / mebibyte;
    return `${Number.isInteger(value) ? value : value.toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.floor(bytes / 1024)} KB`;
  }

  return `${bytes} bytes`;
}

function unsupportedMediaType(received: string): UnsupportedMediaTypeError {
  const { allowedContentTypes } = environment.getImageUploadsConfig();

  return new UnsupportedMediaTypeError(
    `Only ${describeAllowedFormats(allowedContentTypes)} images can be uploaded.`,
    {
      allowedContentTypes,
      received,
    },
  );
}

/**
 * Normalizes a client-supplied content type and asserts it is an image format
 * this deployment accepts. Unlike the generic content-type check this replaces,
 * a syntactically valid media type is not enough - `application/pdf` and
 * `text/html` are rejected here, before any upload credential is issued.
 *
 * The configured allow-list is always a subset of SUPPORTED_IMAGE_CONTENT_TYPES
 * (enforced at startup), so a value that passes this check always has a sharp
 * decoder.
 */
export function normalizeImageContentType(
  contentType: string,
): SupportedImageContentType {
  const normalized = contentType.trim().toLowerCase();

  if (!normalized || !SAFE_CONTENT_TYPE_PATTERN.test(normalized)) {
    throw unsupportedMediaType(contentType);
  }

  if (!isSupportedImageContentType(normalized)) {
    throw unsupportedMediaType(contentType);
  }

  if (
    !environment
      .getImageUploadsConfig()
      .allowedContentTypes.includes(normalized)
  ) {
    throw unsupportedMediaType(contentType);
  }

  return normalized;
}

/** The refusal for an image over MAX_IMAGE_SIZE_BYTES, as the client sees it. */
export function describeImageSizeLimit(): string {
  const { maxSizeBytes } = environment.getImageUploadsConfig();

  return `Images must be ${formatByteLimit(maxSizeBytes)} or smaller.`;
}

/**
 * Checks a byte length against MAX_IMAGE_SIZE_BYTES. Used both for the size a
 * client declares when asking for an upload URL and for the real length of an
 * uploaded body.
 */
export function assertImageSizeWithinLimit(sizeBytes: number): void {
  const { maxSizeBytes } = environment.getImageUploadsConfig();

  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new UnprocessableEntityError("Image size is invalid.");
  }

  if (sizeBytes > maxSizeBytes) {
    throw new PayloadTooLargeError(describeImageSizeLimit(), {
      sizeBytes,
      maxSizeBytes,
    });
  }
}

/**
 * Refuses an upload with no bytes. Kept apart from assertImageSizeWithinLimit
 * because that also checks what a client declares and what the local upload
 * route writes, where an empty body is left for completion to refuse, as it is
 * on Azure.
 */
export function assertImageNotEmpty(sizeBytes: number): void {
  if (sizeBytes === 0) {
    throw new UnprocessableEntityError("The uploaded file is empty.");
  }
}

/**
 * Validates the actual bytes of an upload: that they decode as an image, that
 * the real format matches what the client declared, and that the dimensions are
 * within policy. Returns the detected content type.
 *
 * Decoding through sharp rather than a hand-written signature table is
 * deliberate. Stored blobs are later re-decoded by sharp for thumbnailing, so
 * agreeing with sharp's own parser is the point - a file that passes a
 * twelve-byte signature check and then makes sharp throw downstream is exactly
 * the failure this is meant to prevent. It also yields the dimensions in the
 * same pass.
 *
 * Validation runs in two passes. The first reads only the header: cheap, and
 * it allocates nothing proportional to the image, so it can safely check the
 * format and dimensions of anything. limitInputPixels is disabled on it
 * deliberately - at the policy value, sharp throws on an oversized header,
 * which would surface as "could not be read as an image" instead of an
 * accurate "too large".
 *
 * The second pass decodes every pixel. A header can be valid while the data
 * behind it is truncated or corrupt, and metadata() alone accepts that: a PNG
 * cut to 60% of its length still reports its full dimensions. Such a blob would
 * be stored and then fail when rendered or thumbnailed. The full decode only
 * runs once the pixel budget has passed, so it is bounded, and it keeps
 * limitInputPixels as a second guard against a decompression bomb.
 *
 * Animated and multi-page images are refused, using the frame count from the
 * header. An APNG is the exception: libvips reads it as a static PNG and does
 * not report its frames, so it is accepted and becomes its first frame.
 * Refusing it would mean parsing its acTL chunk by hand.
 */
export async function assertImageBytes(
  body: Buffer,
  declaredContentType: SupportedImageContentType,
): Promise<SupportedImageContentType> {
  const policy = environment.getImageUploadsConfig();
  let metadata: Metadata;

  try {
    metadata = await sharp(body, {
      limitInputPixels: false,
      failOn: "error",
    }).metadata();
  } catch {
    throw new UnsupportedMediaTypeError(
      "Uploaded file could not be read as an image.",
    );
  }

  const detected = metadata.format
    ? SHARP_FORMAT_CONTENT_TYPES[metadata.format]
    : undefined;

  if (!detected || detected !== declaredContentType) {
    throw new UnsupportedMediaTypeError(
      "Uploaded file contents do not match the declared image type.",
      {
        declared: declaredContentType,
        detected: metadata.format ?? "unknown",
        supportedContentTypes: [...SUPPORTED_IMAGE_CONTENT_TYPES],
      },
    );
  }

  // sharp decodes only the first frame unless asked otherwise, so an animation
  // accepted here would be published as a still with no explanation.
  const pages = metadata.pages ?? 1;

  if (pages > 1) {
    throw new UnprocessableEntityError(
      "Animated or multi-page images are not supported.",
      { pages },
    );
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width < 1 || height < 1) {
    throw new UnprocessableEntityError(
      "Image dimensions could not be determined.",
    );
  }

  if (
    width > policy.maxWidth ||
    height > policy.maxHeight ||
    width * height > policy.maxPixels
  ) {
    throw new UnprocessableEntityError(
      "Image dimensions exceed the allowed maximum.",
      {
        width,
        height,
        maxWidth: policy.maxWidth,
        maxHeight: policy.maxHeight,
        maxPixels: policy.maxPixels,
      },
    );
  }

  try {
    // stats() forces every pixel through the decoder; libvips streams the work
    // in tiles rather than materialising the whole raster.
    await sharp(body, {
      limitInputPixels: policy.maxPixels,
      failOn: "error",
    }).stats();
  } catch {
    throw new UnsupportedMediaTypeError(
      "Uploaded image data is truncated or corrupt.",
    );
  }

  return detected;
}

/**
 * Whether an error is the image policy refusing an image, as opposed to a
 * failure to check it. A refusal is final: the same bytes, size, or type will
 * be refused again, so it must not be retried. These are the only errors the
 * functions in this module throw.
 */
export function isImagePolicyRejection(
  error: unknown,
): error is
  | UnsupportedMediaTypeError
  | UnprocessableEntityError
  | PayloadTooLargeError {
  return (
    error instanceof UnsupportedMediaTypeError ||
    error instanceof UnprocessableEntityError ||
    error instanceof PayloadTooLargeError
  );
}
