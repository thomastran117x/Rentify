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
      expect(onBatch.mock.calls[0]?.[0]).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
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
      .mockImplementationOnce(async (entries) => {
        startedBatches.push(entries.map((entry) => entry.payload.outboxId));
        await releaseFirstBatch.promise;
      })
      .mockImplementationOnce(async (entries) => {
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
