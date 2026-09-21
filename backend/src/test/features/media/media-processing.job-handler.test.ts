import type { Channel, ConsumeMessage } from "amqplib";
import type { MediaProcessingJobPayload } from "@/features/media/media.model";
import { createMediaProcessingJobHandler } from "@/features/media/media-processing.job-handler";
import { testUuid } from "../../support/uuid";

const MEDIA_ID = testUuid(9000, 994380);
const MAX_ATTEMPTS = 3;

function payload(attempt: number): MediaProcessingJobPayload {
  return {
    jobId: "job-1",
    mediaId: MEDIA_ID,
    attempt,
    occurredAt: "2026-09-21T00:00:00.000Z",
  };
}

function createHarness(options: {
  process?: () => Promise<void>;
  markProcessingFailed?: () => Promise<void>;
  publishDeadLetterJob?: () => Promise<void>;
}) {
  const queue = {
    publishRetryJob: jest.fn(
      async (_payload: MediaProcessingJobPayload, _attempt: number) =>
        undefined,
    ),
    publishDeadLetterJob: jest.fn(
      async (_payload: MediaProcessingJobPayload): Promise<void> =>
        options.publishDeadLetterJob?.(),
    ),
  };
  const processing = {
    process: jest.fn(options.process ?? (async () => undefined)),
    markProcessingFailed: jest.fn(
      options.markProcessingFailed ?? (async () => undefined),
    ),
  };
  const logger = { error: jest.fn() };
  const channel = { ack: jest.fn() } as unknown as Channel & {
    ack: jest.Mock;
  };
  const message = {} as ConsumeMessage;
  const handle = createMediaProcessingJobHandler({
    queue,
    processing,
    maxAttempts: MAX_ATTEMPTS,
    logger,
  });

  return { queue, processing, logger, channel, message, handle };
}

const failing = async () => {
  throw new Error("database unavailable");
};

describe("createMediaProcessingJobHandler", () => {
  it("acks a processed job", async () => {
    const { handle, channel, message, queue } = createHarness({});

    await handle(payload(0), message, channel);

    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(queue.publishRetryJob).not.toHaveBeenCalled();
    expect(queue.publishDeadLetterJob).not.toHaveBeenCalled();
  });

  it("sends a failed job through the retry queues until its last attempt", async () => {
    const { handle, channel, message, queue, processing } = createHarness({
      process: failing,
    });

    await handle(payload(0), message, channel);

    expect(queue.publishRetryJob).toHaveBeenCalledWith(payload(0), 1);
    expect(queue.publishDeadLetterJob).not.toHaveBeenCalled();
    expect(processing.markProcessingFailed).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it("dead-letters the last attempt and rejects the item", async () => {
    const { handle, channel, message, queue, processing } = createHarness({
      process: failing,
    });

    await handle(payload(MAX_ATTEMPTS - 1), message, channel);

    expect(queue.publishDeadLetterJob).toHaveBeenCalledWith(
      payload(MAX_ATTEMPTS),
    );
    expect(processing.markProcessingFailed).toHaveBeenCalledWith(MEDIA_ID);
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it("still acks, with one dead-letter copy, when rejecting the item fails", async () => {
    const { handle, channel, message, queue, logger } = createHarness({
      process: failing,
      markProcessingFailed: failing,
    });

    await expect(
      handle(payload(MAX_ATTEMPTS - 1), message, channel),
    ).resolves.toBeUndefined();

    expect(queue.publishDeadLetterJob).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to mark a dead-lettered media item as rejected.",
      { jobId: "job-1", mediaId: MEDIA_ID },
      expect.any(Error),
    );
  });

  it("leaves the job unacked when it cannot be published onward", async () => {
    const { handle, channel, message, processing } = createHarness({
      process: failing,
      publishDeadLetterJob: async () => {
        throw new Error("broker unavailable");
      },
    });

    // Acking would lose the job; the consumer requeues it instead.
    await expect(
      handle(payload(MAX_ATTEMPTS - 1), message, channel),
    ).rejects.toThrow("broker unavailable");
    expect(channel.ack).not.toHaveBeenCalled();
    expect(processing.markProcessingFailed).not.toHaveBeenCalled();
  });
});
