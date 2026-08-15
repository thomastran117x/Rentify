import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import {
  databaseWorkerResource,
  disconnectResources,
  rabbitMqWorkerResource,
} from "@/workers/shared/resources";
import { bootstrapWorker, startWorker } from "@/workers/shared/worker-runtime";

const workerName = "Email delivery worker";
// The database resource is required by the `booking_message` kind, whose job
// payload carries ids that the delivery composer hydrates at send time.
const workerResources = [databaseWorkerResource, rabbitMqWorkerResource];
const workerLogger = loggerFactory
  .forComponent("email-delivery.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapEmailDeliveryWorker(): Promise<void> {
  await bootstrapWorker({
    name: workerName,
    resources: workerResources,
    run: async ({ container }, lifecycle) => {
      const scope = container.createScope();
      const emailQueueService = scope.resolve(
        containerTokens.emailQueueService,
      );
      const emailDeliveryService = scope.resolve(
        containerTokens.emailDeliveryService,
      );
      const { prefetch, maxAttempts } = environment.getEmailWorkerConfig();

      const stopConsuming = await emailQueueService.consumeEmailJobs(
        prefetch,
        async (payload, message, channel) => {
          try {
            await emailDeliveryService.deliver(payload);
            channel.ack(message);
          } catch (error) {
            const attempt = payload.attempt + 1;
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Unknown email delivery error.";

            workerLogger.error(
              "Failed to deliver email job.",
              {
                jobId: payload.jobId,
                kind: payload.kind,
                attempt,
              },
              error,
            );

            if (attempt >= maxAttempts) {
              await emailQueueService.publishDeadLetterJob({
                ...payload,
                attempt,
              });
            } else {
              await emailQueueService.publishRetryJob(payload, attempt);
            }

            channel.ack(message);

            if (attempt >= maxAttempts) {
              workerLogger.error("Email job moved to dead-letter queue.", {
                jobId: payload.jobId,
                kind: payload.kind,
                error: errorMessage,
              });
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
  bootstrap: bootstrapEmailDeliveryWorker,
  cleanup: () => disconnectResources(workerResources),
});
