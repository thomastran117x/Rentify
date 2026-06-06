import { RecommendationActivityQueueService } from "@/features/recommendations/recommendation-activity.queue.service";

const mockCreateRabbitMqChannel = jest.fn();

jest.mock("@/configuration/resources/rabbitmq", () => ({
  createRabbitMqChannel: () => mockCreateRabbitMqChannel(),
}));

function createMockChannel() {
  let consumeHandler:
    | ((
        message: {
          content: Buffer;
          properties: {
            messageId?: string;
            contentType?: string;
            headers?: Record<string, unknown>;
          };
        } | null,
      ) => Promise<void>)
    | undefined;

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
      on: jest.fn(),
    },
    getConsumeHandler: () => consumeHandler,
  };
}

function createEventPayload(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "event-1",
    eventType: "posting_view",
    occurredAt: "2026-05-01T00:00:00.000Z",
    postingId: "posting-1",
    actorUserId: "user-1",
    deviceType: "desktop",
    source: "posting_detail",
    personalizationEnabled: true,
    ...overrides,
  };
}

describe("RecommendationActivityQueueService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-05-20T15:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("asserts the full recommendation activity queue topology", async () => {
    const { channel } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new RecommendationActivityQueueService();

    await service.ensureTopology();

    expect(channel.assertExchange).toHaveBeenCalledWith(
      "recommendation-activity.exchange",
      "direct",
      {
        durable: true,
      },
    );
    expect(channel.assertQueue).toHaveBeenCalledWith(
      "recommendation-activity.main",
      {
        durable: true,
      },
    );
    expect(channel.assertQueue).toHaveBeenCalledWith(
      "recommendation-activity.retry.1",
      expect.objectContaining({
        durable: true,
        arguments: expect.objectContaining({
          "x-message-ttl": 5000,
          "x-dead-letter-routing-key": "main",
        }),
      }),
    );
    expect(channel.assertQueue).toHaveBeenCalledWith(
      "recommendation-activity.retry.3",
      expect.objectContaining({
        durable: true,
        arguments: expect.objectContaining({
          "x-message-ttl": 120000,
        }),
      }),
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      "recommendation-activity.dead-letter",
      "recommendation-activity.exchange",
      "dead-letter",
    );
    expect(channel.close).toHaveBeenCalled();
  });

  it("publishes activity and retry events with the expected routing keys", async () => {
    const { channel } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new RecommendationActivityQueueService();

    await service.publishActivityEvent(createEventPayload());
    await service.publishRetryEvent(createEventPayload({ eventId: "event-2" }), 9);

    expect(mockCreateRabbitMqChannel).toHaveBeenCalledTimes(1);
    expect(channel.publish).toHaveBeenNthCalledWith(
      1,
      "recommendation-activity.exchange",
      "main",
      expect.any(Buffer),
      expect.objectContaining({
        messageId: "event-1",
        contentType: "application/json",
        persistent: true,
      }),
    );
    expect(channel.publish).toHaveBeenNthCalledWith(
      2,
      "recommendation-activity.exchange",
      "retry.3",
      expect.any(Buffer),
      expect.objectContaining({
        messageId: "event-2",
        headers: expect.objectContaining({
          "x-retry-attempt": 9,
        }),
      }),
    );
  });

  it("publishes dead-letter payloads with reason and error headers", async () => {
    const { channel } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new RecommendationActivityQueueService();

    await service.publishDeadLetterPayload(
      {
        raw: true,
      },
      {
        messageId: "dead-1",
        reason: "invalid_schema",
        error: "Missing postingId",
        headers: {
          source: "consumer",
        },
      },
    );

    expect(channel.publish).toHaveBeenCalledWith(
      "recommendation-activity.exchange",
      "dead-letter",
      expect.any(Buffer),
      expect.objectContaining({
        messageId: "dead-1",
        headers: expect.objectContaining({
          source: "consumer",
          deadLetterReason: "invalid_schema",
          deadLetterError: "Missing postingId",
        }),
      }),
    );
  });

  it("dead-letters malformed consumer payloads instead of requeueing them", async () => {
    const { channel, getConsumeHandler } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new RecommendationActivityQueueService();

    await service.consumeActivityEvents(5, async () => undefined);

    const handler = getConsumeHandler();
    expect(handler).toBeDefined();

    const message = {
      content: Buffer.from("{invalid-json", "utf8"),
      properties: {
        messageId: "msg-1",
        contentType: "application/json",
        headers: {
          source: "consumer",
        },
      },
    };

    await handler!(message);

    expect(channel.publish).toHaveBeenCalledWith(
      "recommendation-activity.exchange",
      "dead-letter",
      message.content,
      expect.objectContaining({
        messageId: "msg-1",
        headers: expect.objectContaining({
          source: "consumer",
          deadLetterReason: "invalid_json",
        }),
      }),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it("passes valid consumer payloads through to the worker and returns a cleanup callback", async () => {
    const { channel, getConsumeHandler } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const onMessage = jest.fn(async () => undefined);
    const service = new RecommendationActivityQueueService();

    const stop = await service.consumeActivityEvents(7, onMessage);

    expect(channel.prefetch).toHaveBeenCalledWith(7);

    await getConsumeHandler?.()?.({
      content: Buffer.from(JSON.stringify(createEventPayload()), "utf8"),
      properties: {
        messageId: "msg-2",
        headers: {},
      },
    });

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-1",
        postingId: "posting-1",
      }),
      expect.objectContaining({
        properties: expect.objectContaining({
          messageId: "msg-2",
        }),
      }),
      channel,
    );

    await stop();

    expect(channel.cancel).toHaveBeenCalledWith("consumer-1");
    expect(channel.close).toHaveBeenCalled();
  });

  it("requeues messages when the worker throws before ack handling", async () => {
    const { channel, getConsumeHandler } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new RecommendationActivityQueueService();

    await service.consumeActivityEvents(1, async () => {
      throw new Error("processor failed");
    });

    const message = {
      content: Buffer.from(JSON.stringify(createEventPayload()), "utf8"),
      properties: {
        messageId: "msg-3",
        headers: {},
      },
    };

    await getConsumeHandler?.()?.(message);

    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
