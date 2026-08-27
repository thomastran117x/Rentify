import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  databaseWorkerResource,
  disconnectResources,
  elasticsearchWorkerResource,
  rabbitMqWorkerResource,
  redisWorkerResource,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const workerName = "Saved search alert worker";
// All four are required, not optional: replaying a saved search goes through
// the same public search path the browse page uses, so it constructs the
// Elasticsearch-backed search service and reads the Redis posting projection
// cache. RabbitMQ is required because every alert is an email job.
const workerResources = [
  databaseWorkerResource,
  elasticsearchWorkerResource,
  redisWorkerResource,
  rabbitMqWorkerResource,
];
const workerLogger = loggerFactory
  .forComponent("saved-search-alert.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapSavedSearchAlertWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs: () =>
      environment.getSavedSearchAlertWorkerConfig().pollIntervalMs,
    runOnce: async ({ scope }) => {
      const savedSearchAlertService = scope.resolve(
        containerTokens.savedSearchAlertService,
      );
      const { batchSize, pollIntervalMs, dailyIntervalHours } =
        environment.getSavedSearchAlertWorkerConfig();

      const processedCount = await savedSearchAlertService.runSweep({
        batchSize,
        // An `instant` search is re-checked once per poll, so the cadence the
        // visitor picked and the cadence the worker runs at cannot disagree.
        instantIntervalMs: pollIntervalMs,
        dailyIntervalMs: dailyIntervalHours * 60 * 60 * 1000,
      });

      if (processedCount > 0) {
        workerLogger.info("Saved search sweep completed.", {
          processedCount,
        });
      }

      return processedCount;
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapSavedSearchAlertWorker,
  cleanup: () => disconnectResources(workerResources),
});
