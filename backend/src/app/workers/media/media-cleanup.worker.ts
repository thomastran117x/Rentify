import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  databaseWorkerResource,
  disconnectResources,
  rabbitMqWorkerResource,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const workerName = "Media cleanup worker";
// RabbitMQ is required because the sweep re-enqueues items whose processing
// job was lost. Blob storage is reached through BlobService, which needs no
// connection of its own.
const workerResources = [databaseWorkerResource, rabbitMqWorkerResource];
const workerLogger = loggerFactory
  .forComponent("media-cleanup.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapMediaCleanupWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs: () =>
      environment.getMediaCleanupWorkerConfig().pollIntervalMs,
    runOnce: async ({ scope }) => {
      const mediaCleanupService = scope.resolve(
        containerTokens.mediaCleanupService,
      );
      const summary = await mediaCleanupService.sweep(
        environment.getMediaCleanupWorkerConfig(),
      );
      const processedCount =
        summary.abandonedDeleted +
        summary.requeued +
        summary.rejected +
        summary.rejectedPurged;

      if (processedCount > 0 || summary.failed > 0) {
        workerLogger.info("Media cleanup sweep completed.", { ...summary });
      }

      // Failures are left out, so a sweep whose every item failed waits out the
      // poll interval instead of retrying them at once; a backlog of items
      // that were handled drains at full speed.
      return processedCount;
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapMediaCleanupWorker,
  cleanup: () => disconnectResources(workerResources),
});
