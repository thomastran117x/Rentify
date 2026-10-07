import { environment } from "@/configuration/environment/index";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import { createImageModeration } from "@/features/media/moderation/create-image-moderation";
import {
  ImageModerationConfigurationError,
  type ImageModerationService,
} from "@/features/media/moderation/image-moderation.service";

export interface ImageModerationAccessDependencies {
  createModeration: () => ImageModerationService;
  logger: Pick<Logger, "warn">;
}

/**
 * Run when the media processing worker starts, before it takes any job.
 *
 * Builds the configured moderation, so invalid settings, or production
 * without moderation, stop the worker here with their message. It then asks
 * the provider to check access. A provider that refuses this worker (a wrong
 * key or endpoint, or an identity without its role) stops the worker too,
 * instead of failing every upload through all its retries. A provider that
 * is merely unreachable is only logged: uploads wait it out by retrying, and
 * an outage should not keep the worker down after it ends.
 */
export async function checkImageModerationAccess(
  overrides: Partial<ImageModerationAccessDependencies> = {},
): Promise<void> {
  const moderation = (
    overrides.createModeration ??
    (() =>
      createImageModeration(
        environment.getMediaModerationConfig(),
        environment.isProduction(),
      ))
  )();

  try {
    await moderation.checkAccess();
  } catch (error) {
    if (error instanceof ImageModerationConfigurationError) {
      throw new Error(
        `The moderation provider refused the media processing worker: ${error.message}`,
        { cause: error },
      );
    }

    (
      overrides.logger ??
      loggerFactory.forComponent("image-moderation-access", "app")
    ).warn(
      "Could not reach the moderation provider at startup. Uploads are retried until it answers.",
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
}
