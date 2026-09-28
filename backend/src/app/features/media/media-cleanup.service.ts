import type { AppEnvironment } from "@/configuration/environment/types";
import { loggerFactory } from "@/configuration/logging";
import type { BlobService } from "@/features/blob/blob.service";
import type { MediaRecord } from "@/features/media/media.model";
import type { MediaProcessingQueueService } from "@/features/media/media-processing.queue.service";
import type { MediaRepository } from "@/features/media/media.repository";
import {
  PROCESSING_FAILED_REASON,
  rejectMedia,
} from "@/features/media/media-rejection";

export type MediaCleanupOptions = Omit<
  AppEnvironment["workers"]["mediaCleanup"],
  "pollIntervalMs"
>;

export interface MediaCleanupSummary {
  /** Uploads never completed, deleted with their quarantined bytes. */
  abandonedDeleted: number;
  /** Items whose processing job was lost, queued again. */
  requeued: number;
  /** Items unfinished past the processing age limit, rejected. */
  rejected: number;
  /** Rejected items past their retention, deleted. */
  rejectedPurged: number;
  /** Items a step failed on; each is picked up again by a later sweep. */
  failed: number;
}

/**
 * Finishes off media items that will not finish by themselves, working from
 * the database alone so that it cleans Azure and local-disk storage alike:
 *
 * 1. an upload that was requested and never completed is deleted, bytes first;
 * 2. an item waiting on a processing job that has not moved in a while is
 *    queued again, or rejected once it is too old to keep retrying;
 * 3. a rejected item is deleted once its retention has passed.
 *
 * A ready item is never selected. Every change is conditional on the status
 * the item was read in, so an item that moves on during a sweep is left alone
 * and several workers can sweep at once. The orphaned-blob cleanup remains the
 * backstop for blobs that no row accounts for.
 */
export class MediaCleanupService {
  private readonly logger = loggerFactory.forClass(
    MediaCleanupService,
    "service",
  );

  constructor(
    private readonly mediaRepository: Pick<
      MediaRepository,
      | "listAbandonedUploads"
      | "listStuck"
      | "listRejected"
      | "claimStuckForRequeue"
      | "deleteByIdIfStatus"
      | "markRejected"
    >,
    private readonly blobService: Pick<BlobService, "deleteBlob">,
    private readonly mediaProcessingQueue: Pick<
      MediaProcessingQueueService,
      "enqueueMediaProcessingJob"
    >,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Runs each step once, on at most `batchSize` items. */
  async sweep(options: MediaCleanupOptions): Promise<MediaCleanupSummary> {
    const nowMs = this.now().getTime();
    const cutoff = (ageMs: number) => new Date(nowMs - ageMs);
    const summary: MediaCleanupSummary = {
      abandonedDeleted: 0,
      requeued: 0,
      rejected: 0,
      rejectedPurged: 0,
      failed: 0,
    };

    await this.deleteAbandonedUploads(
      cutoff(options.pendingUploadTtlMs),
      options.batchSize,
      summary,
    );
    await this.recoverStuckMedia(
      cutoff(options.stuckThresholdMs),
      cutoff(options.maxProcessingAgeMs),
      options.batchSize,
      summary,
    );
    await this.purgeRejectedMedia(
      cutoff(options.rejectedRetentionMs),
      options.batchSize,
      summary,
    );

    return summary;
  }

  /**
   * The bytes go first, so that a failed delete leaves the row behind to try
   * again. The row is then deleted only if it is still pending: an upload
   * completed in the meantime keeps its row, and processing rejects it for
   * its missing bytes.
   */
  private async deleteAbandonedUploads(
    createdBefore: Date,
    limit: number,
    summary: MediaCleanupSummary,
  ): Promise<void> {
    const records = await this.mediaRepository.listAbandonedUploads(
      createdBefore,
      limit,
    );

    await this.forEachItem(
      records,
      "abandoned-upload",
      summary,
      async (record) => {
        await this.blobService.deleteBlob(record.originalBlobName);

        if (
          await this.mediaRepository.deleteByIdIfStatus(
            record.id,
            "pending_upload",
          )
        ) {
          summary.abandonedDeleted += 1;
        }
      },
    );
  }

  /**
   * RabbitMQ redelivers a job whose worker died, but not one lost at publish
   * time, so an item with no job would wait forever. It is claimed before it
   * is queued, so only one sweep queues it; a job for an item another worker
   * has since finished is a no-op, because processing claims the row too.
   * An item unfinished since `createdBefore` is rejected instead, so one that
   * keeps failing cannot be retried forever.
   */
  private async recoverStuckMedia(
    updatedBefore: Date,
    createdBefore: Date,
    limit: number,
    summary: MediaCleanupSummary,
  ): Promise<void> {
    const records = await this.mediaRepository.listStuck(updatedBefore, limit);

    await this.forEachItem(records, "stuck", summary, async (record) => {
      if (record.createdAt < createdBefore) {
        if (await this.reject(record)) {
          summary.rejected += 1;
        }
        return;
      }

      if (
        await this.mediaRepository.claimStuckForRequeue(
          record.id,
          updatedBefore,
        )
      ) {
        await this.mediaProcessingQueue.enqueueMediaProcessingJob(record.id);
        summary.requeued += 1;
      }
    });
  }

  /**
   * Rejection already deletes the upload, but only on a best-effort basis, so
   * any leftover goes before the row does.
   */
  private async purgeRejectedMedia(
    updatedBefore: Date,
    limit: number,
    summary: MediaCleanupSummary,
  ): Promise<void> {
    const records = await this.mediaRepository.listRejected(
      updatedBefore,
      limit,
    );

    await this.forEachItem(records, "rejected", summary, async (record) => {
      await this.blobService.deleteBlob(record.originalBlobName);

      if (
        await this.mediaRepository.deleteByIdIfStatus(record.id, "rejected")
      ) {
        summary.rejectedPurged += 1;
      }
    });
  }

  /**
   * One item's failure, such as storage or RabbitMQ being unavailable, does
   * not stop the rest. It is not counted as work done, so a worker whose every
   * item fails waits out its poll interval rather than retrying at once.
   */
  private async forEachItem(
    records: MediaRecord[],
    step: string,
    summary: MediaCleanupSummary,
    handle: (record: MediaRecord) => Promise<void>,
  ): Promise<void> {
    for (const record of records) {
      try {
        await handle(record);
      } catch (error) {
        summary.failed += 1;
        this.logger.warn(
          "Media cleanup failed for an item.",
          { mediaId: record.id, step },
          error,
        );
      }
    }
  }

  private reject(record: MediaRecord): Promise<boolean> {
    return rejectMedia(
      {
        mediaRepository: this.mediaRepository,
        blobService: this.blobService,
        logger: this.logger,
      },
      record,
      PROCESSING_FAILED_REASON,
    );
  }
}
