import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  databaseWorkerResource,
  disconnectResources,
  rabbitMqWorkerResource,
} from "@/workers/shared/resources";
import { bootstrapWorker, startWorker } from "@/workers/shared/worker-runtime";

const workerName = "Media processing worker";
const workerResources = [databaseWorkerResource, rabbitMqWorkerResource];
const workerLogger = loggerFactory
  .forComponent("media-processing.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapMediaProcessingWorker(): Promise<void> {
  await bootstrapWorker({
    name: workerName,
    resources: workerResources,
    run: async ({ container }, lifecycle) => {
      const scope = container.createScope();
      const queueService = scope.resolve(
        containerTokens.mediaProcessingQueueService,
      );
      const processingService = scope.resolve(
        containerTokens.mediaProcessingService,
      );
      const { prefetch, maxAttempts } =
        environment.getMediaProcessingWorkerConfig();

      const stopConsuming = await queueService.consumeMediaProcessingJobs(
        prefetch,
        async (payload, message, channel) => {
          try {
            await processingService.process(payload.mediaId);
            channel.ack(message);
          } catch (error) {
            const attempt = payload.attempt + 1;
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Unknown media processing error.";

            workerLogger.error(
              "Failed to process media processing job.",
              {
                jobId: payload.jobId,
                mediaId: payload.mediaId,
                attempt,
              },
              error,
            );

            if (attempt >= maxAttempts) {
              await queueService.publishDeadLetterJob({
                ...payload,
                attempt,
              });
              // The client is polling for this item; without a final state
              // it would wait until it gave up.
              await processingService.markProcessingFailed(payload.mediaId);
              workerLogger.error(
                "Media processing job moved to dead-letter queue.",
                {
                  jobId: payload.jobId,
                  mediaId: payload.mediaId,
                  error: errorMessage,
                },
              );
            } else {
              await queueService.publishRetryJob(payload, attempt);
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
  bootstrap: bootstrapMediaProcessingWorker,
  cleanup: () => disconnectResources(workerResources),
});
