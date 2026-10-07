import { checkImageModerationAccess } from "@/features/media/moderation/check-image-moderation";
import {
  ImageModerationConfigurationError,
  ImageModerationUnavailableError,
  type ImageModerationService,
} from "@/features/media/moderation/image-moderation.service";
import { NoopModeration } from "@/features/media/moderation/noop-moderation";

function moderationWhoseCheck(
  checkAccess: () => Promise<void>,
): ImageModerationService {
  return {
    moderate: async () => ({
      decision: "allow",
      categories: {},
      provider: "x",
    }),
    checkAccess: jest.fn(checkAccess),
  };
}

describe("checkImageModerationAccess", () => {
  it("starts when the provider accepts the worker", async () => {
    const moderation = moderationWhoseCheck(async () => undefined);
    const logger = { warn: jest.fn() };

    await expect(
      checkImageModerationAccess({
        createModeration: () => moderation,
        logger,
      }),
    ).resolves.toBeUndefined();
    expect(moderation.checkAccess).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("starts without a provider", async () => {
    await expect(
      checkImageModerationAccess({
        createModeration: () => new NoopModeration(),
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses to start when the provider refuses the worker", async () => {
    const refusal = new ImageModerationConfigurationError(
      "Content Safety answered 401. It refused the worker's credentials.",
      401,
    );

    const error = await checkImageModerationAccess({
      createModeration: () =>
        moderationWhoseCheck(() => Promise.reject(refusal)),
    }).then(
      () => {
        throw new Error("Expected the check to throw.");
      },
      (caught: unknown) => caught as Error,
    );

    expect(error.message).toBe(
      "The moderation provider refused the media processing worker: Content Safety answered 401. It refused the worker's credentials.",
    );
    expect(error.cause).toBe(refusal);
  });

  it("starts anyway when the provider is only unreachable, and says so", async () => {
    const logger = { warn: jest.fn() };

    await expect(
      checkImageModerationAccess({
        createModeration: () =>
          moderationWhoseCheck(() =>
            Promise.reject(
              new ImageModerationUnavailableError(
                "Content Safety answered 503.",
                503,
              ),
            ),
          ),
        logger,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "Could not reach the moderation provider at startup. Uploads are retried until it answers.",
      { error: "Content Safety answered 503." },
    );

    await checkImageModerationAccess({
      createModeration: () =>
        moderationWhoseCheck(() => Promise.reject("socket hang up")),
      logger,
    });
    expect(logger.warn).toHaveBeenLastCalledWith(expect.any(String), {
      error: "socket hang up",
    });
  });

  it("refuses to start on settings moderation cannot be built from", async () => {
    await expect(
      checkImageModerationAccess({
        createModeration: () => {
          throw new Error("Media moderation is misconfigured:\n- x");
        },
      }),
    ).rejects.toThrow("Media moderation is misconfigured");
  });

  it("builds moderation from the environment by default", async () => {
    // The unit-test environment configures no provider and is not production.
    await expect(checkImageModerationAccess()).resolves.toBeUndefined();
  });
});
