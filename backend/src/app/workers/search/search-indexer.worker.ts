import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  disconnectResources,
  searchBrokerWorkerResources,
} from "@/workers/shared/resources";
import { bootstrapWorker, startWorker } from "@/workers/shared/worker-runtime";

const workerName = "Search indexer worker";
const workerResources = searchBrokerWorkerResources;
const workerLogger = loggerFactory
  .forComponent("search-indexer.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapSearchIndexerWorker(): Promise<void> {
  await bootstrapWorker({
    name: workerName,
    resources: workerResources,
    run: async ({ container }, lifecycle) => {
      const scope = container.createScope();
      const searchQueueService = scope.resolve(
        containerTokens.searchQueueService,
      );
      const searchService = scope.resolve(containerTokens.searchService);
      const { prefetch, batchSize, flushIntervalMs, concurrency, maxAttempts } =
        environment.getSearchIndexerWorkerConfig();
      const effectivePrefetch = Math.max(prefetch, batchSize * concurrency);

      const stopConsuming = await searchQueueService.consumeIndexJobBatches(
        effectivePrefetch,
        batchSize,
        flushIntervalMs,
        concurrency,
        async (entries, channel) => {
          try {
            await searchService.processIndexJobsBatch(
              entries.map((entry) => entry.payload),
              maxAttempts,
            );
            for (const entry of entries) {
              channel.ack(entry.message);
            }
          } catch (error) {
            workerLogger.error(
              "Failed to process search index job batch.",
              {
                outboxIds: entries.map((entry) => entry.payload.outboxId),
                postingIds: entries.map((entry) => entry.payload.postingId),
              },
              error,
            );
            for (const entry of entries) {
              channel.nack(entry.message, false, true);
            }
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
  bootstrap: bootstrapSearchIndexerWorker,
  cleanup: () => disconnectResources(workerResources),
});
