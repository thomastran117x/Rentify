import { environment } from "@/configuration/environment";
import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { FeatureFlagRepository } from "@/features/feature-flags/feature-flag.repository";
import { FeatureFlagService } from "@/features/feature-flags/feature-flag.service";
import { FeatureFlagController } from "@/features/feature-flags/feature-flag.controller";

export const featureFlagsRegistrationModule: ContainerRegistrationModule = {
  id: "feature-flags",
  register(container) {
    container.register({
      token: containerTokens.featureFlagRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new FeatureFlagRepository(),
    });

    const envFeatures = environment.getFeaturesConfig();

    container.register({
      token: containerTokens.featureFlagService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.featureFlagRepository,
        containerTokens.cacheService,
      ],
      resolve: ({ resolve }) =>
        new FeatureFlagService(
          resolve(containerTokens.featureFlagRepository),
          resolve(containerTokens.cacheService),
          envFeatures,
        ),
    });

    container.register({
      token: containerTokens.featureFlagController,
      lifetime: "scoped",
      dependencies: [containerTokens.featureFlagService],
      resolve: ({ resolve }) =>
        new FeatureFlagController(resolve(containerTokens.featureFlagService)),
    });
  },
};
