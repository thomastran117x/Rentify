import {
  BestEffortMediaMetrics,
  LogMediaMetrics,
  NoopMediaMetrics,
} from "@/features/media/media-metrics";
import {
  RecordingMediaMetrics,
  ThrowingMediaMetrics,
} from "../../support/recording-media-metrics";

describe("LogMediaMetrics", () => {
  it("logs a counter as one media.metric event with value 1", () => {
    const logger = { info: jest.fn() };

    new LogMediaMetrics(logger).increment("media.upload.created", {
      scope: "postings",
      declaredType: "image/png",
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("media.metric", {
      metric: "media.upload.created",
      value: 1,
      tags: { scope: "postings", declaredType: "image/png" },
    });
  });

  it("logs an observation with its value", () => {
    const logger = { info: jest.fn() };

    new LogMediaMetrics(logger).observe("media.processing.duration", 1250, {
      scope: "avatars",
      outcome: "ready",
    });

    expect(logger.info).toHaveBeenCalledWith("media.metric", {
      metric: "media.processing.duration",
      value: 1250,
      tags: { scope: "avatars", outcome: "ready" },
    });
  });

  it("uses the application logger by default", () => {
    expect(() =>
      new LogMediaMetrics().increment("media.dlq.published", {}),
    ).not.toThrow();
  });
});

describe("BestEffortMediaMetrics", () => {
  it("passes calls through to the adapter it wraps", () => {
    const inner = new RecordingMediaMetrics();
    const metrics = new BestEffortMediaMetrics(inner);

    metrics.increment("media.rejected", {
      code: "corrupt",
      stage: "processing",
    });
    metrics.observe("media.bytes.original", 2048, { scope: "postings" });

    expect(inner.recorded).toEqual([
      {
        kind: "increment",
        name: "media.rejected",
        value: 1,
        tags: { code: "corrupt", stage: "processing" },
      },
      {
        kind: "observe",
        name: "media.bytes.original",
        value: 2048,
        tags: { scope: "postings" },
      },
    ]);
  });

  it("drops a failure from the adapter instead of throwing it", () => {
    const metrics = new BestEffortMediaMetrics(new ThrowingMediaMetrics());

    expect(() =>
      metrics.increment("media.upload.completed", { scope: "postings" }),
    ).not.toThrow();
    expect(() =>
      metrics.observe("media.bytes.processed", 10, { scope: "postings" }),
    ).not.toThrow();
  });
});

describe("NoopMediaMetrics", () => {
  it("records nothing and never throws", () => {
    const metrics = new NoopMediaMetrics();

    expect(() => {
      metrics.increment();
      metrics.observe();
    }).not.toThrow();
  });
});
