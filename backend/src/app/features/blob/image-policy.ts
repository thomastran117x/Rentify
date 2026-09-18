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

// The canonical stored extension per content type. This is the only source of
// the extension for a managed blob - the client's filename never contributes.
const IMAGE_EXTENSIONS: Record<SupportedImageContentType, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// sharp reports a format name, not a media type. Anything sharp can decode but
// that is absent here (gif, tiff, avif, svg, ...) is deliberately unmapped and
// therefore rejected.
const SHARP_FORMAT_CONTENT_TYPES: Record<string, SupportedImageContentType> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function unsupportedMediaType(received: string): UnsupportedMediaTypeError {
  return new UnsupportedMediaTypeError(
    "Only JPEG, PNG, and WebP images can be uploaded.",
    {
      allowedContentTypes:
        environment.getImageUploadsConfig().allowedContentTypes,
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
 * (enforced at startup), so a value that passes this check always has an
 * extension mapping and a sharp decoder.
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

/**
 * Resolves the stored file extension for a validated content type. Callers must
 * pass a type that has already been through normalizeImageContentType.
 */
export function imageExtensionForContentType(
  contentType: SupportedImageContentType,
): string {
  return IMAGE_EXTENSIONS[contentType];
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
    throw new PayloadTooLargeError("Image exceeds the maximum allowed size.", {
      sizeBytes,
      maxSizeBytes,
    });
  }
}

/**
 * Validates the actual bytes of an upload: that they decode as an image, that
 * the real format matches what the client declared, and that the dimensions are
 * within policy.
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
 */
export async function assertImageBytes(
  body: Buffer,
  declaredContentType: SupportedImageContentType,
): Promise<void> {
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
}
