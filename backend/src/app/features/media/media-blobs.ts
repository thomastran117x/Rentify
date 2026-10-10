import type { BlobService } from "@/features/blob/blob.service";
import { listImageVariantBlobNames } from "@/features/blob/image-variant-names";
import type { MediaRecord } from "@/features/media/media.model";

type BlobDeleter = Pick<BlobService, "deleteBlob">;

/**
 * Deletes a stored image. A processed image goes with its renditions, which
 * nothing references by name; any other name is a single blob.
 */
export async function deleteImageBlobs(
  blobService: BlobDeleter,
  blobName: string,
): Promise<void> {
  const renditions = listImageVariantBlobNames(blobName);

  await Promise.all(
    (renditions.length > 0 ? renditions : [blobName]).map((name) =>
      blobService.deleteBlob(name),
    ),
  );
}

/**
 * Deletes a media item's upload and, once it was processed, its image with
 * every rendition. Deleting a blob that is already gone succeeds.
 */
export async function deleteMediaBlobs(
  blobService: BlobDeleter,
  record: Pick<MediaRecord, "originalBlobName" | "processedBlobName">,
): Promise<void> {
  await blobService.deleteBlob(record.originalBlobName);

  if (record.processedBlobName) {
    await deleteImageBlobs(blobService, record.processedBlobName);
  }
}
