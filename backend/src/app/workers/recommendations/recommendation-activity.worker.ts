import { bootstrapWorker, startWorker } from "@/workers/shared/worker-runtime";
import {
  databaseWorkerResource,
  disconnectResources,
  rabbitMqWorkerResource,
} from "@/workers/shared/resources";
import { containerTokens } from "@/configuration/bootstrap/container";
import type { RecommendationActivityQueueService } from "@/features/recommendations/recommendation-activity.queue.service";
import { recommendationActivityEventSchema } from "@/features/recommendations/recommendation-activity.model";
import type { RecommendationActivityProcessor } from "@/features/recommendations/recommendation-activity.processor";

const PREFETCH = 20;
const MAX_RETRY_ATTEMPTS = 4;
const workerResources = [databaseWorkerResource, rabbitMqWorkerResource];

async function bootstrapRecommendationActivityWorker(): Promise<void> {
  await bootstrapWorker({
    name: "recommendation-activity-worker",
    resources: workerResources,
    run: async ({ container }, lifecycle) => {
      const queueService =
        container.resolve<RecommendationActivityQueueService>(
          containerTokens.recommendationActivityQueueService,
        );
      const processor = container.resolve<RecommendationActivityProcessor>(
        containerTokens.recommendationActivityProcessor,
      );
      await queueService.ensureTopology();

      const stopConsuming = await queueService.consumeActivityEvents(
        PREFETCH,
        async (payload, message, channel) => {
          const parsed = recommendationActivityEventSchema.safeParse(payload);

          if (!parsed.success) {
            await queueService.publishDeadLetterPayload(payload, {
              messageId: message.properties.messageId,
              reason: "invalid_payload",
              error: parsed.error.message,
            });
            channel.ack(message);
            return;
          }

          try {
            await processor.process(parsed.data);
            channel.ack(message);
          } catch (error) {
            const attempt =
              Number(message.properties.headers?.["x-retry-attempt"] ?? 0) + 1;

            if (attempt >= MAX_RETRY_ATTEMPTS) {
              await queueService.publishDeadLetterPayload(parsed.data, {
                messageId: parsed.data.eventId,
                reason: "processing_failed",
                error:
                  error instanceof Error
                    ? error.message
                    : "Unknown processing error.",
                headers: {
                  "x-retry-attempt": attempt,
                },
              });
            } else {
              await queueService.publishRetryEvent(parsed.data, attempt);
            }

            channel.ack(message);
          }
        },
      );

      lifecycle.addShutdownTask(stopConsuming);
    },
  });
}

startWorker({
  name: "recommendation-activity-worker",
  bootstrap: bootstrapRecommendationActivityWorker,
  cleanup: () => disconnectResources(workerResources),
});
