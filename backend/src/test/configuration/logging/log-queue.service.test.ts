import type { ConsumeMessage } from "amqplib";
import { environment } from "@/configuration/environment";
import { ApplicationLogQueueService } from "@/configuration/logging/log-queue.service";

const mockConnect = jest.fn();

jest.mock("amqplib", () => ({
  connect: (...args: unknown[]) => mockConnect(...args),
}));

jest.mock("@/configuration/environment", () => ({
  environment: {
    getRabbitMqConfig: jest.fn(() => ({
      url: "amqp://logger.test",
    })),
  },
}));

function createMockChannel() {
  let consumeHandler:
    | ((message: ConsumeMessage | null) => Promise<void>)
    | undefined;
  const eventHandlers = new Map<string, () => void>();

  return {
    channel: {
      assertExchange: jest.fn(async () => undefined),
      assertQueue: jest.fn(async () => undefined),
      bindQueue: jest.fn(async () => undefined),
      prefetch: jest.fn(async () => undefined),
      consume: jest.fn(
        async (_queue: string, handler: typeof consumeHandler) => {
          consumeHandler = handler;
          return {
            consumerTag: "consumer-1",
          };
        },
      ),
      publish: jest.fn(() => true),
      waitForConfirms: jest.fn(async () => undefined),
      cancel: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
      ack: jest.fn(),
      nack: jest.fn(),
      on: jest.fn((event: string, handler: () => void) => {
        eventHandlers.set(event, handler);
      }),
    },
    getConsumeHandler: () => consumeHandler,
    getEventHandler: (event: string) => eventHandlers.get(event),
  };
}

function createMockConnection(
  channels: Array<ReturnType<typeof createMockChannel>>,
) {
  const eventHandlers = new Map<string, () => void>();

  return {
    connection: {
      createConfirmChannel: jest.fn(async () => {
        const next = channels.shift();

        if (!next) {
          throw new Error("No mock channel available.");
        }

        return next.channel;
      }),
      close: jest.fn(async () => undefined),
      on: jest.fn((event: string, handler: () => void) => {
        eventHandlers.set(event, handler);
      }),
    },
    getEventHandler: (event: string) => eventHandlers.get(event),
  };
}

function createLogEvent(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: "2026-06-07T00:00:00.000Z",
    level: "info",
    message: "Logger ready.",
    environment: "test",
    service: "backend-test",
    runtime: "node",
    component: "logger.test",
    layer: "service",
    ...overrides,
  } as never;
}

describe("ApplicationLogQueueService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RABBITMQ_URL = "amqp://logger.test";
  });

  afterEach(async () => {
    delete process.env.RABBITMQ_URL;
  });

  it("asserts the full logging queue topology and closes the setup channel", async () => {
    const topologyChannel = createMockChannel();
    const { connection } = createMockConnection([topologyChannel]);
    mockConnect.mockResolvedValue(connection);
    const service = new ApplicationLogQueueService();

    await service.ensureTopology();

    expect(mockConnect).toHaveBeenCalledWith("amqp://logger.test");
    expect(topologyChannel.channel.assertExchange).toHaveBeenCalledWith(
      "application-logs.exchange",
      "direct",
      {
        durable: true,
      },
    );
    expect(topologyChannel.channel.assertQueue).toHaveBeenCalledWith(
      "application-logs.main",
      {
        durable: true,
      },
    );
    expect(topologyChannel.channel.assertQueue).toHaveBeenCalledWith(
      "application-logs.retry.1",
      expect.objectContaining({
        durable: true,
        arguments: expect.objectContaining({
          "x-message-ttl": 5000,
          "x-dead-letter-routing-key": "main",
        }),
      }),
    );
    expect(topologyChannel.channel.assertQueue).toHaveBeenCalledWith(
      "application-logs.retry.3",
      expect.objectContaining({
        durable: true,
        arguments: expect.objectContaining({
          "x-message-ttl": 120000,
        }),
      }),
    );
    expect(topologyChannel.channel.bindQueue).toHaveBeenCalledWith(
      "application-logs.dead-letter",
      "application-logs.exchange",
      "dead-letter",
    );
    expect(topologyChannel.channel.close).toHaveBeenCalled();
  });

  it("publishes log events through a cached publisher channel", async () => {
    const publisherChannel = createMockChannel();
    const { connection } = createMockConnection([publisherChannel]);
    mockConnect.mockResolvedValue(connection);
    const service = new ApplicationLogQueueService();

    await service.publishLogEvent(createLogEvent({ message: "first" }));
    await service.publishLogEvent(createLogEvent({ message: "second" }));

    expect(connection.createConfirmChannel).toHaveBeenCalledTimes(1);
    expect(publisherChannel.channel.assertExchange).toHaveBeenCalledTimes(1);
    expect(publisherChannel.channel.publish).toHaveBeenNthCalledWith(
      1,
      "application-logs.exchange",
      "main",
      expect.any(Buffer),
      expect.objectContaining({
        persistent: true,
        contentType: "application/json",
      }),
    );
    expect(publisherChannel.channel.publish).toHaveBeenNthCalledWith(
      2,
      "application-logs.exchange",
      "main",
      expect.any(Buffer),
      expect.objectContaining({
        persistent: true,
        contentType: "application/json",
      }),
    );
    expect(publisherChannel.channel.waitForConfirms).toHaveBeenCalledTimes(2);
  });

  it("resets the publisher channel after publish failures", async () => {
    const failingChannel = createMockChannel();
    failingChannel.channel.waitForConfirms = jest.fn(async () => {
      throw new Error("confirm failed");
    });
    const recoveredChannel = createMockChannel();
    const { connection } = createMockConnection([
      failingChannel,
      recoveredChannel,
    ]);
    mockConnect.mockResolvedValue(connection);
    const service = new ApplicationLogQueueService();

    await expect(
      service.publishLogEvent(createLogEvent({ message: "first" })),
    ).rejects.toThrow("confirm failed");

    await service.publishLogEvent(createLogEvent({ message: "second" }));

    expect(connection.createConfirmChannel).toHaveBeenCalledTimes(2);
    expect(recoveredChannel.channel.publish).toHaveBeenCalledTimes(1);
  });

  it("dead-letters malformed consumer payloads instead of requeueing them", async () => {
    const consumerChannel = createMockChannel();
    const { connection } = createMockConnection([consumerChannel]);
    mockConnect.mockResolvedValue(connection);
    const service = new ApplicationLogQueueService();

    await service.consumeLogEvents(5, async () => undefined);

    const handler = consumerChannel.getConsumeHandler();
    expect(handler).toBeDefined();

    const message = {
      content: Buffer.from("{invalid-json", "utf8"),
      properties: {
        contentType: "application/json",
        headers: {
          traceId: "trace-1",
        },
      },
    } as unknown as ConsumeMessage;

    await handler!(message);

    expect(consumerChannel.channel.publish).toHaveBeenCalledWith(
      "application-logs.exchange",
      "dead-letter",
      message.content,
      expect.objectContaining({
        persistent: true,
        contentType: "application/json",
        headers: expect.objectContaining({
          traceId: "trace-1",
          deadLetterReason: "invalid_json",
        }),
      }),
    );
    expect(consumerChannel.channel.waitForConfirms).toHaveBeenCalled();
    expect(consumerChannel.channel.ack).toHaveBeenCalledWith(message);
    expect(consumerChannel.channel.nack).not.toHaveBeenCalled();
  });

  it("nacks consumer payloads when the worker throws", async () => {
    const consumerChannel = createMockChannel();
    const { connection } = createMockConnection([consumerChannel]);
    mockConnect.mockResolvedValue(connection);
    const service = new ApplicationLogQueueService();

    await service.consumeLogEvents(3, async () => {
      throw new Error("worker failed");
    });

    const handler = consumerChannel.getConsumeHandler();
    const message = {
      content: Buffer.from(JSON.stringify(createLogEvent()), "utf8"),
      properties: {},
    } as unknown as ConsumeMessage;

    await handler!(message);

    expect(consumerChannel.channel.nack).toHaveBeenCalledWith(
      message,
      false,
      true,
    );
    expect(consumerChannel.channel.ack).not.toHaveBeenCalled();
  });

  it("ignores null deliveries and closes the consumer channel on stop", async () => {
    const consumerChannel = createMockChannel();
    const { connection } = createMockConnection([consumerChannel]);
    mockConnect.mockResolvedValue(connection);
    const service = new ApplicationLogQueueService();

    const stop = await service.consumeLogEvents(2, async () => undefined);
    const handler = consumerChannel.getConsumeHandler();

    await handler!(null);
    await stop();

    expect(consumerChannel.channel.ack).not.toHaveBeenCalled();
    expect(consumerChannel.channel.nack).not.toHaveBeenCalled();
    expect(consumerChannel.channel.cancel).toHaveBeenCalledWith("consumer-1");
    expect(consumerChannel.channel.close).toHaveBeenCalled();
  });

  it("disconnects the publisher channel and shared connection with best-effort cleanup", async () => {
    const publisherChannel = createMockChannel();
    const { connection } = createMockConnection([publisherChannel]);
    mockConnect.mockResolvedValue(connection);
    const service = new ApplicationLogQueueService();

    await service.publishLogEvent(createLogEvent());

    await service.disconnect();
    await service.disconnect();

    expect(publisherChannel.channel.close).toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalled();
  });

  it("throws when no RabbitMQ URL is configured", async () => {
    const getRabbitMqConfig = environment.getRabbitMqConfig as jest.Mock;
    getRabbitMqConfig.mockImplementationOnce(() => {
      throw new Error("missing config");
    });
    delete process.env.RABBITMQ_URL;
    const service = new ApplicationLogQueueService();

    await expect(service.ensureTopology()).rejects.toThrow(
      "RabbitMQ URL is not configured for logging.",
    );
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
