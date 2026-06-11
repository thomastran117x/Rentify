import type { Channel, ConsumeMessage } from "amqplib";
import { PostingThumbnailQueueService } from "@/features/postings/thumbnail/thumbnail.queue.service";

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

describe("PostingThumbnailQueueService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-05-20T15:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("publishes a new thumbnail job to the main queue with asserted topology", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new PostingThumbnailQueueService();

    await service.enqueuePostingThumbnailJob("posting-1");

    expect(channel.assertExchange).toHaveBeenCalledWith(
      "postings.thumbnail.exchange",
      "direct",
      {
        durable: true,
      },
    );
    expect(channel.assertQueue).toHaveBeenCalledWith(
      "postings.thumbnail.main",
      {
        durable: true,
      },
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      "postings.thumbnail.main",
      "postings.thumbnail.exchange",
      "main",
    );
    expect(channel.publish).toHaveBeenCalledWith(
      "postings.thumbnail.exchange",
      "main",
      expect.any(Buffer),
      expect.objectContaining({
        contentType: "application/json",
        persistent: true,
      }),
    );
    const publishedPayload = JSON.parse(
      (channel.publish as jest.Mock).mock.calls[0]?.[2].toString("utf8"),
    ) as {
      jobId: string;
      postingId: string;
      attempt: number;
      occurredAt: string;
    };
    const publishOptions = (channel.publish as jest.Mock).mock
      .calls[0]?.[3] as {
      messageId: string;
    };

    expect(publishedPayload).toEqual({
      jobId: expect.any(String),
      postingId: "posting-1",
      attempt: 0,
      occurredAt: "2026-05-20T15:00:00.000Z",
    });
    expect(publishOptions.messageId).toBe(publishedPayload.jobId);
  });

  it("publishes retry and dead-letter jobs to the correct routing keys", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new PostingThumbnailQueueService();
    const payload = {
      jobId: "job-1",
      postingId: "posting-1",
      attempt: 0,
      occurredAt: "2026-05-20T15:00:00.000Z",
    };

    await service.publishRetryJob(payload, 2);
    await service.publishDeadLetterJob(payload);

    expect(channel.publish).toHaveBeenNthCalledWith(
      1,
      "postings.thumbnail.exchange",
      "retry.2",
      expect.any(Buffer),
      expect.any(Object),
    );
    expect(channel.publish).toHaveBeenNthCalledWith(
      2,
      "postings.thumbnail.exchange",
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
      attempt: 2,
    });
  });

  it("consumes thumbnail jobs and returns a cleanup handler", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const onMessage = jest.fn(async () => undefined);
    const service = new PostingThumbnailQueueService();

    const stop = await service.consumePostingThumbnailJobs(5, onMessage);

    expect(channel.prefetch).toHaveBeenCalledWith(5);
    await createChannel.lastHandler?.({
      content: Buffer.from(
        JSON.stringify({
          jobId: "job-1",
          postingId: "posting-1",
          attempt: 0,
          occurredAt: "2026-05-20T15:00:00.000Z",
        }),
        "utf8",
      ),
    } as ConsumeMessage);

    expect(onMessage).toHaveBeenCalledWith(
      {
        jobId: "job-1",
        postingId: "posting-1",
        attempt: 0,
        occurredAt: "2026-05-20T15:00:00.000Z",
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
    const service = new PostingThumbnailQueueService();

    await service.consumePostingThumbnailJobs(1, onMessage);
    await createChannel.lastHandler?.(null);

    expect(onMessage).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it("nacks malformed jobs before custom handler ack logic runs", async () => {
    const channel = createChannel();
    mockCreateRabbitMqChannel.mockResolvedValue(channel);
    const service = new PostingThumbnailQueueService();

    await service.consumePostingThumbnailJobs(
      1,
      jest.fn(async () => undefined),
    );
    const message = {
      content: Buffer.from("{bad json", "utf8"),
    } as ConsumeMessage;

    await createChannel.lastHandler?.(message);

    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
  });
});
