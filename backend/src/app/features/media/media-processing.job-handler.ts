import type { Channel, ConsumeMessage } from "amqplib";
import type { Logger } from "@/configuration/logging/types";
import type { MediaProcessingJobPayload } from "@/features/media/media.model";
import type { MediaProcessingQueueService } from "@/features/media/media-processing.queue.service";
import type { MediaProcessingService } from "@/features/media/media-processing.service";

export interface MediaProcessingJobHandlerDependencies {
  queue: Pick<
    MediaProcessingQueueService,
    "publishRetryJob" | "publishDeadLetterJob"
  >;
  processing: Pick<
    MediaProcessingService,
    "process" | "recordProcessingFailure" | "markProcessingFailed"
  >;
  maxAttempts: number;
  logger: Pick<Logger, "error">;
}

/**
 * Handles one media processing job and always settles it with an ack once the
 * job has been handed on: retried through the delayed retry queues, or moved
 * to the dead-letter queue after its last attempt.
 *
 * Only a failure to publish the job onward escapes, because acking then would
 * lose it; the consumer requeues the message in that case. Anything after a
 * successful publish must not escape. The job has already left for the retry
 * or dead-letter queue, so a requeue here would redeliver it immediately with
 * the same attempt count, and every pass would add another dead-letter copy.
 */
export function createMediaProcessingJobHandler(
  dependencies: MediaProcessingJobHandlerDependencies,
): (
  payload: MediaProcessingJobPayload,
  message: ConsumeMessage,
  channel: Channel,
) => Promise<void> {
  const { queue, processing, maxAttempts, logger } = dependencies;

  return async (payload, message, channel) => {
    try {
      await processing.process(payload.mediaId);
      channel.ack(message);
      return;
    } catch (error) {
      const attempt = payload.attempt + 1;
      const context = {
        jobId: payload.jobId,
        mediaId: payload.mediaId,
        attempt,
      };

      logger.error("Failed to process media processing job.", context, error);

      // Best effort, like marking a dead-lettered item rejected below: the
      // failure being recorded is often a database outage, and failing to
      // record it must not stop the job from being handed on.
      try {
        await processing.recordProcessingFailure(payload.mediaId, error);
      } catch (recordError) {
        logger.error(
          "Failed to record a media processing failure.",
          context,
          recordError,
        );
      }

      if (attempt < maxAttempts) {
        await queue.publishRetryJob(payload, attempt);
        channel.ack(message);
        return;
      }

      await queue.publishDeadLetterJob({ ...payload, attempt });
      logger.error("Media processing job moved to dead-letter queue.", {
        ...context,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // The job is dead-lettered. Marking it rejected lets a polling client stop
    // waiting, but it is best effort: the failure that exhausted the retries -
    // a database outage, say - is often still in progress. An item left
    // unfinished is picked up by the media cleanup worker once no processing
    // job is waiting: it is queued again, up to its re-queue limit, and then
    // rejected.
    try {
      await processing.markProcessingFailed(payload.mediaId);
    } catch (markError) {
      logger.error(
        "Failed to mark a dead-lettered media item as rejected.",
        { jobId: payload.jobId, mediaId: payload.mediaId },
        markError,
      );
    }

    channel.ack(message);
  };
}
