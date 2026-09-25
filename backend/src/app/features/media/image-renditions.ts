import sharp, { type Sharp } from "sharp";
import {
  IMAGE_VARIANT_WIDTHS,
  type ImageVariantBlobNames,
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

/**
 * Encodes the medium and thumbnail renditions of a processed image, each
 * scaled to its width and never enlarged.
 *
 * They are made from the processed image, not the upload. It is already
 * upright, in sRGB, and no larger than the processed cap, so decoding it is a
 * fraction of the cost of decoding a full-size upload again for each one, and
 * scaling it down cannot take a rendition past that cap.
 */
export async function renderSmallerRenditions(
  processed: Buffer,
): Promise<{ medium: RenderedImage; thumbnail: RenderedImage }> {
  const source = sharp(processed, { failOn: IMAGE_DECODE_FAIL_ON });
  // One after the other: each clone decodes the source again, and running them
  // at once would only raise the worker's peak memory.
  const medium = await encode(
    source
      .clone()
      .resize({ width: IMAGE_VARIANT_WIDTHS.medium, withoutEnlargement: true }),
  );
  const thumbnail = await encode(
    source.clone().resize({
      width: IMAGE_VARIANT_WIDTHS.thumbnail,
      withoutEnlargement: true,
    }),
  );

  return { medium, thumbnail };
}

async function encode(pipeline: Sharp): Promise<RenderedImage> {
  const { data, info } = await pipeline
    .webp({ quality: PROCESSED_IMAGE_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

/**
 * Writes the smaller renditions under their names. An upload overwrites, so a
 * retry after a partial failure simply writes them again.
 */
export async function uploadSmallerRenditions(
  blobService: Pick<BlobService, "uploadBuffer">,
  names: ImageVariantBlobNames,
  renditions: { medium: RenderedImage; thumbnail: RenderedImage },
): Promise<MediaVariantsMetadata> {
  await Promise.all(
    (["medium", "thumbnail"] as const).map((rendition) =>
      blobService.uploadBuffer({
        blobName: names[rendition],
        body: renditions[rendition].data,
        contentType: PROCESSED_IMAGE_CONTENT_TYPE,
      }),
    ),
  );

  return {
    medium: describeRendition(renditions.medium),
    thumbnail: describeRendition(renditions.thumbnail),
  };
}

function describeRendition(image: RenderedImage): ImageRenditionInfo {
  return {
    width: image.width,
    height: image.height,
    sizeBytes: image.data.byteLength,
  };
}
