import type { Channel, ConsumeMessage } from "amqplib";
import type { MediaProcessingJobPayload } from "@/features/media/media.model";
import {
  BestEffortMediaMetrics,
  type MediaMetrics,
} from "@/features/media/media-metrics";
import { createMediaProcessingJobHandler } from "@/features/media/media-processing.job-handler";
import {
  RecordingMediaMetrics,
  ThrowingMediaMetrics,
} from "../../support/recording-media-metrics";
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
  recordProcessingFailure?: () => Promise<void>;
  markProcessingFailed?: () => Promise<void>;
  publishDeadLetterJob?: () => Promise<void>;
  metrics?: MediaMetrics;
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
    recordProcessingFailure: jest.fn(
      async (_mediaId: string, _error: unknown): Promise<void> =>
        options.recordProcessingFailure?.(),
    ),
    markProcessingFailed: jest.fn(
      options.markProcessingFailed ?? (async () => undefined),
    ),
  };
  const logger = { error: jest.fn() };
  const channel = { ack: jest.fn() } as unknown as Channel & {
    ack: jest.Mock;
  };
  const message = {} as ConsumeMessage;
  const metrics = new RecordingMediaMetrics();
  const handle = createMediaProcessingJobHandler({
    queue,
    processing,
    maxAttempts: MAX_ATTEMPTS,
    logger,
    metrics: options.metrics ?? metrics,
  });

  return { queue, processing, logger, metrics, channel, message, handle };
}

const failing = async () => {
  throw new Error("database unavailable");
};

describe("createMediaProcessingJobHandler", () => {
  it("acks a processed job", async () => {
    const { handle, channel, message, queue, metrics } = createHarness({});

    await handle(payload(0), message, channel);

    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(queue.publishRetryJob).not.toHaveBeenCalled();
    expect(queue.publishDeadLetterJob).not.toHaveBeenCalled();
    expect(metrics.recorded).toEqual([]);
  });

  it("sends a failed job through the retry queues until its last attempt", async () => {
    const { handle, channel, message, queue, processing, metrics } =
      createHarness({
        process: failing,
      });

    await handle(payload(0), message, channel);

    expect(queue.publishRetryJob).toHaveBeenCalledWith(payload(0), 1);
    expect(queue.publishDeadLetterJob).not.toHaveBeenCalled();
    expect(processing.markProcessingFailed).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(metrics.tagsOf("media.processing.failure")).toEqual([
      { attempt: 1, retrying: true },
    ]);
    expect(metrics.count("media.dlq.published")).toBe(0);
    metrics.assertNoIdentifiers();
  });

  it("retries and dead-letters even when every metric call fails", async () => {
    const { handle, channel, message, queue } = createHarness({
      process: failing,
      metrics: new BestEffortMediaMetrics(new ThrowingMediaMetrics()),
    });

    await handle(payload(0), message, channel);
    await handle(payload(MAX_ATTEMPTS - 1), message, channel);

    expect(queue.publishRetryJob).toHaveBeenCalledTimes(1);
    expect(queue.publishDeadLetterJob).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(2);
  });

  it("records the failure before the job is retried", async () => {
    const { handle, channel, message, queue, processing } = createHarness({
      process: failing,
    });

    await handle(payload(0), message, channel);

    expect(processing.recordProcessingFailure).toHaveBeenCalledWith(
      MEDIA_ID,
      expect.objectContaining({ message: "database unavailable" }),
    );
    expect(
      processing.recordProcessingFailure.mock.invocationCallOrder[0],
    ).toBeLessThan(queue.publishRetryJob.mock.invocationCallOrder[0]!);
  });

  it("still retries and dead-letters when the failure cannot be recorded", async () => {
    const { handle, channel, message, queue, processing, logger } =
      createHarness({
        process: failing,
        recordProcessingFailure: async () => {
          throw new Error("record failed");
        },
      });

    await handle(payload(0), message, channel);
    await handle(payload(MAX_ATTEMPTS - 1), message, channel);

    expect(queue.publishRetryJob).toHaveBeenCalledWith(payload(0), 1);
    expect(queue.publishDeadLetterJob).toHaveBeenCalledWith(
      payload(MAX_ATTEMPTS),
    );
    expect(processing.markProcessingFailed).toHaveBeenCalledWith(MEDIA_ID);
    expect(channel.ack).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to record a media processing failure.",
      { jobId: "job-1", mediaId: MEDIA_ID, attempt: 1 },
      expect.objectContaining({ message: "record failed" }),
    );
  });

  it("dead-letters the last attempt and rejects the item", async () => {
    const { handle, channel, message, queue, processing, metrics } =
      createHarness({
        process: failing,
      });

    await handle(payload(MAX_ATTEMPTS - 1), message, channel);

    expect(queue.publishDeadLetterJob).toHaveBeenCalledWith(
      payload(MAX_ATTEMPTS),
    );
    expect(processing.markProcessingFailed).toHaveBeenCalledWith(MEDIA_ID);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(metrics.tagsOf("media.processing.failure")).toEqual([
      { attempt: MAX_ATTEMPTS, retrying: false },
    ]);
    expect(metrics.tagsOf("media.dlq.published")).toEqual([{}]);
    metrics.assertNoIdentifiers();
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
    const { handle, channel, message, processing, metrics } = createHarness({
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
    // Counted only once the job is in the dead-letter queue; the requeued
    // redelivery counts the failure, so it is not counted twice.
    expect(metrics.count("media.dlq.published")).toBe(0);
    expect(metrics.count("media.processing.failure")).toBe(0);
  });

  it("does not count a failure whose retry could not be published", async () => {
    const { handle, channel, message, queue, metrics } = createHarness({
      process: failing,
    });
    queue.publishRetryJob.mockRejectedValueOnce(
      new Error("broker unavailable"),
    );

    await expect(handle(payload(0), message, channel)).rejects.toThrow(
      "broker unavailable",
    );
    expect(channel.ack).not.toHaveBeenCalled();
    expect(metrics.count("media.processing.failure")).toBe(0);

    // The requeued message is redelivered with the same attempt and counted
    // once, when it is handed on.
    await handle(payload(0), message, channel);
    expect(metrics.tagsOf("media.processing.failure")).toEqual([
      { attempt: 1, retrying: true },
    ]);
  });
});
