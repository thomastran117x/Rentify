import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  emailBloomSubject,
  usernameBloomSubject,
} from "@/features/auth/identity-bloom/identity-bloom-subject";
import { rebuildIdentityBloom } from "@/features/auth/identity-bloom/identity-bloom-rebuild";
import type { IdentityBloomEnvironment } from "@/configuration/environment/types";
import type { IdentityBloomSubject } from "@/features/auth/identity-bloom/identity-bloom-subject";
import {
  databaseWorkerResource,
  disconnectResources,
  redisWorkerResource,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const workerName = "Identity bloom filter worker";
const workerResources = [databaseWorkerResource, redisWorkerResource];
const workerLogger = loggerFactory
  .forComponent("identity-bloom.worker", "worker")
  .child({
    workerName,
  });

/**
 * Both filters are rebuilt by one worker rather than two.
 *
 * They read different tables but hold independent Redis locks and freshness
 * records, so running them back to back in a single pass costs nothing they
 * would not have cost apart — and saves a second container that would spend
 * almost all of its life asleep.
 */
const subjects: {
  subject: IdentityBloomSubject;
  sourceToken:
    | typeof containerTokens.usernameBloomSource
    | typeof containerTokens.emailBloomSource;
  getConfig: () => IdentityBloomEnvironment;
}[] = [
  {
    subject: usernameBloomSubject,
    sourceToken: containerTokens.usernameBloomSource,
    getConfig: () => environment.getUsernameBloomConfig(),
  },
  {
    subject: emailBloomSubject,
    sourceToken: containerTokens.emailBloomSource,
    getConfig: () => environment.getEmailBloomConfig(),
  },
];

/**
 * Wakes far more often than it rebuilds. Each rebuild decides for itself
 * whether enough time has passed, so a short poll only bounds how late a due
 * rebuild can start — polling at exactly the rebuild interval would let each
 * cycle's leftover drift accumulate.
 *
 * The shortest configured interval sets the cadence, so neither filter is held
 * back by the other being configured to rebuild less often.
 */
function getPollIntervalMs(): number {
  const shortestIntervalMs = Math.min(
    ...subjects.map(({ getConfig }) => getConfig().rebuildIntervalMs),
  );

  return Math.max(60_000, Math.floor(shortestIntervalMs / 6));
}

export async function bootstrapIdentityBloomWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs,
    runOnce: async ({ scope }) => {
      for (const { subject, sourceToken, getConfig } of subjects) {
        const config = getConfig();

        if (!config.enabled) {
          continue;
        }

        const result = await rebuildIdentityBloom({
          subject,
          store: scope.resolve(containerTokens.identityBloomStore),
          source: scope.resolve(sourceToken),
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
          workerLogger.debug(`Skipped the ${subject.id} bloom rebuild.`, {
            subject: subject.id,
            status: result.status,
            generation: result.generation,
          });
        }
      }

      // Always report no work so the loop sleeps between passes; a rebuild is
      // scheduled by elapsed time rather than by queue depth.
      return 0;
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapIdentityBloomWorker,
  cleanup: () => disconnectResources(workerResources),
});
