import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  databaseWorkerResource,
  disconnectResources,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const workerName = "Auth audit prune worker";
const workerResources = [databaseWorkerResource];
const workerLogger = loggerFactory
  .forComponent("auth-audit-prune.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapAuthAuditPruneWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs: () =>
      environment.getAuthAuditConfig().pruneIntervalMinutes * 60_000,
    runOnce: async ({ scope }) => {
      const retentionService = scope.resolve(
        containerTokens.authAuditRetentionService,
      );
      const { retentionDays, pruneBatchSize } =
        environment.getAuthAuditConfig();
      const summary = await retentionService.prune({
        retentionDays,
        batchSize: pruneBatchSize,
      });

      // Logged on every run, deletions or not, so the log shows the worker is
      // pruning even while nothing has aged past the cutoff.
      workerLogger.info("Auth audit prune completed.", {
        deleted: summary.deleted,
        batches: summary.batches,
        cutoff: summary.cutoff.toISOString(),
        retentionDays,
      });

      // A run already drains every expired row, so it always sleeps until the
      // next interval rather than starting another run at once.
      return 0;
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapAuthAuditPruneWorker,
  cleanup: () => disconnectResources(workerResources),
});
