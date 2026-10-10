import type { SupportedImageContentType } from "@/configuration/environment/constants";
import { loggerFactory } from "@/configuration/logging";
import type { Logger, LogLevel } from "@/configuration/logging/types";
import {
  MEDIA_SCOPES,
  type MediaRejectionCode,
  type MediaScope,
} from "@/features/media/media.model";

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
 * Why the media cleanup deleted an item it did not reject: a ready image that
 * nothing attached within its TTL.
 */
export type MediaCleanupDeletionReason = "unattached";

/**
 * A scope as a metric tag: one of the known scopes, or `unknown` when it cannot
 * be told, such as for a row deleted before it was read.
 */
export type MediaMetricScope = MediaScope | "unknown";

/**
 * Narrows a row's stored scope, which the database holds as free text, to a
 * tag value. Anything that is not a known scope becomes `unknown`, so a bad
 * row can never add a series.
 */
export function mediaMetricScope(scope: string): MediaMetricScope {
  return (MEDIA_SCOPES as readonly string[]).includes(scope)
    ? (scope as MediaScope)
    : "unknown";
}

/**
 * The tags each metric carries. Tags are for aggregation, so every one is
 * typed as a closed set of values, and none holds a user id, media id, or
 * filename: those would give every upload its own series and put personal
 * data in the metrics store. Ids stay in the log context instead.
 */
export interface MediaCounterTags {
  "media.upload.created": {
    scope: MediaMetricScope;
    declaredType: SupportedImageContentType;
  };
  "media.upload.completed": { scope: MediaMetricScope };
  "media.processing.success": { scope: MediaMetricScope };
  "media.processing.failure": { attempt: number; retrying: boolean };
  "media.rejected": { code: MediaRejectionCode; stage: MediaRejectionStage };
  "media.dlq.published": Record<string, never>;
  "media.cleanup.deleted": { reason: MediaCleanupDeletionReason };
}

export interface MediaObservationTags {
  "media.bytes.original": { scope: MediaMetricScope };
  "media.bytes.processed": { scope: MediaMetricScope };
  /** Milliseconds from claiming the item to the attempt's end. */
  "media.processing.duration": {
    scope: MediaMetricScope;
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
 * Emits each metric as one structured `media.metric` log event at `info`,
 * which goes wherever the application's logs go. A counter's value is 1. It
 * needs no infrastructure of its own; a metrics backend is added as another
 * adapter, with no change to where metrics are recorded.
 *
 * Being logs, the events obey the log level: above `info`, every one is
 * dropped. warnIfLogMetricsSuppressed says so at startup.
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
 * Warns once when the log level drops every LogMediaMetrics event, so turning
 * down log volume does not silently turn off the media metrics and the alerts
 * built on them. Returns whether the metrics are suppressed. The warning
 * itself is only seen at `warn`; at `error` or above it is dropped too, as is
 * any other warning.
 */
export function warnIfLogMetricsSuppressed(
  level: LogLevel,
  logger: Pick<Logger, "warn"> = loggerFactory.forComponent(
    "media-metrics",
    "service",
  ),
): boolean {
  if (level === "debug" || level === "info") {
    return false;
  }

  logger.warn(
    "Media metrics are disabled: they are logged at info, below the configured log level.",
    { logLevel: level },
  );
  return true;
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
