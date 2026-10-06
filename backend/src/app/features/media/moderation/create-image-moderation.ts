import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import type { AppEnvironment } from "@/configuration/environment/types";
import { AzureContentSafetyModeration } from "@/features/media/moderation/azure-content-safety-moderation";
import type { ImageModerationService } from "@/features/media/moderation/image-moderation.service";
import { NoopModeration } from "@/features/media/moderation/noop-moderation";

/**
 * The moderation `mediaModeration.provider` selects. The environment layer has
 * already refused an Azure provider without an endpoint, or api-key mode
 * without a key. Only the media processing worker builds one, when it starts.
 * In entra mode the credential is built once, so its token is cached across
 * every image the worker moderates.
 */
export function createImageModeration(
  config: AppEnvironment["mediaModeration"],
  createCredential: () => TokenCredential = () => new DefaultAzureCredential(),
): ImageModerationService {
  if (config.provider !== "azure-content-safety") {
    return new NoopModeration();
  }

  if (!config.endpoint) {
    throw new Error(
      "MEDIA_MODERATION_ENDPOINT is required when MEDIA_MODERATION_PROVIDER is azure-content-safety.",
    );
  }

  if (config.auth === "api-key" && !config.apiKey) {
    throw new Error(
      "MEDIA_MODERATION_API_KEY is required when MEDIA_MODERATION_AUTH is api-key.",
    );
  }

  return new AzureContentSafetyModeration({
    endpoint: config.endpoint,
    auth:
      config.auth === "api-key"
        ? { kind: "api-key", apiKey: config.apiKey as string }
        : { kind: "entra", credential: createCredential() },
    timeoutMs: config.timeoutMs,
    blockAtSeverity: config.blockAtSeverity,
  });
}
