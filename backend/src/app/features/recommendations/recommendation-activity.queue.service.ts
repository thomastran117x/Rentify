import type { Channel, ConsumeMessage, ConfirmChannel } from "amqplib";
import { loggerFactory } from "@/configuration/logging";
import { createRabbitMqChannel } from "@/configuration/resources/rabbitmq";
import type { RecommendationActivityEventPayload } from "@/features/recommendations/recommendation-activity.model";

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;
const recommendationQueueLogger = loggerFactory.forComponent(
  "recommendation-activity.queue.service",
  "queue",
);

export class RecommendationActivityQueueService {
  private readonly exchangeName = "recommendation-activity.exchange";
  private readonly mainQueueName = "recommendation-activity.main";
  private readonly retryQueueNames = RETRY_DELAYS_MS.map(
    (_delay, index) => `recommendation-activity.retry.${index + 1}`,
  );
  private readonly deadLetterQueueName = "recommendation-activity.dead-letter";
  private publisherChannelPromise: Promise<ConfirmChannel> | null = null;
  private publisherTopologyPromise: Promise<void> | null = null;

  async ensureTopology(): Promise<void> {
    const channel = await createRabbitMqChannel();

    try {
      await this.assertTopology(channel);
    } finally {
      await channel.close();
    }
  }

  async publishActivityEvent(
    payload: RecommendationActivityEventPayload,
  ): Promise<void> {
    await this.publishWithRoutingKey("main", payload, payload.eventId);
  }

  async publishRetryEvent(
    payload: RecommendationActivityEventPayload,
    attempt: number,
  ): Promise<void> {
    const retryIndex = Math.min(
      Math.max(attempt - 1, 0),
      this.retryQueueNames.length - 1,
    );
    await this.publishWithRoutingKey(
      `retry.${retryIndex + 1}`,
      payload,
      payload.eventId,
      {
        "x-retry-attempt": attempt,
      },
    );
  }

  async publishDeadLetterPayload(
    payload: unknown,
    options?: {
      messageId?: string;
      reason?: string;
      error?: string;
      headers?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.publishWithRoutingKey(
      "dead-letter",
      payload,
      options?.messageId,
      {
        ...(options?.headers ?? {}),
        ...(options?.reason ? { deadLetterReason: options.reason } : {}),
        ...(options?.error ? { deadLetterError: options.error } : {}),
      },
    );
  }

  async consumeActivityEvents(
    prefetch: number,
    onMessage: (
      payload: unknown,
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
          let payload: unknown;

          try {
            payload = JSON.parse(message.content.toString("utf8")) as unknown;
          } catch (error) {
            recommendationQueueLogger.error(
              "Recommendation activity consumer received an invalid JSON payload.",
              {
                messageId: message.properties.messageId,
              },
              error,
            );
            await this.publishMalformedMessage(channel, message, error);
            channel.ack(message);
            return;
          }

          await onMessage(payload, message, channel);
        } catch (error) {
          recommendationQueueLogger.error(
            "Recommendation activity consumer failed before ack/nack handling.",
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
    payload: unknown,
    messageId?: string,
    headers?: Record<string, unknown>,
  ): Promise<void> {
    const channel = await this.getPublisherChannel();

    try {
      await this.ensurePublisherTopology(channel);
      channel.publish(
        this.exchangeName,
        routingKey,
        Buffer.from(JSON.stringify(payload), "utf8"),
        {
          persistent: true,
          contentType: "application/json",
          messageId,
          timestamp: Date.now(),
          headers,
        },
      );
      await channel.waitForConfirms();
    } catch (error) {
      this.resetPublisherChannel();
      throw error;
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

  private async publishMalformedMessage(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    error: unknown,
  ): Promise<void> {
    channel.publish(this.exchangeName, "dead-letter", message.content, {
      persistent: true,
      contentType: message.properties.contentType || "application/json",
      messageId: message.properties.messageId,
      timestamp: Date.now(),
      headers: {
        ...(message.properties.headers ?? {}),
        deadLetterReason: "invalid_json",
        deadLetterError:
          error instanceof Error ? error.message : "Invalid JSON payload.",
      },
    });
    await channel.waitForConfirms();
  }

  private async getPublisherChannel(): Promise<ConfirmChannel> {
    if (!this.publisherChannelPromise) {
      this.publisherChannelPromise = createRabbitMqChannel().then((channel) => {
        channel.on("close", () => {
          this.resetPublisherChannel();
        });
        channel.on("error", () => {
          this.resetPublisherChannel();
        });
        return channel;
      });
    }

    return this.publisherChannelPromise;
  }

  private async ensurePublisherTopology(
    channel: ConfirmChannel,
  ): Promise<void> {
    if (!this.publisherTopologyPromise) {
      this.publisherTopologyPromise = this.assertTopology(channel).catch(
        (error) => {
          this.publisherTopologyPromise = null;
          throw error;
        },
      );
    }

    await this.publisherTopologyPromise;
  }

  private resetPublisherChannel(): void {
    this.publisherChannelPromise = null;
    this.publisherTopologyPromise = null;
  }
}
