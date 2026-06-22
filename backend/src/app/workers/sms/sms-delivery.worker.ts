import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment";
import { loggerFactory } from "@/configuration/logging";
import {
  disconnectResources,
  rabbitMqWorkerResource,
} from "@/workers/shared/resources";
import { bootstrapWorker, startWorker } from "@/workers/shared/worker-runtime";

const workerName = "SMS delivery worker";
const workerResources = [rabbitMqWorkerResource];
const workerLogger = loggerFactory
  .forComponent("sms-delivery.worker", "worker")
  .child({
    workerName,
  });

export async function bootstrapSmsDeliveryWorker(): Promise<void> {
  await bootstrapWorker({
    name: workerName,
    resources: workerResources,
    run: async ({ container }, lifecycle) => {
      const scope = container.createScope();
      const smsQueueService = scope.resolve(containerTokens.smsQueueService);
      const smsDeliveryService = scope.resolve(
        containerTokens.smsDeliveryService,
      );
      const { prefetch, maxAttempts } = environment.getSmsWorkerConfig();

      const stopConsuming = await smsQueueService.consumeSmsJobs(
        prefetch,
        async (payload, message, channel) => {
          try {
            await smsDeliveryService.deliver(payload);
            channel.ack(message);
          } catch (error) {
            const attempt = payload.attempt + 1;
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Unknown SMS delivery error.";
            const classification = smsDeliveryService.classifyError(error);
            const shouldRetry =
              classification.retryable && attempt < maxAttempts;

            workerLogger.error(
              "Failed to deliver SMS job.",
              {
                jobId: payload.jobId,
                kind: payload.kind,
                attempt,
                errorCategory: classification.category,
                errorCode: classification.code,
                retryable: classification.retryable,
              },
              error,
            );

            if (!shouldRetry) {
              await smsQueueService.publishDeadLetterJob({
                ...payload,
                attempt,
              });
            } else {
              await smsQueueService.publishRetryJob(payload, attempt);
            }

            channel.ack(message);

            if (!shouldRetry) {
              workerLogger.error("SMS job moved to dead-letter queue.", {
                jobId: payload.jobId,
                kind: payload.kind,
                error: errorMessage,
                errorCategory: classification.category,
                errorCode: classification.code,
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
  bootstrap: bootstrapSmsDeliveryWorker,
  cleanup: () => disconnectResources(workerResources),
});
