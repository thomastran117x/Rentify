import { randomUUID } from "node:crypto";
import type { Channel, ConsumeMessage, GetMessage } from "amqplib";
import { loggerFactory } from "@/configuration/logging";
import { createRabbitMqChannel } from "@/configuration/resources/rabbitmq";
import type { MediaProcessingJobPayload } from "@/features/media/media.model";
import { isUuid, type Uuid } from "@/configuration/validation/uuid";

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;

export interface MediaProcessingBacklog {
  /** Jobs ready in the main queue or delayed in a retry tier. */
  waitingJobs: number;
  /** Workers consuming the main queue. */
  consumers: number;
}

/**
 * One message taken from the dead-letter queue and held unacknowledged: a job,
 * or `null` when its body is not one. `ack` removes it from the queue for
 * good; a message not acknowledged goes back when the reader closes.
 */
export interface MediaDeadLetterMessage {
  payload: MediaProcessingJobPayload | null;
  /**
   * When the job was published to the dead-letter queue, from the message's
   * timestamp, or null when it carries none.
   */
  deadLetteredAt: Date | null;
  ack(): void;
}

/** Reads `media.processing.dead-letter` one message at a time. */
export interface MediaDeadLetterReader {
  /** The next message, or null once the queue is empty. */
  take(): Promise<MediaDeadLetterMessage | null>;
  /** Closes the channel; every message not acknowledged is requeued. */
  close(): Promise<void>;
}

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

  /**
   * How many jobs wait to be processed, in the main queue or a retry tier,
   * and how many workers consume the main queue. The media cleanup reads this
   * to tell a lost job from one that is only delayed: while jobs wait or no
   * worker consumes them, an item that has not moved may still have its job.
   * Jobs a worker holds unacknowledged are not counted; their items are in
   * `processing` and report progress as they go.
   */
  async readBacklog(): Promise<MediaProcessingBacklog> {
    const channel = await createRabbitMqChannel();

    try {
      await this.assertTopology(channel);
      const main = await channel.checkQueue(this.mainQueueName);
      let waitingJobs = main.messageCount;

      for (const queueName of this.retryQueueNames) {
        waitingJobs += (await channel.checkQueue(queueName)).messageCount;
      }

      return { waitingJobs, consumers: main.consumerCount };
    } finally {
      await channel.close();
    }
  }

  /**
   * Opens the dead-letter queue for an operator's replay. Messages are taken
   * with `get`, not consumed, so the replay decides one at a time and stops
   * when the queue is empty; each stays unacknowledged until it is settled.
   */
  async openDeadLetterQueue(): Promise<MediaDeadLetterReader> {
    const channel = await createRabbitMqChannel();

    try {
      await this.assertTopology(channel);
    } catch (error) {
      await channel.close();
      throw error;
    }

    return {
      take: async () => {
        const message = await channel.get(this.deadLetterQueueName, {
          noAck: false,
        });

        if (!message) {
          return null;
        }

        return {
          payload: parseJobPayload(message),
          deadLetteredAt: readTimestamp(message),
          ack: () => channel.ack(message),
        };
      },
      close: async () => {
        await channel.close();
      },
    };
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

/**
 * The message's publish time. Every job this service publishes carries it, in
 * milliseconds.
 */
function readTimestamp(message: GetMessage): Date | null {
  const timestamp: unknown = message.properties?.timestamp;

  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? new Date(timestamp)
    : null;
}

/** A job payload, or null when the message body is not one. */
function parseJobPayload(
  message: GetMessage,
): MediaProcessingJobPayload | null {
  let body: unknown;

  try {
    body = JSON.parse(message.content.toString("utf8"));
  } catch {
    return null;
  }

  if (!body || typeof body !== "object") {
    return null;
  }

  const { jobId, mediaId, attempt, occurredAt } = body as Record<
    string,
    unknown
  >;

  if (
    typeof jobId !== "string" ||
    typeof mediaId !== "string" ||
    !isUuid(mediaId) ||
    typeof attempt !== "number" ||
    typeof occurredAt !== "string" ||
    !Number.isFinite(Date.parse(occurredAt))
  ) {
    return null;
  }

  return { jobId, mediaId, attempt, occurredAt };
}
