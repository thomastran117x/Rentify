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

const workerName = "Payment retry worker";
const workerResources = [databaseWorkerResource];

export async function bootstrapPaymentRetryWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs: () =>
      environment.getPaymentsRetryWorkerConfig().pollIntervalMs,
    runOnce: async ({ scope }) => {
      const service = scope.resolve(containerTokens.paymentsService);
      const { batchSize } = environment.getPaymentsRetryWorkerConfig();
      return service.processRetryQueue(batchSize);
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapPaymentRetryWorker,
  cleanup: () => disconnectResources(workerResources),
});
