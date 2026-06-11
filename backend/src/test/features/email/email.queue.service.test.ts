import type { Channel, ConsumeMessage } from "amqplib";
import { EmailQueueService } from "@/features/email/email.queue.service";

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

describe("EmailQueueService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("publishes new email jobs to the main queue with asserted topology", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new EmailQueueService();

    await service.enqueueEmailJob("verification", {
      to: "user@example.com",
      verificationCode: "123456",
      firstName: "Mia",
    });

    expect(channel.assertExchange).toHaveBeenCalledWith(
      "email.delivery.exchange",
      "direct",
      {
        durable: true,
      },
    );
    expect(channel.assertQueue).toHaveBeenCalledWith("email.delivery.main", {
      durable: true,
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      "email.delivery.main",
      "email.delivery.exchange",
      "main",
    );
    expect(channel.publish).toHaveBeenCalledWith(
      "email.delivery.exchange",
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
      };
      attempt: number;
      occurredAt: string;
    };
    const publishOptions = (channel.publish as jest.Mock).mock.calls[0]?.[3] as {
      messageId: string;
    };

    expect(payload).toEqual({
      jobId: expect.any(String),
      kind: "verification",
      input: {
        to: "user@example.com",
        verificationCode: "123456",
        firstName: "Mia",
      },
      attempt: 0,
      occurredAt: "2026-06-11T12:00:00.000Z",
    });
    expect(publishOptions.messageId).toBe(payload.jobId);
  });

  it("publishes retry and dead-letter jobs to the correct routing keys", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new EmailQueueService();
    const payload = {
      jobId: "job-1",
      kind: "password_reset" as const,
      input: {
        to: "user@example.com",
        resetCode: "123456",
      },
      attempt: 0,
      occurredAt: "2026-06-11T12:00:00.000Z",
    };

    await service.publishRetryJob(payload, 9);
    await service.publishDeadLetterJob(payload);

    expect(channel.publish).toHaveBeenNthCalledWith(
      1,
      "email.delivery.exchange",
      "retry.3",
      expect.any(Buffer),
      expect.any(Object),
    );
    expect(channel.publish).toHaveBeenNthCalledWith(
      2,
      "email.delivery.exchange",
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

  it("consumes queued email jobs and returns a cleanup handler", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const onMessage = jest.fn(async () => undefined);
    const service = new EmailQueueService();

    const stop = await service.consumeEmailJobs(5, onMessage);

    expect(channel.prefetch).toHaveBeenCalledWith(5);
    await createChannel.lastHandler?.({
      content: Buffer.from(
        JSON.stringify({
          jobId: "job-1",
          kind: "new_device",
          input: {
            to: "user@example.com",
          },
          attempt: 0,
          occurredAt: "2026-06-11T12:00:00.000Z",
        }),
        "utf8",
      ),
    } as ConsumeMessage);

    expect(onMessage).toHaveBeenCalledWith(
      {
        jobId: "job-1",
        kind: "new_device",
        input: {
          to: "user@example.com",
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
    const service = new EmailQueueService();

    await service.consumeEmailJobs(1, onMessage);
    await createChannel.lastHandler?.(null);

    expect(onMessage).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it("nacks malformed messages and worker failures for redelivery", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new EmailQueueService();
    const onMessage = jest.fn().mockRejectedValueOnce(new Error("worker failed"));

    await service.consumeEmailJobs(1, onMessage);

    const malformedMessage = {
      content: Buffer.from("{bad json", "utf8"),
    } as ConsumeMessage;
    await createChannel.lastHandler?.(malformedMessage);

    const validMessage = {
      content: Buffer.from(
        JSON.stringify({
          jobId: "job-2",
          kind: "verification",
          input: {
            to: "user@example.com",
            verificationCode: "123456",
          },
          attempt: 0,
          occurredAt: "2026-06-11T12:00:00.000Z",
        }),
        "utf8",
      ),
    } as ConsumeMessage;
    await createChannel.lastHandler?.(validMessage);

    expect(channel.nack).toHaveBeenCalledWith(malformedMessage, false, true);
    expect(channel.nack).toHaveBeenCalledWith(validMessage, false, true);
  });
});
