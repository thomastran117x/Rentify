import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import {
  databaseWorkerResource,
  disconnectResources,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const workerName = "Payout release worker";
const workerResources = [databaseWorkerResource];

export async function bootstrapPayoutReleaseWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs: () =>
      environment.getPayoutReleaseWorkerConfig().pollIntervalMs,
    runOnce: async ({ scope }) => {
      const service = scope.resolve(containerTokens.paymentsService);
      const { batchSize } = environment.getPayoutReleaseWorkerConfig();
      return service.processDuePayouts(batchSize);
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapPayoutReleaseWorker,
  cleanup: () => disconnectResources(workerResources),
});
