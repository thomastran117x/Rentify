import { randomUUID } from "node:crypto";
import type { Channel, ConsumeMessage } from "amqplib";
import { loggerFactory } from "@/configuration/logging";
import { createRabbitMqChannel } from "@/configuration/resources/rabbitmq";
import type {
  SmsJobInputByKind,
  SmsJobKind,
  SmsJobPayload,
} from "@/features/sms/sms.model";

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;
const SMS_QUEUE_PREFIX = "sms.delivery";
const smsQueueLogger = loggerFactory.forComponent("sms.queue.service", "queue");

export class SmsQueueService {
  private readonly exchangeName = `${SMS_QUEUE_PREFIX}.exchange`;
  private readonly mainQueueName = `${SMS_QUEUE_PREFIX}.main`;
  private readonly retryQueueNames = RETRY_DELAYS_MS.map(
    (_, index) => `${SMS_QUEUE_PREFIX}.retry.${index + 1}`,
  );
  private readonly deadLetterQueueName = `${SMS_QUEUE_PREFIX}.dead-letter`;

  async enqueueSmsJob<TKind extends SmsJobKind>(
    kind: TKind,
    input: SmsJobInputByKind[TKind],
  ): Promise<void> {
    await this.publishWithRoutingKey("main", {
      jobId: randomUUID(),
      kind,
      input,
      attempt: 0,
      occurredAt: new Date().toISOString(),
    } as SmsJobPayload);
  }

  async publishRetryJob(payload: SmsJobPayload, attempt: number): Promise<void> {
    const retryIndex = Math.min(
      Math.max(attempt - 1, 0),
      this.retryQueueNames.length - 1,
    );
    await this.publishWithRoutingKey(`retry.${retryIndex + 1}`, {
      ...payload,
      attempt,
    });
  }

  async publishDeadLetterJob(payload: SmsJobPayload): Promise<void> {
    await this.publishWithRoutingKey("dead-letter", payload);
  }

  async consumeSmsJobs(
    prefetch: number,
    onMessage: (
      payload: SmsJobPayload,
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
          ) as SmsJobPayload;
          await onMessage(payload, message, channel);
        } catch (error) {
          smsQueueLogger.error(
            "SMS worker failed before ack/nack handling.",
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
    payload: SmsJobPayload,
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