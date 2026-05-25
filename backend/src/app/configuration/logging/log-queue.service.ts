import {
  connect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";
import { environment } from "@/configuration/environment";
import type { LogEvent } from "@/configuration/logging/types";

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;

export class ApplicationLogQueueService {
  private readonly exchangeName = "application-logs.exchange";
  private readonly mainQueueName = "application-logs.main";
  private readonly retryQueueNames = RETRY_DELAYS_MS.map(
    (_delay, index) => `application-logs.retry.${index + 1}`,
  );
  private readonly deadLetterQueueName = "application-logs.dead-letter";
  private connectionPromise: Promise<ChannelModel> | null = null;
  private publisherChannelPromise: Promise<ConfirmChannel> | null = null;
  private publisherTopologyPromise: Promise<void> | null = null;

  async ensureTopology(): Promise<void> {
    const channel = await this.createChannel();

    try {
      await this.assertTopology(channel);
    } finally {
      await channel.close();
    }
  }

  async publishLogEvent(event: LogEvent): Promise<void> {
    const channel = await this.getPublisherChannel();

    try {
      await this.ensurePublisherTopology(channel);
      channel.publish(
        this.exchangeName,
        "main",
        Buffer.from(JSON.stringify(event), "utf8"),
        {
          persistent: true,
          contentType: "application/json",
          timestamp: Date.now(),
        },
      );
      await channel.waitForConfirms();
    } catch (error) {
      this.resetPublisherChannel();
      throw error;
    }
  }

  async consumeLogEvents(
    prefetch: number,
    onMessage: (
      event: LogEvent,
      message: ConsumeMessage,
      channel: Channel,
    ) => Promise<void>,
  ): Promise<() => Promise<void>> {
    const channel = await this.createChannel();
    await this.assertTopology(channel);
    await channel.prefetch(prefetch);

    const consumeResult = await channel.consume(
      this.mainQueueName,
      async (message) => {
        if (!message) {
          return;
        }

        try {
          let payload: LogEvent;

          try {
            payload = JSON.parse(message.content.toString("utf8")) as LogEvent;
          } catch (error) {
            await this.publishMalformedMessage(channel, message, error);
            channel.ack(message);
            return;
          }

          await onMessage(payload, message, channel);
        } catch {
          channel.nack(message, false, true);
        }
      },
    );

    return async () => {
      await channel.cancel(consumeResult.consumerTag);
      await channel.close();
    };
  }

  async disconnect(): Promise<void> {
    const publisherChannelPromise = this.publisherChannelPromise;
    this.publisherChannelPromise = null;
    this.publisherTopologyPromise = null;

    if (publisherChannelPromise) {
      try {
        const publisherChannel = await publisherChannelPromise;
        await publisherChannel.close();
      } catch {
        // Best-effort cleanup only.
      }
    }

    const connectionPromise = this.connectionPromise;
    this.connectionPromise = null;

    if (!connectionPromise) {
      return;
    }

    try {
      const connection = await connectionPromise;
      await connection.close();
    } catch {
      // Best-effort cleanup only.
    }
  }

  private getRabbitMqUrl(): string {
    try {
      return environment.getRabbitMqConfig().url ?? "";
    } catch {
      return process.env.RABBITMQ_URL?.trim() ?? "";
    }
  }

  private async getConnection(): Promise<ChannelModel> {
    if (!this.connectionPromise) {
      const url = this.getRabbitMqUrl();

      if (!url) {
        throw new Error("RabbitMQ URL is not configured for logging.");
      }

      this.connectionPromise = connect(url).then((connection) => {
        connection.on("close", () => {
          this.connectionPromise = null;
          this.resetPublisherChannel();
        });
        connection.on("error", () => {
          this.connectionPromise = null;
          this.resetPublisherChannel();
        });
        return connection;
      });
    }

    return this.connectionPromise;
  }

  private async createChannel(): Promise<ConfirmChannel> {
    const connection = await this.getConnection();
    return connection.createConfirmChannel();
  }

  private async getPublisherChannel(): Promise<ConfirmChannel> {
    if (!this.publisherChannelPromise) {
      this.publisherChannelPromise = this.createChannel().then((channel) => {
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
}
