import type { TokenCredential } from "@azure/identity";
import sharp from "sharp";
import { renderModerationImage } from "@/features/media/image-renditions";
import {
  ImageModerationConfigurationError,
  ImageModerationRefusedError,
  ImageModerationUnavailableError,
  MODERATION_CATEGORIES,
  decideModeration,
  type ImageModerationService,
  type ModerationCategory,
  type ModerationImage,
  type ModerationResult,
  type ModerationThresholds,
} from "@/features/media/moderation/image-moderation.service";

export const AZURE_CONTENT_SAFETY_PROVIDER = "azure-content-safety";
export const CONTENT_SAFETY_API_VERSION = "2024-09-01";

const AZURE_CATEGORY_NAMES: Record<ModerationCategory, string> = {
  hate: "Hate",
  sexual: "Sexual",
  violence: "Violence",
  selfHarm: "SelfHarm",
};

export type AzureContentSafetyAuth =
  | { kind: "api-key"; apiKey: string }
  | { kind: "entra"; credential: TokenCredential };

export interface AzureContentSafetyModerationOptions {
  /** The resource's origin, such as https://<resource>.cognitiveservices.azure.com. */
  endpoint: string;
  /** The Entra ID scope of the endpoint's cloud, used in entra mode. */
  scope: string;
  auth: AzureContentSafetyAuth;
  /** For each request, from sending it to reading the whole reply. */
  timeoutMs: number;
  blockAtSeverity: ModerationThresholds;
}

/**
 * Moderates with Azure AI Content Safety's synchronous image analysis. The
 * image travels base64-encoded in the request body, so nothing is shared by
 * URL. A failure is classified by what retrying it can achieve:
 *
 * - throttling (429, or 503 with Retry-After) asking for a wait of at most
 *   MAX_INLINE_RETRY_AFTER_MS is waited out and asked once more, within the
 *   same deadline;
 * - an outage (5xx, 408, 429, a timeout, a network error, an unreadable
 *   answer) throws ImageModerationUnavailableError, so the job is retried and,
 *   if the provider stays down, dead-lettered: moderation fails closed;
 * - refused credentials or a wrong endpoint (401, 403, 404, or no token)
 *   throws ImageModerationConfigurationError, retried the same way so the
 *   items can be replayed once it is fixed;
 * - any other 4xx is a refusal of this image, which asking again would only
 *   repeat, so it throws ImageModerationRefusedError and the item is rejected.
 */
export class AzureContentSafetyModeration implements ImageModerationService {
  private readonly url: string;
  private readonly scope: string;

  constructor(private readonly options: AzureContentSafetyModerationOptions) {
    this.url = `${options.endpoint}/contentsafety/image:analyze?api-version=${CONTENT_SAFETY_API_VERSION}`;
    this.scope = options.scope;
  }

  async moderate(image: ModerationImage): Promise<ModerationResult> {
    // Fitted to Content Safety's 50 to 2048 px; unchanged when it already is.
    const { data } = await renderModerationImage(image);
    const body = JSON.stringify({
      image: { content: data.toString("base64") },
      categories: MODERATION_CATEGORIES.map(
        (category) => AZURE_CATEGORY_NAMES[category],
      ),
      outputType: "FourSeverityLevels",
    });
    // One deadline for the whole call, signing in included.
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs,
    );
    let reply: Reply;

    try {
      const headers = {
        "Content-Type": "application/json",
        ...(await this.authorizationHeader(controller.signal)),
      };
      reply = await this.send(headers, body, controller.signal);
      const waitMs = inlineRetryDelayMs(reply);

      if (waitMs !== null) {
        await delay(waitMs, controller.signal);
        reply = await this.send(headers, body, controller.signal);
      }
    } catch (error) {
      if (error instanceof ImageModerationUnavailableError) {
        throw error;
      }

      throw new ImageModerationUnavailableError(
        controller.signal.aborted
          ? `Content Safety did not answer within ${this.options.timeoutMs} ms.`
          : "Content Safety could not be reached.",
        undefined,
        { cause: error },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!reply.ok) {
      throw classifyFailure(reply);
    }

    const categories = parseCategories(reply.text, reply.status);

    return {
      decision: decideModeration(categories, this.options.blockAtSeverity),
      categories,
      provider: AZURE_CONTENT_SAFETY_PROVIDER,
    };
  }

  /**
   * Analyzes a small blank image. One call proves the endpoint, the key or
   * the Entra ID identity, and that identity's role, which signing in alone
   * cannot. It costs one image analysis each time the worker starts.
   */
  async checkAccess(): Promise<void> {
    const edge = 64;
    const data = await sharp({
      create: {
        width: edge,
        height: edge,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();

    await this.moderate({ data, width: edge, height: edge });
  }

  private async send(
    headers: Record<string, string>,
    body: string,
    signal: AbortSignal,
  ): Promise<Reply> {
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body,
      signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      text: await response.text(),
    };
  }

  private async authorizationHeader(
    abortSignal: AbortSignal,
  ): Promise<Record<string, string>> {
    const { auth } = this.options;

    if (auth.kind === "api-key") {
      return { "Ocp-Apim-Subscription-Key": auth.apiKey };
    }

    let token: Awaited<ReturnType<TokenCredential["getToken"]>>;

    try {
      // The credential caches the token and renews it before it expires.
      token = await auth.credential.getToken(this.scope, { abortSignal });
    } catch (error) {
      if (abortSignal.aborted) {
        throw error;
      }

      throw new ImageModerationConfigurationError(SIGN_IN_FAILED, undefined, {
        cause: error,
      });
    }

    if (!token) {
      throw new ImageModerationConfigurationError(SIGN_IN_FAILED);
    }

    return { Authorization: `Bearer ${token.token}` };
  }
}

const SIGN_IN_FAILED =
  "Could not sign in to Azure AI Content Safety. Check the worker's Microsoft Entra ID identity.";

interface Reply {
  ok: boolean;
  status: number;
  headers: Headers;
  text: string;
}

/** The longest Retry-After the worker waits out itself, rather than retrying later. */
export const MAX_INLINE_RETRY_AFTER_MS = 5_000;

/**
 * How long to wait before asking once more, when the service throttled the
 * request (429, or 503) and asked for a wait short enough to hold the job for.
 * Null otherwise: a longer wait is left to the queue's retry tiers.
 */
function inlineRetryDelayMs(reply: Reply): number | null {
  if (reply.status !== 429 && reply.status !== 503) {
    return null;
  }

  const waitMs = retryAfterMs(reply.headers);

  return waitMs !== null && waitMs <= MAX_INLINE_RETRY_AFTER_MS ? waitMs : null;
}

/** Retry-After as delay seconds or an HTTP date, in milliseconds. */
function retryAfterMs(headers: Headers): number | null {
  const value = headers.get("retry-after")?.trim();

  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    return Number(value) * 1000;
  }

  const at = Date.parse(value);

  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(signal.reason);
    };
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The error a non-2xx reply means, by what retrying it can achieve. */
function classifyFailure(reply: Reply): Error {
  const answered = `Content Safety answered ${reply.status}${describeErrorCode(reply)}`;

  if (reply.status === 401 || reply.status === 403) {
    return new ImageModerationConfigurationError(
      `${answered}. It refused the worker's credentials: check MEDIA_MODERATION_API_KEY, or the Cognitive Services User role of the worker's identity.`,
      reply.status,
    );
  }

  if (reply.status === 404) {
    return new ImageModerationConfigurationError(
      `${answered}. Check MEDIA_MODERATION_ENDPOINT.`,
      reply.status,
    );
  }

  if (
    reply.status >= 400 &&
    reply.status < 500 &&
    reply.status !== 408 &&
    reply.status !== 429
  ) {
    return new ImageModerationRefusedError(`${answered}.`, reply.status);
  }

  const waitMs = retryAfterMs(reply.headers);

  return new ImageModerationUnavailableError(
    waitMs === null
      ? `${answered}.`
      : `${answered}; it asked to wait ${Math.ceil(waitMs / 1000)} s.`,
    reply.status,
  );
}

/**
 * The service's error code, never its message, which may echo the request.
 * Omitted when it only repeats the status, as an invalid key's "401" does.
 */
function describeErrorCode(reply: Reply): string {
  let code = reply.headers.get("x-ms-error-code");

  if (!code) {
    try {
      const body = JSON.parse(reply.text) as { error?: { code?: unknown } };
      code = typeof body.error?.code === "string" ? body.error.code : null;
    } catch {
      code = null;
    }
  }

  return code && code !== String(reply.status) ? ` (${code})` : "";
}

/**
 * Every requested category, with a non-negative integer severity. Anything
 * less is not an answer to act on, so it is thrown like an outage.
 */
function parseCategories(
  text: string,
  status: number,
): Record<ModerationCategory, number> {
  let analysis: unknown;

  try {
    analysis = (JSON.parse(text) as { categoriesAnalysis?: unknown })
      .categoriesAnalysis;
  } catch (error) {
    throw new ImageModerationUnavailableError(
      "Content Safety answered with a body that is not JSON.",
      status,
      { cause: error },
    );
  }

  const severities = new Map<string, number>();

  if (Array.isArray(analysis)) {
    for (const entry of analysis as Array<{
      category?: unknown;
      severity?: unknown;
    }>) {
      if (
        typeof entry?.category === "string" &&
        Number.isInteger(entry.severity) &&
        (entry.severity as number) >= 0
      ) {
        severities.set(entry.category, entry.severity as number);
      }
    }
  }

  const categories = {} as Record<ModerationCategory, number>;

  for (const category of MODERATION_CATEGORIES) {
    const severity = severities.get(AZURE_CATEGORY_NAMES[category]);

    if (severity === undefined) {
      throw new ImageModerationUnavailableError(
        `Content Safety's answer has no severity for ${AZURE_CATEGORY_NAMES[category]}.`,
        status,
      );
    }

    categories[category] = severity;
  }

  return categories;
}
