// Validated, re-encoded images written by the media processing worker.
export const PROCESSED_IMAGE_DIRECTORY = "media/images";
export const PROCESSED_IMAGE_EXTENSION = ".webp";

/**
 * The width of each smaller rendition, never enlarged: a narrower image keeps
 * its own width. Sized by width rather than longest edge so that the `w`
 * descriptor a srcset gives each one is its real width, and a portrait is not
 * picked too small. The large rendition is the processed image itself, fitted
 * inside `imageUploads.maxProcessedEdge`.
 */
export const IMAGE_VARIANT_WIDTHS = {
  medium: 800,
  thumbnail: 300,
} as const;

export type ImageVariantName = keyof typeof IMAGE_VARIANT_WIDTHS;

/** The renditions written beside the processed image, smallest last. */
export const SMALLER_IMAGE_VARIANTS = Object.keys(
  IMAGE_VARIANT_WIDTHS,
) as ImageVariantName[];

export interface ImageVariantBlobNames {
  large: string;
  medium: string;
  thumbnail: string;
}

// Only the name the worker writes: `media/images/<ownerId>/<mediaId>.webp`.
// A thumbnail crop (`.../thumbnails/<id>.webp`), a variant, and anything stored
// before media existed do not match, so none of them has variants.
const CANONICAL_PROCESSED_IMAGE_PATTERN = new RegExp(
  `^${PROCESSED_IMAGE_DIRECTORY}/([A-Za-z0-9-]+)/([A-Za-z0-9-]+)\\${PROCESSED_IMAGE_EXTENSION}$`,
);

/**
 * The renditions of a processed image, named from it. Nothing records them
 * separately: they exist beside every processed image, so whatever refers to
 * the large one refers to all three. The large rendition keeps the processed
 * name, which is why references stored before variants existed stay valid.
 *
 * The names stay flat in the owner's directory, so reading the owner back out
 * of a variant name works exactly as it does for the processed image.
 *
 * Returns null for a name that is not a processed image.
 */
export function buildImageVariantBlobNames(
  processedBlobName: string,
): ImageVariantBlobNames | null {
  const large = processedBlobName.trim();
  const match = CANONICAL_PROCESSED_IMAGE_PATTERN.exec(large);

  if (!match) {
    return null;
  }

  const [, ownerId, mediaId] = match;
  const base = `${PROCESSED_IMAGE_DIRECTORY}/${ownerId}/${mediaId}`;

  return {
    large,
    medium: `${base}.medium${PROCESSED_IMAGE_EXTENSION}`,
    thumbnail: `${base}.thumbnail${PROCESSED_IMAGE_EXTENSION}`,
  };
}

/** Every blob name behind a processed image, or none for any other name. */
export function listImageVariantBlobNames(processedBlobName: string): string[] {
  const names = buildImageVariantBlobNames(processedBlobName);

  return names
    ? [names.large, ...SMALLER_IMAGE_VARIANTS.map((variant) => names[variant])]
    : [];
}
