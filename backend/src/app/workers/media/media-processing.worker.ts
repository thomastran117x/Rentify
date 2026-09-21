import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import { createMediaProcessingJobHandler } from "@/features/media/media-processing.job-handler";
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
        createMediaProcessingJobHandler({
          queue: queueService,
          processing: processingService,
          maxAttempts,
          logger: workerLogger,
        }),
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
