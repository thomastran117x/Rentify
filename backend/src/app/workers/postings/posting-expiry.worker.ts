import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  databaseWorkerResource,
  disconnectResources,
  rabbitMqWorkerResource,
  redisWorkerResource,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const workerName = "Posting expiry worker";
// Redis is required, not optional: the expiry transition takes the same booking
// window flow lock as pause/unpause and invalidates the public posting
// projection, both of which reach the Redis client. RabbitMQ is required because
// the reminder sweep enqueues email jobs.
const workerResources = [
  databaseWorkerResource,
  redisWorkerResource,
  rabbitMqWorkerResource,
];
const workerLogger = loggerFactory
  .forComponent("posting-expiry.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapPostingExpiryWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs: () =>
      environment.getPostingExpiryWorkerConfig().pollIntervalMs,
    runOnce: async ({ scope }) => {
      const postingExpiryService = scope.resolve(
        containerTokens.postingExpiryService,
      );
      const { batchSize, reminderLeadDays } =
        environment.getPostingExpiryWorkerConfig();

      // Expire first. Reminding first would let a posting due within seconds
      // receive an "expiring soon" email moments before it is paused.
      const expiredCount =
        await postingExpiryService.expireDuePostings(batchSize);
      const remindedCount = await postingExpiryService.sendDueExpiryReminders(
        batchSize,
        reminderLeadDays,
      );

      if (expiredCount > 0 || remindedCount > 0) {
        workerLogger.info("Posting expiry sweep completed.", {
          expiredCount,
          remindedCount,
        });
      }

      // Returning the combined count keeps the runtime draining a backlog at
      // full speed and sleeping only once both sweeps come up empty.
      return expiredCount + remindedCount;
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapPostingExpiryWorker,
  cleanup: () => disconnectResources(workerResources),
});
