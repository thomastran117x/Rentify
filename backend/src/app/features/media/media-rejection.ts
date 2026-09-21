import type { Logger } from "@/configuration/logging/types";
import type { BlobService } from "@/features/blob/blob.service";
import type { MediaRecord } from "@/features/media/media.model";
import type { MediaRepository } from "@/features/media/media.repository";

export interface MediaRejectionDependencies {
  mediaRepository: Pick<MediaRepository, "markRejected">;
  blobService: Pick<BlobService, "deleteBlob">;
  logger: Pick<Logger, "warn">;
}

/**
 * The one way a media item is rejected, whether its upload was over the size
 * limit, its bytes failed the image policy, its upload vanished, or its
 * processing exhausted every retry.
 *
 * The row is marked first. Its quarantined upload is deleted only when this
 * call is the one that rejected it, so a racing or repeated rejection does not
 * touch the upload again. Returns whether this call rejected the item.
 */
export async function rejectMedia(
  dependencies: MediaRejectionDependencies,
  record: MediaRecord,
  reason: string,
): Promise<boolean> {
  if (!(await dependencies.mediaRepository.markRejected(record.id, reason))) {
    return false;
  }

  await deleteQuarantinedUpload(dependencies, record);
  return true;
}

/**
 * Deletes an item's quarantined upload once its outcome is recorded. Best
 * effort: failing here would only replace the recorded outcome with a storage
 * error, and a leftover upload is collected by the orphaned-blob cleanup.
 */
export async function deleteQuarantinedUpload(
  dependencies: Pick<MediaRejectionDependencies, "blobService" | "logger">,
  record: MediaRecord,
): Promise<void> {
  try {
    await dependencies.blobService.deleteBlob(record.originalBlobName);
  } catch (error) {
    dependencies.logger.warn("Failed to delete a quarantined upload.", {
      mediaId: record.id,
      error,
    });
  }
}
