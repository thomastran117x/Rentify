import { randomUUID } from "node:crypto";
import type { Channel, ConsumeMessage } from "amqplib";
import { loggerFactory } from "@/configuration/logging";
import { createRabbitMqChannel } from "@/configuration/resources/rabbitmq";
import type { MediaProcessingJobPayload } from "@/features/media/media.model";
import type { Uuid } from "@/configuration/validation/uuid";

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;
const MEDIA_PROCESSING_QUEUE_PREFIX = "media.processing";
const mediaProcessingQueueLogger = loggerFactory.forComponent(
  "media.processing.queue.service",
  "queue",
);

/**
 * RabbitMQ topology for media processing jobs: a main queue, delayed retry
 * queues that dead-letter back into it, and a dead-letter queue for jobs that
 * exhausted their attempts. The same shape as the posting thumbnail queue.
 */
export class MediaProcessingQueueService {
  private readonly exchangeName = `${MEDIA_PROCESSING_QUEUE_PREFIX}.exchange`;
  private readonly mainQueueName = `${MEDIA_PROCESSING_QUEUE_PREFIX}.main`;
  private readonly retryQueueNames = RETRY_DELAYS_MS.map(
    (_, index) => `${MEDIA_PROCESSING_QUEUE_PREFIX}.retry.${index + 1}`,
  );
  private readonly deadLetterQueueName = `${MEDIA_PROCESSING_QUEUE_PREFIX}.dead-letter`;

  async enqueueMediaProcessingJob(mediaId: Uuid): Promise<void> {
    await this.publishWithRoutingKey("main", {
      jobId: randomUUID(),
      mediaId,
      attempt: 0,
      occurredAt: new Date().toISOString(),
    });
  }

  async publishRetryJob(
    payload: MediaProcessingJobPayload,
    attempt: number,
  ): Promise<void> {
    const retryIndex = Math.min(
      Math.max(attempt - 1, 0),
      this.retryQueueNames.length - 1,
    );
    await this.publishWithRoutingKey(`retry.${retryIndex + 1}`, {
      ...payload,
      attempt,
    });
  }

  async publishDeadLetterJob(
    payload: MediaProcessingJobPayload,
  ): Promise<void> {
    await this.publishWithRoutingKey("dead-letter", payload);
  }

  async consumeMediaProcessingJobs(
    prefetch: number,
    onMessage: (
      payload: MediaProcessingJobPayload,
      message: ConsumeMessage,
      channel: Channel,
    ) => Promise<void>,
  ): Promise<() => Promise<void>> {
    const channel = await createRabbitMqChannel();
    await this.assertTopology(channel);
    await channel.prefetch(prefetch);

    const consumeResult = await channel.consume(
      this.mainQueueName,
      async (message) => {
        if (!message) {
          return;
        }

        try {
          const payload = JSON.parse(
            message.content.toString("utf8"),
          ) as MediaProcessingJobPayload;
          await onMessage(payload, message, channel);
        } catch (error) {
          mediaProcessingQueueLogger.error(
            "Media processing worker failed before ack/nack handling.",
            undefined,
            error,
          );
          channel.nack(message, false, true);
        }
      },
    );

    return async () => {
      await channel.cancel(consumeResult.consumerTag);
      await channel.close();
    };
  }

  private async publishWithRoutingKey(
    routingKey: string,
    payload: MediaProcessingJobPayload,
  ): Promise<void> {
    const channel = await createRabbitMqChannel();

    try {
      await this.assertTopology(channel);
      channel.publish(
        this.exchangeName,
        routingKey,
        Buffer.from(JSON.stringify(payload), "utf8"),
        {
          persistent: true,
          contentType: "application/json",
          messageId: payload.jobId,
          timestamp: Date.now(),
        },
      );
      await channel.waitForConfirms();
    } finally {
      await channel.close();
    }
  }

  private async assertTopology(channel: Channel): Promise<void> {
    await channel.assertExchange(this.exchangeName, "direct", {
      durable: true,
    });
    await channel.assertQueue(this.mainQueueName, {
      durable: true,
    });
    await channel.bindQueue(this.mainQueueName, this.exchangeName, "main");

    for (const [index, queueName] of this.retryQueueNames.entries()) {
      await channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          "x-message-ttl": RETRY_DELAYS_MS[index],
          "x-dead-letter-exchange": this.exchangeName,
          "x-dead-letter-routing-key": "main",
        },
      });
      await channel.bindQueue(
        queueName,
        this.exchangeName,
        `retry.${index + 1}`,
      );
    }

    await channel.assertQueue(this.deadLetterQueueName, {
      durable: true,
    });
    await channel.bindQueue(
      this.deadLetterQueueName,
      this.exchangeName,
      "dead-letter",
    );
  }
}
