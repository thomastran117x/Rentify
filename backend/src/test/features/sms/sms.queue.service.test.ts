import type { Channel, ConsumeMessage } from "amqplib";
import { SmsQueueService } from "@/features/sms/sms.queue.service";

const mockCreateRabbitMqChannel = jest.fn();

jest.mock("@/configuration/resources/rabbitmq", () => ({
  createRabbitMqChannel: () => mockCreateRabbitMqChannel(),
}));

function createChannel() {
  return {
    assertExchange: jest.fn(async () => undefined),
    assertQueue: jest.fn(async () => undefined),
    bindQueue: jest.fn(async () => undefined),
    publish: jest.fn(() => true),
    waitForConfirms: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
    prefetch: jest.fn(async () => undefined),
    ack: jest.fn(),
    consume: jest.fn(
      async (
        _queue: string,
        handler: (message: ConsumeMessage | null) => Promise<void>,
      ) => {
        createChannel.lastHandler = handler;
        return {
          consumerTag: "consumer-1",
        };
      },
    ),
    nack: jest.fn(),
    cancel: jest.fn(async () => undefined),
  } as unknown as Channel;
}

createChannel.lastHandler = undefined as
  | ((message: ConsumeMessage | null) => Promise<void>)
  | undefined;

describe("SmsQueueService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("publishes new SMS jobs to the main queue with asserted topology", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SmsQueueService();

    await service.enqueueSmsJob("message", {
      to: "+14165550100",
      text: "Hello from Rentify",
      metadata: {
        tags: ["booking"],
      },
    });

    expect(channel.assertExchange).toHaveBeenCalledWith(
      "sms.delivery.exchange",
      "direct",
      {
        durable: true,
      },
    );
    expect(channel.assertQueue).toHaveBeenCalledWith("sms.delivery.main", {
      durable: true,
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      "sms.delivery.main",
      "sms.delivery.exchange",
      "main",
    );
    expect(channel.publish).toHaveBeenCalledWith(
      "sms.delivery.exchange",
      "main",
      expect.any(Buffer),
      expect.objectContaining({
        contentType: "application/json",
        persistent: true,
      }),
    );

    const payload = JSON.parse(
      (channel.publish as jest.Mock).mock.calls[0]?.[2].toString("utf8"),
    ) as {
      jobId: string;
      kind: string;
      input: {
        to: string;
        text: string;
      };
      attempt: number;
      occurredAt: string;
    };

    expect(payload).toEqual({
      jobId: expect.any(String),
      kind: "message",
      input: {
        to: "+14165550100",
        text: "Hello from Rentify",
        metadata: {
          tags: ["booking"],
        },
      },
      attempt: 0,
      occurredAt: "2026-06-11T12:00:00.000Z",
    });
  });

  it("publishes retry and dead-letter jobs to the correct routing keys", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SmsQueueService();
    const payload = {
      jobId: "job-1",
      kind: "message" as const,
      input: {
        to: "+14165550100",
        text: "Retry me",
      },
      attempt: 0,
      occurredAt: "2026-06-11T12:00:00.000Z",
    };

    await service.publishRetryJob(payload, 9);
    await service.publishDeadLetterJob(payload);

    expect(channel.publish).toHaveBeenNthCalledWith(
      1,
      "sms.delivery.exchange",
      "retry.3",
      expect.any(Buffer),
      expect.any(Object),
    );
    expect(channel.publish).toHaveBeenNthCalledWith(
      2,
      "sms.delivery.exchange",
      "dead-letter",
      expect.any(Buffer),
      expect.any(Object),
    );
    expect(
      JSON.parse(
        (channel.publish as jest.Mock).mock.calls[0]?.[2].toString("utf8"),
      ),
    ).toEqual({
      ...payload,
      attempt: 9,
    });
  });

  it("consumes queued SMS jobs and returns a cleanup handler", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const onMessage = jest.fn(async () => undefined);
    const service = new SmsQueueService();

    const stop = await service.consumeSmsJobs(5, onMessage);

    expect(channel.prefetch).toHaveBeenCalledWith(5);
    await createChannel.lastHandler?.({
      content: Buffer.from(
        JSON.stringify({
          jobId: "job-1",
          kind: "message",
          input: {
            to: "+14165550100",
            text: "Queued hello",
          },
          attempt: 0,
          occurredAt: "2026-06-11T12:00:00.000Z",
        }),
        "utf8",
      ),
      properties: {},
    } as ConsumeMessage);

    expect(onMessage).toHaveBeenCalledWith(
      {
        jobId: "job-1",
        kind: "message",
        input: {
          to: "+14165550100",
          text: "Queued hello",
        },
        attempt: 0,
        occurredAt: "2026-06-11T12:00:00.000Z",
      },
      expect.any(Object),
      channel,
    );

    await stop();

    expect(channel.cancel).toHaveBeenCalledWith("consumer-1");
    expect(channel.close).toHaveBeenCalled();
  });

  it("ignores null consumer messages", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const onMessage = jest.fn(async () => undefined);
    const service = new SmsQueueService();

    await service.consumeSmsJobs(1, onMessage);
    await createChannel.lastHandler?.(null);

    expect(onMessage).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it("dead-letters malformed messages instead of requeueing them forever", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SmsQueueService();
    const onMessage = jest.fn(async () => undefined);

    await service.consumeSmsJobs(1, onMessage);

    const malformedMessage = {
      content: Buffer.from("{bad json", "utf8"),
      properties: {
        contentType: "application/json",
        messageId: "bad-message",
        headers: {
          source: "test",
        },
      },
    } as unknown as ConsumeMessage;
    await createChannel.lastHandler?.(malformedMessage);

    expect(channel.publish).toHaveBeenCalledWith(
      "sms.delivery.exchange",
      "dead-letter",
      malformedMessage.content,
      expect.objectContaining({
        contentType: "application/json",
        messageId: "bad-message",
        headers: expect.objectContaining({
          source: "test",
          deadLetterReason: "invalid_json",
        }),
      }),
    );
    expect(channel.ack).toHaveBeenCalledWith(malformedMessage);
    expect(channel.nack).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("still nacks unexpected consumer failures for redelivery", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SmsQueueService();
    const onMessage = jest
      .fn()
      .mockRejectedValueOnce(new Error("worker failed"));

    await service.consumeSmsJobs(1, onMessage);

    const validMessage = {
      content: Buffer.from(
        JSON.stringify({
          jobId: "job-2",
          kind: "message",
          input: {
            to: "+14165550100",
            text: "This one fails in worker",
          },
          attempt: 0,
          occurredAt: "2026-06-11T12:00:00.000Z",
        }),
        "utf8",
      ),
      properties: {},
    } as unknown as ConsumeMessage;
    await createChannel.lastHandler?.(validMessage);

    expect(channel.nack).toHaveBeenCalledWith(validMessage, false, true);
  });
});
