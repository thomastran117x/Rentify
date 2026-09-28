import sharp, { type Sharp } from "sharp";
import {
  IMAGE_VARIANT_WIDTHS,
  SMALLER_IMAGE_VARIANTS,
  type ImageVariantBlobNames,
  type ImageVariantName,
} from "@/features/blob/image-variant-names";
import { IMAGE_DECODE_FAIL_ON } from "@/features/media/image-policy";
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

/** Encodes `source`, fitted inside a square of `edge` pixels, never enlarged. */
export async function renderImage(
  source: Sharp,
  edge: number,
): Promise<RenderedImage> {
  return encode(
    source.resize({
      width: edge,
      height: edge,
      fit: "inside",
      withoutEnlargement: true,
    }),
  );
}

export type SmallerRenditions = Record<ImageVariantName, RenderedImage | null>;

/**
 * Encodes the medium and thumbnail renditions of a processed image, each
 * scaled to its width.
 *
 * A rendition is only made when the processed image is wider than it. One that
 * is not would be re-encoded at its own size, a copy of the processed image
 * that is no smaller, so it is null, and clients are given the processed image
 * in its place.
 *
 * They are made from the encoded processed image, not the upload: decoding an
 * image already capped at the processed edge costs a fraction of decoding a
 * full-size upload again, and scaling it down keeps every rendition within
 * that cap.
 */
export async function renderSmallerRenditions(
  processed: Buffer,
  processedWidth: number,
): Promise<SmallerRenditions> {
  const source = sharp(processed, { failOn: IMAGE_DECODE_FAIL_ON });
  const renditions = {} as SmallerRenditions;

  // One after the other: each clone decodes the source again, and running them
  // at once would only raise the worker's peak memory.
  for (const variant of SMALLER_IMAGE_VARIANTS) {
    const width = IMAGE_VARIANT_WIDTHS[variant];
    renditions[variant] =
      processedWidth > width
        ? await encode(source.clone().resize({ width }))
        : null;
  }

  return renditions;
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
