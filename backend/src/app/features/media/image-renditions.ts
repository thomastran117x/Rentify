import type { Sharp } from "sharp";
import {
  IMAGE_VARIANT_EDGES,
  type ImageVariantBlobNames,
} from "@/features/blob/image-variant-names";
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

/**
 * Encodes one rendition of `source`, fitted inside a square of `edge` pixels
 * and never enlarged. `source` is cloned, so one decoded, rotated pipeline can
 * produce every rendition.
 */
export async function renderImage(
  source: Sharp,
  edge: number,
): Promise<RenderedImage> {
  const { data, info } = await source
    .clone()
    .resize({
      width: edge,
      height: edge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: PROCESSED_IMAGE_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

/**
 * Encodes the medium and thumbnail renditions. Neither is allowed past the
 * large one's cap, so a deployment that caps processed images below 800 px
 * does not publish a "medium" larger than its "large".
 *
 * One after the other rather than together: each clone decodes the source
 * again, and running them at once would multiply the worker's peak memory.
 */
export async function renderSmallerRenditions(
  source: Sharp,
  maxEdge: number,
): Promise<{ medium: RenderedImage; thumbnail: RenderedImage }> {
  const medium = await renderImage(
    source,
    Math.min(IMAGE_VARIANT_EDGES.medium, maxEdge),
  );
  const thumbnail = await renderImage(
    source,
    Math.min(IMAGE_VARIANT_EDGES.thumbnail, maxEdge),
  );

  return { medium, thumbnail };
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
  await blobService.uploadBuffer({
    blobName: names.medium,
    body: renditions.medium.data,
    contentType: PROCESSED_IMAGE_CONTENT_TYPE,
  });
  await blobService.uploadBuffer({
    blobName: names.thumbnail,
    body: renditions.thumbnail.data,
    contentType: PROCESSED_IMAGE_CONTENT_TYPE,
  });

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
