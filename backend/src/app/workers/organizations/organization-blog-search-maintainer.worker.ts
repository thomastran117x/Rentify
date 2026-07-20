import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  disconnectResources,
  searchBrokerWorkerResources,
} from "@/workers/shared/resources";
import {
  bootstrapWorker,
  sleep,
  startWorker,
  type ScopedWorkerContext,
} from "@/workers/shared/worker-runtime";

const workerName = "Organization blog search maintainer worker";
const workerResources = searchBrokerWorkerResources;
const MIN_IDLE_SLEEP_MS = 100;
const workerLogger = loggerFactory
  .forComponent("organization-blog-search-maintainer.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapOrganizationBlogSearchMaintainerWorker(): Promise<void> {
  await bootstrapWorker({
    name: workerName,
    resources: workerResources,
    run: async ({ container }, lifecycle) => {
      const relayConfig = environment.getSearchRelayWorkerConfig();
      const reindexConfig = environment.getSearchReindexWorkerConfig();
      const reconcileConfig = environment.getSearchReconcileWorkerConfig();

      let nextRelayAt = 0;
      let nextReindexAt = 0;
      let nextReconcileAt = 0;

      while (!lifecycle.isShuttingDown()) {
        const now = Date.now();
        let processedCount = 0;

        if (now >= nextRelayAt) {
          processedCount += await runScheduledTask(
            container.createScope(),
            async ({ scope }) => {
              const searchService = scope.resolve(
                containerTokens.organizationBlogSearchService,
              );
              return searchService.processOutboxRelayBatch(
                relayConfig.batchSize,
                relayConfig.maxAttempts,
              );
            },
            workerName,
            "relay",
          );
          nextRelayAt = Date.now() + relayConfig.pollIntervalMs;
        }

        if (Date.now() >= nextReindexAt) {
          processedCount += await runScheduledTask(
            container.createScope(),
            async ({ scope }) => {
              const searchService = scope.resolve(
                containerTokens.organizationBlogSearchService,
              );
              return searchService.processReindexRuns(reindexConfig.batchSize);
            },
            workerName,
            "reindex",
          );
          nextReindexAt = Date.now() + reindexConfig.pollIntervalMs;
        }

        if (Date.now() >= nextReconcileAt) {
          processedCount += await runScheduledTask(
            container.createScope(),
            async ({ scope }) => {
              const searchService = scope.resolve(
                containerTokens.organizationBlogSearchService,
              );
              return searchService.processReconciliationBatch(
                reconcileConfig.batchSize,
              );
            },
            workerName,
            "reconcile",
          );
          nextReconcileAt = Date.now() + reconcileConfig.pollIntervalMs;
        }

        if (processedCount > 0) {
          continue;
        }

        const nextWakeAt = Math.min(
          nextRelayAt,
          nextReindexAt,
          nextReconcileAt,
        );
        const sleepMs = Math.max(MIN_IDLE_SLEEP_MS, nextWakeAt - Date.now());
        await sleep(sleepMs);
      }
    },
  });
}

async function runScheduledTask(
  scope: ScopedWorkerContext["scope"],
  task: (context: Pick<ScopedWorkerContext, "scope">) => Promise<number | void>,
  parentWorkerName: string,
  taskName: "relay" | "reindex" | "reconcile",
): Promise<number> {
  try {
    return (await task({ scope })) ?? 0;
  } catch (error) {
    workerLogger.error(
      "Scheduled organization blog search maintenance task failed.",
      {
        parentWorkerName,
        taskName,
      },
      error,
    );
    return 0;
  } finally {
    await scope.dispose();
  }
}

startWorker({
  name: workerName,
  bootstrap: bootstrapOrganizationBlogSearchMaintainerWorker,
  cleanup: () => disconnectResources(workerResources),
});
