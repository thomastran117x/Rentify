import type { TokenCredential } from "@azure/identity";
import { renderModerationImage } from "@/features/media/image-renditions";
import {
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
 * URL. Every failure to get a complete answer throws
 * ImageModerationUnavailableError, so the job is retried and, if the provider
 * stays down, dead-lettered: moderation fails closed.
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
    const headers = {
      "Content-Type": "application/json",
      ...(await this.authorizationHeader()),
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs,
    );
    let status: number;
    let text: string;

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          image: { content: data.toString("base64") },
          categories: MODERATION_CATEGORIES.map(
            (category) => AZURE_CATEGORY_NAMES[category],
          ),
          outputType: "FourSeverityLevels",
        }),
        signal: controller.signal,
      });
      status = response.status;
      text = await response.text();

      if (!response.ok) {
        throw new ImageModerationUnavailableError(
          `Content Safety answered ${status}${describeErrorCode(response, text)}.`,
          status,
        );
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

    const categories = parseCategories(text, status);

    return {
      decision: decideModeration(categories, this.options.blockAtSeverity),
      categories,
      provider: AZURE_CONTENT_SAFETY_PROVIDER,
    };
  }

  private async authorizationHeader(): Promise<Record<string, string>> {
    const { auth } = this.options;

    if (auth.kind === "api-key") {
      return { "Ocp-Apim-Subscription-Key": auth.apiKey };
    }

    let token: Awaited<ReturnType<TokenCredential["getToken"]>>;

    try {
      // The credential caches the token and renews it before it expires.
      token = await auth.credential.getToken(this.scope);
    } catch (error) {
      throw new ImageModerationUnavailableError(
        "Could not sign in to Azure AI Content Safety.",
        undefined,
        { cause: error },
      );
    }

    if (!token) {
      throw new ImageModerationUnavailableError(
        "Could not sign in to Azure AI Content Safety.",
      );
    }

    return { Authorization: `Bearer ${token.token}` };
  }
}

/**
 * The service's error code, never its message, which may echo the request.
 * Omitted when it only repeats the status, as an invalid key's "401" does.
 */
function describeErrorCode(response: Response, text: string): string {
  let code = response.headers.get("x-ms-error-code");

  if (!code) {
    try {
      const body = JSON.parse(text) as { error?: { code?: unknown } };
      code = typeof body.error?.code === "string" ? body.error.code : null;
    } catch {
      code = null;
    }
  }

  return code && code !== String(response.status) ? ` (${code})` : "";
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
