import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  blobStorageWorkerResource,
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
const workerResources = [
  blobStorageWorkerResource,
  databaseWorkerResource,
  rabbitMqWorkerResource,
];
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
        summary.rejectedPurged +
        summary.unattachedDeleted +
        summary.attached +
        summary.auditHoldsRecorded;

      if (
        processedCount > 0 ||
        summary.failed > 0 ||
        summary.deferred > 0 ||
        summary.held > 0
      ) {
        workerLogger.info("Media cleanup sweep completed.", { ...summary });
      }

      // Failures, deferred items, and held items are left out, so a sweep
      // that could not act waits out the poll interval instead of retrying at
      // once; a backlog of items that were handled drains at full speed.
      // Attached items count: each was moved out of the next sweep's range,
      // so a first pass over a large catalog drains without a hot loop.
      return processedCount;
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapMediaCleanupWorker,
  cleanup: () => disconnectResources(workerResources),
});
