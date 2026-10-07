import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import type { AppEnvironment } from "@/configuration/environment/types";
import { AzureContentSafetyModeration } from "@/features/media/moderation/azure-content-safety-moderation";
import type { ImageModerationService } from "@/features/media/moderation/image-moderation.service";
import { NoopModeration } from "@/features/media/moderation/noop-moderation";

export const PRODUCTION_WITHOUT_MODERATION_ERROR =
  "MEDIA_MODERATION_PROVIDER is none, so uploaded images would be published without content moderation, which the privacy policy says they get. Set MEDIA_MODERATION_PROVIDER=azure-content-safety, or MEDIA_MODERATION_ALLOW_NONE=true to run production without moderation.";

/**
 * The moderation `mediaModeration` describes. Refuses settings the
 * environment layer found problems with, and refuses `none` in production
 * unless `allowNone` says that is intended. Only the media processing worker
 * builds one, when it starts, so a misconfigured deployment stops that worker
 * with this message and leaves every other process running. In entra mode the
 * credential is built once, so its token is cached across every image the
 * worker moderates.
 */
export function createImageModeration(
  config: AppEnvironment["mediaModeration"],
  isProduction: boolean,
  createCredential: () => TokenCredential = () => new DefaultAzureCredential(),
): ImageModerationService {
  if (config.problems.length > 0) {
    throw new Error(
      `Media moderation is misconfigured:\n- ${config.problems.join("\n- ")}`,
    );
  }

  const { setup } = config;

  if (setup.provider === "none") {
    if (isProduction && !setup.allowNone) {
      throw new Error(PRODUCTION_WITHOUT_MODERATION_ERROR);
    }

    return new NoopModeration();
  }

  return new AzureContentSafetyModeration({
    endpoint: setup.endpoint,
    scope: setup.scope,
    auth:
      setup.auth.kind === "api-key"
        ? setup.auth
        : { kind: "entra", credential: createCredential() },
    timeoutMs: setup.timeoutMs,
    blockAtSeverity: setup.blockAtSeverity,
  });
}
