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

const workerName = "Payment repair worker";
const workerResources = [databaseWorkerResource];

export async function bootstrapPaymentRepairWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs: () =>
      environment.getPaymentsRepairWorkerConfig().pollIntervalMs,
    runOnce: async ({ scope }) => {
      const service = scope.resolve(containerTokens.paymentsService);
      const { batchSize } = environment.getPaymentsRepairWorkerConfig();
      return service.processRepairQueue(batchSize);
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapPaymentRepairWorker,
  cleanup: () => disconnectResources(workerResources),
});
