import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { ProfileController } from "@/features/profile/profile.controller";
import { ProfileRepository } from "@/features/profile/profile.repository";
import { ProfileService } from "@/features/profile/profile.service";

export const profileRegistrationModule: ContainerRegistrationModule = {
  id: "profile",
  register(container) {
    container.register({
      token: containerTokens.profileRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new ProfileRepository(),
    });
    container.register({
      token: containerTokens.profileService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.profileRepository,
        containerTokens.blobService,
        containerTokens.cacheService,
        containerTokens.usernameBloomService,
      ],
      resolve: ({ resolve }) =>
        new ProfileService(
          resolve(containerTokens.profileRepository),
          resolve(containerTokens.blobService),
          resolve(containerTokens.cacheService),
          resolve(containerTokens.usernameBloomService),
        ),
    });
    container.register({
      token: containerTokens.profileController,
      lifetime: "scoped",
      dependencies: [containerTokens.profileService],
      resolve: ({ resolve }) =>
        new ProfileController(resolve(containerTokens.profileService)),
    });
  },
};
