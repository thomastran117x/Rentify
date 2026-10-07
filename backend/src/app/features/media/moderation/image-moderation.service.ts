export const MODERATION_CATEGORIES = [
  "hate",
  "sexual",
  "violence",
  "selfHarm",
] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

/** The severity at or above which each category blocks an image. */
export type ModerationThresholds = Record<ModerationCategory, number>;

/**
 * What moderation said about one image. `categories` holds each analyzed
 * category's severity; Azure AI Content Safety reports images as 0, 2, 4, or 6.
 * Internal: it is recorded for operators and never reaches a response.
 */
export interface ModerationResult {
  decision: "allow" | "block";
  categories: Partial<Record<ModerationCategory, number>>;
  /** What moderated it, such as "azure-content-safety", or "none". */
  provider: string;
}

/** An encoded image to moderate, with its size. */
export interface ModerationImage {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Screens a processed image for harmful visual content before it is
 * published. Each provider prepares the image for its own limits, so one that
 * never looks at it does no image work. A provider that wants a human to look
 * first would need an item state that waits on that review; this port leaves
 * room for that.
 */
export interface ImageModerationService {
  /** Throws when the provider is unavailable; that is retryable. */
  moderate(image: ModerationImage): Promise<ModerationResult>;
  /**
   * Checks, when the worker starts, that the provider accepts this worker.
   * Throws ImageModerationConfigurationError when it does not; any other
   * failure is an outage, which uploads ride out by retrying.
   */
  checkAccess(): Promise<void>;
}

/**
 * The provider could not give a decision: it was unreachable, timed out,
 * throttled the request, or answered with an error or something unreadable. A
 * retry may succeed, so it is never a rejection, and nothing unscreened is
 * published.
 */
export class ImageModerationUnavailableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ImageModerationUnavailableError";
  }
}

/**
 * The provider refused the worker's credentials or endpoint (401, 403, 404),
 * or the worker could not sign in. Retried like an outage, so the items can
 * be replayed once the configuration is fixed, but reported as a
 * configuration problem rather than an outage.
 */
export class ImageModerationConfigurationError extends ImageModerationUnavailableError {
  constructor(message: string, status?: number, options?: { cause?: unknown }) {
    super(message, status, options);
    this.name = "ImageModerationConfigurationError";
  }
}

/**
 * The provider refused this particular image, as with a 400. Asking again
 * gets the same answer, so it is final for the item: the image cannot be
 * screened, so it is rejected rather than published or retried.
 */
export class ImageModerationRefusedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ImageModerationRefusedError";
  }
}

/** Blocks when any category reaches its threshold. */
export function decideModeration(
  categories: ModerationResult["categories"],
  thresholds: ModerationThresholds,
): ModerationResult["decision"] {
  return MODERATION_CATEGORIES.some((category) => {
    const severity = categories[category];
    return severity !== undefined && severity >= thresholds[category];
  })
    ? "block"
    : "allow";
}
