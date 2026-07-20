import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  disconnectResources,
  searchBrokerWorkerResources,
} from "@/workers/shared/resources";
import { bootstrapWorker, startWorker } from "@/workers/shared/worker-runtime";

const workerName = "Organization blog search indexer worker";
const workerResources = searchBrokerWorkerResources;
const workerLogger = loggerFactory
  .forComponent("organization-blog-search-indexer.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapOrganizationBlogSearchIndexerWorker(): Promise<void> {
  await bootstrapWorker({
    name: workerName,
    resources: workerResources,
    run: async ({ container }, lifecycle) => {
      const scope = container.createScope();
      const searchQueueService = scope.resolve(
        containerTokens.organizationBlogSearchQueueService,
      );
      const searchService = scope.resolve(
        containerTokens.organizationBlogSearchService,
      );
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
              "Failed to process organization blog search index job batch.",
              {
                outboxIds: entries.map((entry) => entry.payload.outboxId),
                blogPostIds: entries.map((entry) => entry.payload.postingId),
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
  bootstrap: bootstrapOrganizationBlogSearchIndexerWorker,
  cleanup: () => disconnectResources(workerResources),
});
