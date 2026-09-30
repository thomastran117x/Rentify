import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import type { MediaRejectionCode } from "@/features/media/media.model";

/**
 * Where a rejection was decided: when the upload was completed, while it was
 * processed, after its job was dead-lettered, or by the media cleanup once the
 * item had stayed stuck past its last re-queue.
 */
export type MediaRejectionStage =
  | "completion"
  | "processing"
  | "dead_letter"
  | "cleanup";

/**
 * How one claimed processing attempt ended. `discarded` covers an item that
 * was deleted or rejected while it ran, and a duplicate job for one already
 * ready; `failed` is an attempt that threw and is retried or dead-lettered.
 */
export type MediaProcessingOutcome =
  | "ready"
  | "rejected"
  | "discarded"
  | "failed";

/**
 * The tags each metric carries. Tags are for aggregation, so none of these
 * holds a user id, media id, or filename: those would give every upload its
 * own series and put personal data in the metrics store. Ids stay in the log
 * context instead.
 */
export interface MediaCounterTags {
  "media.upload.created": { scope: string; declaredType: string };
  "media.upload.completed": { scope: string };
  "media.processing.success": { scope: string };
  "media.processing.failure": { attempt: number; retrying: boolean };
  "media.rejected": { code: MediaRejectionCode; stage: MediaRejectionStage };
  "media.dlq.published": Record<string, never>;
}

export interface MediaObservationTags {
  "media.bytes.original": { scope: string };
  "media.bytes.processed": { scope: string };
  /** Milliseconds from claiming the item to the attempt's end. */
  "media.processing.duration": {
    scope: string;
    outcome: MediaProcessingOutcome;
  };
}

export type MediaCounterName = keyof MediaCounterTags;
export type MediaObservationName = keyof MediaObservationTags;
export type MediaMetricName = MediaCounterName | MediaObservationName;

/**
 * Counts and measures the media pipeline. Calls never throw and never wait on
 * the metrics backend, so recording one can neither fail nor slow a request or
 * a processing job. The container wraps every adapter in
 * BestEffortMediaMetrics, so an adapter that does throw is contained too.
 */
export interface MediaMetrics {
  increment<Name extends MediaCounterName>(
    name: Name,
    tags: MediaCounterTags[Name],
  ): void;
  observe<Name extends MediaObservationName>(
    name: Name,
    value: number,
    tags: MediaObservationTags[Name],
  ): void;
}

/** Records nothing. For tests that do not assert on metrics. */
export class NoopMediaMetrics implements MediaMetrics {
  increment(): void {}

  observe(): void {}
}

/**
 * Emits each metric as one structured `media.metric` log event, which reaches
 * `log-consumer-worker` through the application log queue like any other log.
 * A counter's value is 1. It needs no infrastructure of its own; a metrics
 * backend is added as another adapter, with no change to where metrics are
 * recorded.
 */
export class LogMediaMetrics implements MediaMetrics {
  constructor(
    private readonly logger: Pick<Logger, "info"> = loggerFactory.forComponent(
      "media-metrics",
      "service",
    ),
  ) {}

  increment<Name extends MediaCounterName>(
    name: Name,
    tags: MediaCounterTags[Name],
  ): void {
    this.emit(name, 1, tags);
  }

  observe<Name extends MediaObservationName>(
    name: Name,
    value: number,
    tags: MediaObservationTags[Name],
  ): void {
    this.emit(name, value, tags);
  }

  private emit(
    metric: MediaMetricName,
    value: number,
    tags: Record<string, string | number | boolean>,
  ): void {
    this.logger.info("media.metric", { metric, value, tags });
  }
}

/**
 * Makes any adapter safe to call from a request or job: a failure to record a
 * metric is dropped rather than thrown into the code being measured.
 */
export class BestEffortMediaMetrics implements MediaMetrics {
  constructor(private readonly inner: MediaMetrics) {}

  increment<Name extends MediaCounterName>(
    name: Name,
    tags: MediaCounterTags[Name],
  ): void {
    try {
      this.inner.increment(name, tags);
    } catch {
      // Dropped: a lost data point is better than a failed request.
    }
  }

  observe<Name extends MediaObservationName>(
    name: Name,
    value: number,
    tags: MediaObservationTags[Name],
  ): void {
    try {
      this.inner.observe(name, value, tags);
    } catch {
      // Dropped: a lost data point is better than a failed request.
    }
  }
}
