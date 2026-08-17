import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import { rebuildUsernameBloom } from "@/features/auth/username-bloom/username-bloom-rebuild";
import {
  databaseWorkerResource,
  disconnectResources,
  redisWorkerResource,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const workerName = "Username bloom filter worker";
const workerResources = [databaseWorkerResource, redisWorkerResource];
const workerLogger = loggerFactory
  .forComponent("username-bloom.worker", "worker")
  .child({
    workerName,
  });

/**
 * Wakes far more often than it rebuilds. The rebuild decides for itself whether
 * enough time has passed, so a short poll only bounds how late a due rebuild
 * can start — polling at exactly the rebuild interval would let each cycle's
 * leftover drift accumulate.
 */
function getPollIntervalMs(): number {
  const { rebuildIntervalMs } = environment.getUsernameBloomConfig();

  return Math.max(60_000, Math.floor(rebuildIntervalMs / 6));
}

export async function bootstrapUsernameBloomWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs,
    runOnce: async ({ scope }) => {
      const config = environment.getUsernameBloomConfig();

      if (!config.enabled) {
        return 0;
      }

      const result = await rebuildUsernameBloom({
        store: scope.resolve(containerTokens.usernameBloomStore),
        repository: scope.resolve(containerTokens.usernameBloomRepository),
        cacheService: scope.resolve(containerTokens.cacheService),
        config: {
          capacity: config.capacity,
          falsePositiveRate: config.falsePositiveRate,
          rebuildIntervalMs: config.rebuildIntervalMs,
          batchSize: config.rebuildBatchSize,
          lockTtlMs: config.rebuildLockTtlMs,
        },
        logger: workerLogger,
      });

      if (result.status !== "rebuilt") {
        workerLogger.debug("Skipped the username bloom rebuild.", {
          status: result.status,
          generation: result.generation,
        });
      }

      // Always report no work so the loop sleeps between passes; the rebuild is
      // scheduled by elapsed time rather than by queue depth.
      return 0;
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapUsernameBloomWorker,
  cleanup: () => disconnectResources(workerResources),
});
