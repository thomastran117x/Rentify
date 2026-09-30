import type { AppEnvironment } from "@/configuration/environment/types";
import { loggerFactory } from "@/configuration/logging";
import type { BlobService } from "@/features/blob/blob.service";
import type { MediaRecord } from "@/features/media/media.model";
import type {
  MediaProcessingBacklog,
  MediaProcessingQueueService,
} from "@/features/media/media-processing.queue.service";
import type { MediaRepository } from "@/features/media/media.repository";
import { PROCESSING_FAILED_REASON } from "@/features/media/media-rejection";

// Recorded on an abandoned upload while the cleanup deletes it. A client only
// sees it if deleting the bytes fails and the row is kept for a later retry.
const ABANDONED_UPLOAD_REASON = "The upload was never completed.";

export type MediaCleanupOptions = Omit<
  AppEnvironment["workers"]["mediaCleanup"],
  "pollIntervalMs"
>;

export interface MediaCleanupSummary {
  /** Uploads never completed, deleted with their quarantined bytes. */
  abandonedDeleted: number;
  /** Items whose processing job was lost, queued again. */
  requeued: number;
  /** Items still unfinished after their last allowed re-queue, rejected. */
  rejected: number;
  /** Rejected items past their retention, deleted. */
  rejectedPurged: number;
  /**
   * Stuck items left alone because processing jobs are waiting or no worker
   * is consuming them, so their own job may simply be delayed.
   */
  deferred: number;
  /** Items a step failed on; each is picked up again by a later sweep. */
  failed: number;
}

/**
 * Finishes off media items that will not finish by themselves, working from
 * the database so that it cleans Azure and local-disk storage alike:
 *
 * 1. an upload that was requested and never completed is deleted;
 * 2. an item waiting on a processing job that has not moved in a while is
 *    queued again, or rejected once it has been queued again too many times,
 *    keeping its upload for a replay until step 3;
 * 3. a rejected item is deleted once its retention has passed.
 *
 * A ready item is never selected. Every change is conditional on the item
 * still being in the state it was selected in, so an item that moves on
 * during a sweep is left alone and several workers can sweep at once, given
 * clocks that agree to well within the stuck threshold. The orphaned-blob
 * cleanup remains the backstop for blobs that no row accounts for.
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
      | "rejectAbandonedUpload"
      | "claimStuckForRequeue"
      | "rejectStuck"
      | "deferRejectedPurge"
      | "deleteByIdIfStatus"
    >,
    private readonly blobService: Pick<BlobService, "deleteBlob">,
    private readonly mediaProcessingQueue: Pick<
      MediaProcessingQueueService,
      "enqueueMediaProcessingJob" | "readBacklog"
    >,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Runs each step once, on at most `batchSize` items. */
  async sweep(options: MediaCleanupOptions): Promise<MediaCleanupSummary> {
    const now = this.now();
    const cutoff = (ageMs: number) => new Date(now.getTime() - ageMs);
    const summary: MediaCleanupSummary = {
      abandonedDeleted: 0,
      requeued: 0,
      rejected: 0,
      rejectedPurged: 0,
      deferred: 0,
      failed: 0,
    };

    await this.deleteAbandonedUploads(
      cutoff(options.pendingUploadTtlMs),
      now,
      options.batchSize,
      summary,
    );
    await this.recoverStuckMedia(
      cutoff(options.stuckThresholdMs),
      now,
      options,
      summary,
    );
    await this.purgeRejectedMedia(
      cutoff(options.rejectedRetentionMs),
      now,
      options.batchSize,
      summary,
    );

    return summary;
  }

  /**
   * The row is claimed first, by rejecting it while it is still pending, so a
   * completion racing the sweep either wins before the claim and keeps its
   * upload, or finds the item rejected; it can never move the row on after
   * its bytes are gone. The bytes go next, then the row. If deleting the bytes
   * fails, the rejected row stays behind, and the purge of old rejections
   * tries again once its retention has passed.
   */
  private async deleteAbandonedUploads(
    createdBefore: Date,
    now: Date,
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
        if (
          !(await this.mediaRepository.rejectAbandonedUpload(
            record.id,
            createdBefore,
            ABANDONED_UPLOAD_REASON,
            "abandoned",
            now,
          ))
        ) {
          return;
        }

        await this.blobService.deleteBlob(record.originalBlobName);

        if (
          await this.mediaRepository.deleteByIdIfStatus(record.id, "rejected")
        ) {
          summary.abandonedDeleted += 1;
        }
      },
    );
  }

  /**
   * RabbitMQ redelivers a job whose worker died, but not one lost at publish
   * time, so an item with no job would wait forever. An item that has not
   * moved is only taken for one whose job was lost while no processing job
   * is waiting and a worker is consuming them: during a backlog or an outage
   * its job may simply be delayed, and queuing another would duplicate it, so
   * the step waits instead. A job being processed reports progress between
   * stages, so it never looks unmoved.
   *
   * A lost job is replaced by claiming the row, which counts the re-queue, and
   * then publishing a new one, so only one sweep queues it. An item already
   * queued again `maxRequeues` times is rejected instead, so one that keeps
   * failing is bounded by attempts rather than by how long it has waited. Its
   * upload is kept, like that of any processing failure, so it can be
   * replayed once the cause is fixed.
   * Both are conditional on the item still being unmoved, so one a job has
   * just claimed is left to finish.
   */
  private async recoverStuckMedia(
    updatedBefore: Date,
    now: Date,
    options: Pick<MediaCleanupOptions, "batchSize" | "maxRequeues">,
    summary: MediaCleanupSummary,
  ): Promise<void> {
    const records = await this.mediaRepository.listStuck(
      updatedBefore,
      options.batchSize,
    );

    if (records.length === 0) {
      return;
    }

    if (!(await this.isProcessingIdle())) {
      summary.deferred += records.length;
      return;
    }

    await this.forEachItem(records, "stuck", summary, async (record) => {
      if (record.processingRequeues >= options.maxRequeues) {
        if (
          await this.mediaRepository.rejectStuck(
            record.id,
            updatedBefore,
            PROCESSING_FAILED_REASON,
            "processing_failed",
            now,
          )
        ) {
          // The upload is kept, as for any processing failure, so the item
          // can still be replayed; the purge of old rejections deletes it.
          summary.rejected += 1;
        }
        return;
      }

      if (
        await this.mediaRepository.claimStuckForRequeue(
          record.id,
          updatedBefore,
          now,
        )
      ) {
        await this.mediaProcessingQueue.enqueueMediaProcessingJob(record.id);
        summary.requeued += 1;
      }
    });
  }

  /**
   * Rejection deletes the upload, but only on a best-effort basis, and keeps
   * it on purpose for a processing failure, so any leftover goes before the
   * row does. An item whose upload cannot be
   * deleted is moved to the back of the purge order, so it cannot hold up
   * newer ones by staying the oldest.
   */
  private async purgeRejectedMedia(
    updatedBefore: Date,
    now: Date,
    limit: number,
    summary: MediaCleanupSummary,
  ): Promise<void> {
    const records = await this.mediaRepository.listRejected(
      updatedBefore,
      limit,
    );

    await this.forEachItem(records, "rejected", summary, async (record) => {
      try {
        await this.blobService.deleteBlob(record.originalBlobName);
      } catch (error) {
        await this.mediaRepository.deferRejectedPurge(
          record.id,
          updatedBefore,
          now,
        );
        throw error;
      }

      if (
        await this.mediaRepository.deleteByIdIfStatus(record.id, "rejected")
      ) {
        summary.rejectedPurged += 1;
      }
    });
  }

  /**
   * Whether no processing job is waiting and a worker is consuming them. A
   * backlog that cannot be read counts as busy: acting without knowing could
   * duplicate or wrongly reject a job that is only delayed.
   */
  private async isProcessingIdle(): Promise<boolean> {
    let backlog: MediaProcessingBacklog;

    try {
      backlog = await this.mediaProcessingQueue.readBacklog();
    } catch (error) {
      this.logger.warn(
        "Could not read the media processing backlog; stuck media is left for a later sweep.",
        undefined,
        error,
      );
      return false;
    }

    return backlog.waitingJobs === 0 && backlog.consumers > 0;
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
}
