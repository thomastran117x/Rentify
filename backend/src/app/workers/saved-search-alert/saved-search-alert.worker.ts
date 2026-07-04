import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import type { SavedSearchAlertService } from "@/features/saved-searches/saved-search-alert.service";
import {
  databaseWorkerResource,
  disconnectResources,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const workerName = "Saved search alert worker";
const workerResources = [databaseWorkerResource];

export async function bootstrapSavedSearchAlertWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs: () =>
      environment.getSavedSearchAlertWorkerConfig().pollIntervalMs,
    runOnce: async ({ scope }) => {
      const service = scope.resolve<SavedSearchAlertService>(
        containerTokens.savedSearchAlertService,
      );
      const { batchSize } = environment.getSavedSearchAlertWorkerConfig();

      return service.processBatch(batchSize);
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapSavedSearchAlertWorker,
  cleanup: () => disconnectResources(workerResources),
});
