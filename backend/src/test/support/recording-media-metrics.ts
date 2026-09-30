import type {
  MediaCounterName,
  MediaCounterTags,
  MediaMetricName,
  MediaMetrics,
  MediaObservationName,
  MediaObservationTags,
} from "@/features/media/media-metrics";

export interface RecordedMediaMetric {
  kind: "increment" | "observe";
  name: MediaMetricName;
  value: number;
  tags: Record<string, string | number | boolean>;
}

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const IDENTIFYING_TAG_KEYS = /id$|filename|blob/i;
const BLOB_OR_FILE_NAME = /^(quarantine|media)\/|\.[a-z0-9]{2,5}$/i;

/** A MediaMetrics fake that keeps every call, for asserting on emissions. */
export class RecordingMediaMetrics implements MediaMetrics {
  readonly recorded: RecordedMediaMetric[] = [];

  increment<Name extends MediaCounterName>(
    name: Name,
    tags: MediaCounterTags[Name],
  ): void {
    this.recorded.push({ kind: "increment", name, value: 1, tags });
  }

  observe<Name extends MediaObservationName>(
    name: Name,
    value: number,
    tags: MediaObservationTags[Name],
  ): void {
    this.recorded.push({ kind: "observe", name, value, tags });
  }

  calls(name: MediaMetricName): RecordedMediaMetric[] {
    return this.recorded.filter((metric) => metric.name === name);
  }

  /** The tags of every call to `name`, in order. */
  tagsOf(name: MediaMetricName): Array<RecordedMediaMetric["tags"]> {
    return this.calls(name).map((metric) => metric.tags);
  }

  count(name: MediaMetricName): number {
    return this.calls(name).length;
  }

  /**
   * Fails if any recorded tag could identify a user, an item, or a file. Tags
   * are typed to prevent that; this catches a value that slips in as a string.
   */
  assertNoIdentifiers(): void {
    for (const metric of this.recorded) {
      for (const [key, value] of Object.entries(metric.tags)) {
        expect({ metric: metric.name, key }).not.toEqual(
          expect.objectContaining({
            key: expect.stringMatching(IDENTIFYING_TAG_KEYS),
          }),
        );

        if (typeof value === "string") {
          expect({ metric: metric.name, key, value }).not.toEqual(
            expect.objectContaining({
              value: expect.stringMatching(UUID_PATTERN),
            }),
          );
          expect({ metric: metric.name, key, value }).not.toEqual(
            expect.objectContaining({
              value: expect.stringMatching(BLOB_OR_FILE_NAME),
            }),
          );
        }
      }
    }
  }
}

/** A MediaMetrics whose every call throws, to prove callers are unaffected. */
export class ThrowingMediaMetrics implements MediaMetrics {
  increment(): void {
    throw new Error("metrics backend unavailable");
  }

  observe(): void {
    throw new Error("metrics backend unavailable");
  }
}
