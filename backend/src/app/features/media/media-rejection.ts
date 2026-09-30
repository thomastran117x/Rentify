import type { Logger } from "@/configuration/logging/types";
import type { BlobService } from "@/features/blob/blob.service";
import type {
  MediaMetrics,
  MediaRejectionStage,
} from "@/features/media/media-metrics";
import type {
  MediaRecord,
  MediaRejectionCode,
} from "@/features/media/media.model";
import type { MediaRepository } from "@/features/media/media.repository";

/**
 * The reason recorded when an item never finished processing: its job
 * exhausted every retry, or it stayed unfinished past the cleanup's limit.
 */
export const PROCESSING_FAILED_REASON = "The image could not be processed.";

/**
 * Whether a rejection keeps the quarantined upload. Only `processing_failed`
 * does: the image was never found at fault, and a failure such as an outage
 * can be replayed from its dead-lettered job once it is over (see
 * replay-media-dead-letters). The media cleanup deletes the upload with the
 * row once the rejected retention has passed.
 */
export function keepsQuarantinedUpload(code: MediaRejectionCode): boolean {
  return code === "processing_failed";
}

export interface MediaRejectionDependencies {
  mediaRepository: Pick<MediaRepository, "markRejected">;
  blobService: Pick<BlobService, "deleteBlob">;
  logger: Pick<Logger, "warn">;
  metrics: Pick<MediaMetrics, "increment">;
}

/**
 * The one way a media item is rejected, whether its upload was over the size
 * limit, its bytes failed the image policy, its upload vanished, or its
 * processing exhausted every retry. `code` is recorded beside `reason`, and
 * `stage` says which step decided it, for the `media.rejected` metric.
 *
 * The row is marked first. Its quarantined upload is deleted only when this
 * call is the one that rejected it, so a racing or repeated rejection does not
 * touch the upload again, and never for a processing failure, which is kept
 * for a replay. The metric is counted on the same condition, so each rejected
 * item is counted once. Returns whether this call rejected the item.
 */
export async function rejectMedia(
  dependencies: MediaRejectionDependencies,
  record: MediaRecord,
  reason: string,
  code: MediaRejectionCode,
  stage: MediaRejectionStage,
): Promise<boolean> {
  if (
    !(await dependencies.mediaRepository.markRejected(record.id, reason, code))
  ) {
    return false;
  }

  dependencies.metrics.increment("media.rejected", { code, stage });

  if (!keepsQuarantinedUpload(code)) {
    await deleteQuarantinedUpload(dependencies, record);
  }

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
