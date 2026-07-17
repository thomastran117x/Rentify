import { SearchQueueService } from "@/features/search/search.queue.service";

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
  const eventHandlers = new Map<string, () => void>();

  return {
    channel: {
      assertExchange: jest.fn(async () => undefined),
      assertQueue: jest.fn(async () => undefined),
      checkQueue: jest.fn(async () => ({
        messageCount: 0,
        consumerCount: 0,
      })),
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

function createJobMessage(
  outboxId: string,
  operation: "upsert" | "delete" = "upsert",
) {
  return {
    content: Buffer.from(
      JSON.stringify({
        outboxId,
        eventId: outboxId,
        dedupeKey: outboxId,
        operation,
        jobType: operation,
        postingId: `posting-${outboxId}`,
        targetIndexScope: "live",
        occurredAt: "2026-04-27T00:00:00.000Z",
        attempt: 0,
      }),
      "utf8",
    ),
    properties: {},
  };
}

describe("SearchQueueService", () => {
  beforeEach(() => {
    mockCreateRabbitMqChannel.mockReset();
  });

  it("closes the topology channel even when topology assertion fails", async () => {
    const { channel } = createMockChannel();
    channel.assertExchange = jest.fn(async () => {
      throw new Error("topology failed");
    });
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");

    await expect(service.ensureTopology()).rejects.toThrow("topology failed");

    expect(channel.close).toHaveBeenCalled();
  });

  it("dead-letters malformed consumer payloads instead of requeueing them", async () => {
    const { channel, getConsumeHandler } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");

    await service.consumeIndexJobs(5, async () => undefined);

    const handler = getConsumeHandler();
    expect(handler).toBeDefined();

    const message = {
      content: Buffer.from("{invalid-json", "utf8"),
      properties: {
        messageId: "msg-1",
        contentType: "application/json",
        headers: {},
      },
    };

    await handler!(message);

    expect(channel.publish).toHaveBeenCalledWith(
      "postings.search-index.exchange",
      "dead-letter",
      message.content,
      expect.objectContaining({
        messageId: "msg-1",
        headers: expect.objectContaining({
          deadLetterReason: "invalid_json",
        }),
      }),
    );
    expect(channel.waitForConfirms).toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it("ignores null deliveries and closes the consumer channel on stop", async () => {
    const { channel, getConsumeHandler } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");

    const stop = await service.consumeIndexJobs(5, async () => undefined);
    const handler = getConsumeHandler();

    await handler!(null);
    await stop();

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
    expect(channel.cancel).toHaveBeenCalledWith("consumer-1");
    expect(channel.close).toHaveBeenCalled();
  });

  it("reuses the publisher channel across multiple publishes", async () => {
    const { channel } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");

    await service.publishIndexJob({
      outboxId: "outbox-1",
      eventId: "outbox-1",
      dedupeKey: "outbox-1",
      operation: "upsert",
      jobType: "upsert",
      postingId: "posting-1",
      targetIndexScope: "live",
      occurredAt: "2026-04-27T00:00:00.000Z",
      attempt: 0,
    });
    await service.publishIndexJob({
      outboxId: "outbox-2",
      eventId: "outbox-2",
      dedupeKey: "outbox-2",
      operation: "delete",
      jobType: "delete",
      postingId: "posting-1",
      targetIndexScope: "live",
      occurredAt: "2026-04-27T00:00:01.000Z",
      attempt: 0,
    });

    expect(mockCreateRabbitMqChannel).toHaveBeenCalledTimes(1);
    expect(channel.publish).toHaveBeenCalledTimes(2);
  });

  it("routes retry and dead-letter publishes to their expected routing keys", async () => {
    const { channel } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");

    await service.publishRetryJob(
      {
        outboxId: "outbox-1",
        eventId: "outbox-1",
        dedupeKey: "outbox-1",
        operation: "upsert",
        jobType: "upsert",
        postingId: "posting-1",
        targetIndexScope: "live",
        occurredAt: "2026-04-27T00:00:00.000Z",
        attempt: 1,
      },
      5,
    );
    await service.publishDeadLetterJob({
      outboxId: "outbox-2",
      eventId: "outbox-2",
      dedupeKey: "outbox-2",
      operation: "delete",
      jobType: "delete",
      postingId: "posting-2",
      targetIndexScope: "live",
      occurredAt: "2026-04-27T00:00:01.000Z",
      attempt: 3,
    });

    expect(channel.publish).toHaveBeenNthCalledWith(
      1,
      "postings.search-index.exchange",
      "retry.3",
      expect.any(Buffer),
      expect.objectContaining({
        messageId: "outbox-1",
      }),
    );
    expect(channel.publish).toHaveBeenNthCalledWith(
      2,
      "postings.search-index.exchange",
      "dead-letter",
      expect.any(Buffer),
      expect.objectContaining({
        messageId: "outbox-2",
      }),
    );
  });

  it("recreates the publisher channel after a confirm failure", async () => {
    const first = createMockChannel();
    const second = createMockChannel();
    first.channel.waitForConfirms = jest.fn(async () => {
      throw new Error("confirm failed");
    });
    mockCreateRabbitMqChannel
      .mockResolvedValueOnce(first.channel)
      .mockResolvedValueOnce(second.channel);
    const service = new SearchQueueService("postings");

    await expect(
      service.publishIndexJob({
        outboxId: "outbox-1",
        eventId: "outbox-1",
        dedupeKey: "outbox-1",
        operation: "upsert",
        jobType: "upsert",
        postingId: "posting-1",
        targetIndexScope: "live",
        occurredAt: "2026-04-27T00:00:00.000Z",
        attempt: 0,
      }),
    ).rejects.toThrow("confirm failed");

    await service.publishIndexJob({
      outboxId: "outbox-2",
      eventId: "outbox-2",
      dedupeKey: "outbox-2",
      operation: "upsert",
      jobType: "upsert",
      postingId: "posting-2",
      targetIndexScope: "live",
      occurredAt: "2026-04-27T00:00:01.000Z",
      attempt: 0,
    });

    expect(mockCreateRabbitMqChannel).toHaveBeenCalledTimes(2);
  });

  it("recreates the publisher channel after close and error events", async () => {
    const first = createMockChannel();
    const second = createMockChannel();
    const third = createMockChannel();
    mockCreateRabbitMqChannel
      .mockResolvedValueOnce(first.channel)
      .mockResolvedValueOnce(second.channel)
      .mockResolvedValueOnce(third.channel);
    const service = new SearchQueueService("postings");

    await service.publishIndexJob({
      outboxId: "outbox-1",
      eventId: "outbox-1",
      dedupeKey: "outbox-1",
      operation: "upsert",
      jobType: "upsert",
      postingId: "posting-1",
      targetIndexScope: "live",
      occurredAt: "2026-04-27T00:00:00.000Z",
      attempt: 0,
    });
    first.getEventHandler("close")?.();

    await service.publishIndexJob({
      outboxId: "outbox-2",
      eventId: "outbox-2",
      dedupeKey: "outbox-2",
      operation: "upsert",
      jobType: "upsert",
      postingId: "posting-2",
      targetIndexScope: "live",
      occurredAt: "2026-04-27T00:00:01.000Z",
      attempt: 0,
    });
    second.getEventHandler("error")?.();

    await service.publishIndexJob({
      outboxId: "outbox-3",
      eventId: "outbox-3",
      dedupeKey: "outbox-3",
      operation: "delete",
      jobType: "delete",
      postingId: "posting-3",
      targetIndexScope: "live",
      occurredAt: "2026-04-27T00:00:02.000Z",
      attempt: 0,
    });

    expect(mockCreateRabbitMqChannel).toHaveBeenCalledTimes(3);
  });

  it("retries publisher topology setup after a topology failure", async () => {
    const first = createMockChannel();
    const second = createMockChannel();
    first.channel.assertExchange = jest.fn(async () => {
      throw new Error("assert exchange failed");
    });
    mockCreateRabbitMqChannel
      .mockResolvedValueOnce(first.channel)
      .mockResolvedValueOnce(second.channel);
    const service = new SearchQueueService("postings");

    await expect(
      service.publishIndexJob({
        outboxId: "outbox-1",
        eventId: "outbox-1",
        dedupeKey: "outbox-1",
        operation: "upsert",
        jobType: "upsert",
        postingId: "posting-1",
        targetIndexScope: "live",
        occurredAt: "2026-04-27T00:00:00.000Z",
        attempt: 0,
      }),
    ).rejects.toThrow("assert exchange failed");

    await service.publishIndexJob({
      outboxId: "outbox-2",
      eventId: "outbox-2",
      dedupeKey: "outbox-2",
      operation: "delete",
      jobType: "delete",
      postingId: "posting-2",
      targetIndexScope: "live",
      occurredAt: "2026-04-27T00:00:01.000Z",
      attempt: 0,
    });

    expect(mockCreateRabbitMqChannel).toHaveBeenCalledTimes(2);
  });

  it("buffers valid messages into batches before handing them to the worker", async () => {
    jest.useFakeTimers();
    const { channel, getConsumeHandler } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");
    const onBatch = jest.fn(async () => undefined);

    try {
      await service.consumeIndexJobBatches(5, 2, 50, 1, onBatch);

      const handler = getConsumeHandler();
      expect(handler).toBeDefined();

      await handler!(createJobMessage("outbox-1"));
      await handler!(createJobMessage("outbox-2", "delete"));

      await Promise.resolve();

      expect(onBatch).toHaveBeenCalledTimes(1);
      expect((onBatch.mock.calls[0] as any)?.[0]).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("nacks a message when the single-message worker throws", async () => {
    const { channel, getConsumeHandler } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");

    await service.consumeIndexJobs(5, async () => {
      throw new Error("worker failed");
    });

    const handler = getConsumeHandler();
    const message = createJobMessage("outbox-1");

    await handler!(message);

    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it("maps queue counts for each search queue", async () => {
    const { channel } = createMockChannel();
    channel.checkQueue = jest
      .fn()
      .mockResolvedValueOnce({ messageCount: 1, consumerCount: 2 })
      .mockResolvedValueOnce({ messageCount: 3, consumerCount: 4 })
      .mockResolvedValueOnce({ messageCount: 5, consumerCount: 6 })
      .mockResolvedValueOnce({ messageCount: 7, consumerCount: 8 })
      .mockResolvedValueOnce({ messageCount: 9, consumerCount: 10 });
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");

    const result = await service.getQueueCounts();

    expect(result).toEqual({
      main: { ready: 1, consumers: 2 },
      retry1: { ready: 3, consumers: 4 },
      retry2: { ready: 5, consumers: 6 },
      retry3: { ready: 7, consumers: 8 },
      deadLetter: { ready: 9, consumers: 10 },
    });
    expect(channel.close).toHaveBeenCalled();
  });

  it("can keep multiple batches in flight when concurrency is enabled", async () => {
    jest.useFakeTimers();
    const { channel, getConsumeHandler } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");
    const releaseFirstBatch = createDeferred<void>();
    const releaseSecondBatch = createDeferred<void>();
    const startedBatches: string[][] = [];
    const onBatch = jest
      .fn()
      .mockImplementationOnce(async (entries: any[]) => {
        startedBatches.push(entries.map((entry) => entry.payload.outboxId));
        await releaseFirstBatch.promise;
      })
      .mockImplementationOnce(async (entries: any[]) => {
        startedBatches.push(entries.map((entry) => entry.payload.outboxId));
        await releaseSecondBatch.promise;
      });

    try {
      const stop = await service.consumeIndexJobBatches(10, 2, 50, 2, onBatch);

      const handler = getConsumeHandler();
      expect(handler).toBeDefined();

      await handler!(createJobMessage("outbox-1"));
      await handler!(createJobMessage("outbox-2"));
      await handler!(createJobMessage("outbox-3"));
      await handler!(createJobMessage("outbox-4"));

      await Promise.resolve();
      await Promise.resolve();

      expect(onBatch).toHaveBeenCalledTimes(2);
      expect(startedBatches).toEqual([
        ["outbox-1", "outbox-2"],
        ["outbox-3", "outbox-4"],
      ]);

      releaseFirstBatch.resolve();
      releaseSecondBatch.resolve();
      await stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it("flushes a partial batch during shutdown", async () => {
    jest.useFakeTimers();
    const { channel, getConsumeHandler } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");
    const onBatch = jest.fn(async () => undefined);

    try {
      const stop = await service.consumeIndexJobBatches(5, 2, 50, 1, onBatch);
      const handler = getConsumeHandler();

      await handler!(createJobMessage("outbox-1"));
      await stop();

      expect(onBatch).toHaveBeenCalledTimes(1);
      expect((onBatch.mock.calls[0] as any)?.[0]).toHaveLength(1);
      expect(channel.cancel).toHaveBeenCalledWith("consumer-1");
      expect(channel.close).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("nacks every batch entry when the batch worker throws", async () => {
    jest.useFakeTimers();
    const { channel, getConsumeHandler } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");

    try {
      await service.consumeIndexJobBatches(5, 2, 50, 1, async () => {
        throw new Error("batch failed");
      });

      const handler = getConsumeHandler();
      const first = createJobMessage("outbox-1");
      const second = createJobMessage("outbox-2");

      await handler!(first);
      await handler!(second);
      await Promise.resolve();
      await Promise.resolve();

      expect(channel.nack).toHaveBeenCalledWith(first, false, true);
      expect(channel.nack).toHaveBeenCalledWith(second, false, true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("ignores null batch deliveries", async () => {
    const { channel, getConsumeHandler } = createMockChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new SearchQueueService("postings");

    await service.consumeIndexJobBatches(5, 2, 50, 1, async () => undefined);
    const handler = getConsumeHandler();

    await handler!(null);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return {
    promise,
    resolve,
  };
}
