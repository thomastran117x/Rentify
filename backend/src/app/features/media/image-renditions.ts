import sharp, { type Sharp } from "sharp";
import {
  IMAGE_VARIANT_WIDTHS,
  SMALLER_IMAGE_VARIANTS,
  type ImageVariantBlobNames,
  type ImageVariantName,
} from "@/features/blob/image-variant-names";
import {
  IMAGE_DECODE_FAIL_ON,
  type DecodedImage,
} from "@/features/media/image-policy";
import type { BlobService } from "@/features/blob/blob.service";
import type {
  ImageRenditionInfo,
  MediaVariantsMetadata,
} from "@/features/media/media.model";

export const PROCESSED_IMAGE_QUALITY = 85;
export const PROCESSED_IMAGE_CONTENT_TYPE = "image/webp";

export interface RenderedImage {
  data: Buffer;
  width: number;
  height: number;
}

/** Reads decoded pixels back in, for encoding without decoding again. */
export function decodedImageSource(image: DecodedImage): Sharp {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: image.channels },
  });
}

/** Encodes the processed image, already upright and at its final size. */
export async function renderProcessedImage(
  image: DecodedImage,
): Promise<RenderedImage> {
  return encode(decodedImageSource(image));
}

export type SmallerRenditions = Record<ImageVariantName, RenderedImage | null>;

/**
 * Encodes the medium and thumbnail renditions of a processed image, each
 * scaled to its width. `source` is the processed image at `processedWidth`:
 * its decoded pixels while processing an upload, or the stored processed image
 * when renditions are backfilled.
 *
 * A rendition is only made when the processed image is wider than it. One that
 * is not would be re-encoded at its own size, a copy of the processed image
 * that is no smaller, so it is null, and clients are given the processed image
 * in its place.
 *
 * They are made from the processed image, not the upload: it is already
 * capped at the processed edge, and scaling it down keeps every rendition
 * within that cap.
 */
export async function renderSmallerRenditions(
  source: Sharp,
  processedWidth: number,
): Promise<SmallerRenditions> {
  const renditions = {} as SmallerRenditions;

  // One after the other, so a job holds one rendition's buffers at a time and
  // leaves the CPU to the worker's other jobs.
  for (const variant of SMALLER_IMAGE_VARIANTS) {
    const width = IMAGE_VARIANT_WIDTHS[variant];
    renditions[variant] =
      processedWidth > width
        ? await encode(source.clone().resize({ width }))
        : null;
  }

  return renditions;
}

// Azure AI Content Safety analyzes images from 50 x 50 to 2048 x 2048 pixels.
export const MODERATION_IMAGE_MIN_EDGE = 50;
export const MODERATION_IMAGE_MAX_EDGE = 2048;

/**
 * The image sent for moderation: `source`, usually the medium rendition, as it
 * is when it already fits the moderation provider's limits. Otherwise it is
 * fitted inside the largest square the provider accepts, never enlarged, and
 * any edge still under the smallest it accepts is padded with white, so the
 * whole picture is analyzed and nothing in it is stretched.
 */
export async function renderModerationImage(
  source: RenderedImage,
): Promise<RenderedImage> {
  const fits = (edge: number) =>
    edge >= MODERATION_IMAGE_MIN_EDGE && edge <= MODERATION_IMAGE_MAX_EDGE;

  if (fits(source.width) && fits(source.height)) {
    return source;
  }

  const scale = Math.min(
    1,
    MODERATION_IMAGE_MAX_EDGE / source.width,
    MODERATION_IMAGE_MAX_EDGE / source.height,
  );
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const padWidth = Math.max(0, MODERATION_IMAGE_MIN_EDGE - width);
  const padHeight = Math.max(0, MODERATION_IMAGE_MIN_EDGE - height);

  // sharp always pads after it resizes, so one pass does both.
  return encode(
    sharp(source.data, { failOn: IMAGE_DECODE_FAIL_ON })
      .resize({ width, height, fit: "fill" })
      .extend({
        left: Math.floor(padWidth / 2),
        right: Math.ceil(padWidth / 2),
        top: Math.floor(padHeight / 2),
        bottom: Math.ceil(padHeight / 2),
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      }),
  );
}

async function encode(pipeline: Sharp): Promise<RenderedImage> {
  const { data, info } = await pipeline
    .webp({ quality: PROCESSED_IMAGE_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

/**
 * Writes the renditions that were made under their names, and returns what to
 * record for them. An upload overwrites, so a retry after a partial failure
 * simply writes them again.
 */
export async function uploadSmallerRenditions(
  blobService: Pick<BlobService, "uploadBuffer">,
  names: ImageVariantBlobNames,
  renditions: SmallerRenditions,
): Promise<MediaVariantsMetadata> {
  await Promise.all(
    SMALLER_IMAGE_VARIANTS.flatMap((variant) => {
      const rendition = renditions[variant];

      return rendition
        ? [
            blobService.uploadBuffer({
              blobName: names[variant],
              body: rendition.data,
              contentType: PROCESSED_IMAGE_CONTENT_TYPE,
            }),
          ]
        : [];
    }),
  );

  return {
    medium: describeRendition(renditions.medium),
    thumbnail: describeRendition(renditions.thumbnail),
  };
}

function describeRendition(
  image: RenderedImage | null,
): ImageRenditionInfo | null {
  return image
    ? {
        width: image.width,
        height: image.height,
        sizeBytes: image.data.byteLength,
      }
    : null;
}
