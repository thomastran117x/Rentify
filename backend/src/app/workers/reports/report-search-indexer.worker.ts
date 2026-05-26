import { containerTokens } from "@/configuration/container/tokens";
import {
  disconnectResources,
  elasticsearchWorkerResource,
  databaseWorkerResource,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 25;

async function bootstrap(): Promise<void> {
  await bootstrapPollingWorker({
    name: "report-search-indexer",
    resources: [databaseWorkerResource, elasticsearchWorkerResource],
    getPollIntervalMs: () => POLL_INTERVAL_MS,
    runOnce: async ({ scope }) => {
      const reportsService = scope.resolve(containerTokens.reportsService);
      return reportsService.processSearchOutboxBatch(BATCH_SIZE);
    },
  });
}

startWorker({
  name: "report-search-indexer",
  bootstrap,
  cleanup: () =>
    disconnectResources([databaseWorkerResource, elasticsearchWorkerResource]),
});
