import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  databaseWorkerResource,
  disconnectResources,
  rabbitMqWorkerResource,
} from "@/workers/shared/resources";
import { bootstrapWorker, startWorker } from "@/workers/shared/worker-runtime";

const workerName = "Posting thumbnail worker";
const workerResources = [databaseWorkerResource, rabbitMqWorkerResource];
const workerLogger = loggerFactory
  .forComponent("posting-thumbnail.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapPostingThumbnailWorker(): Promise<void> {
  await bootstrapWorker({
    name: workerName,
    resources: workerResources,
    run: async ({ container }, lifecycle) => {
      const scope = container.createScope();
      const thumbnailQueueService = scope.resolve(
        containerTokens.postingThumbnailQueueService,
      );
      const thumbnailService = scope.resolve(
        containerTokens.postingThumbnailService,
      );
      const { prefetch, maxAttempts } =
        environment.getPostingsThumbnailWorkerConfig();

      const stopConsuming =
        await thumbnailQueueService.consumePostingThumbnailJobs(
          prefetch,
          async (payload, message, channel) => {
            try {
              await thumbnailService.generateForPosting(payload.postingId);
              channel.ack(message);
            } catch (error) {
              const attempt = payload.attempt + 1;
              const errorMessage =
                error instanceof Error
                  ? error.message
                  : "Unknown posting thumbnail generation error.";

              workerLogger.error(
                "Failed to process posting thumbnail job.",
                {
                  jobId: payload.jobId,
                  postingId: payload.postingId,
                  attempt,
                },
                error,
              );

              if (attempt >= maxAttempts) {
                await thumbnailQueueService.publishDeadLetterJob({
                  ...payload,
                  attempt,
                });
                workerLogger.error(
                  "Posting thumbnail job moved to dead-letter queue.",
                  {
                    jobId: payload.jobId,
                    postingId: payload.postingId,
                    error: errorMessage,
                  },
                );
              } else {
                await thumbnailQueueService.publishRetryJob(payload, attempt);
              }

              channel.ack(message);
            }
          },
        );

      lifecycle.addShutdownTask(async () => {
        await Promise.allSettled([stopConsuming(), scope.dispose()]);
      });
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapPostingThumbnailWorker,
  cleanup: () => disconnectResources(workerResources),
});
