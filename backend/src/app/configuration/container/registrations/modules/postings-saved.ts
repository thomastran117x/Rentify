import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { SavedPostingsRepository } from "@/features/postings/saved/saved-postings.repository";
import { SavedPostingsService } from "@/features/postings/saved/saved-postings.service";

export const postingsSavedRegistrationModule: ContainerRegistrationModule = {
  id: "postings-saved",
  register(container) {
    container.register({
      token: containerTokens.savedPostingsRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new SavedPostingsRepository(),
    });
    container.register({
      token: containerTokens.savedPostingsService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.savedPostingsRepository,
        containerTokens.postingsRepository,
        containerTokens.postingsPublicCacheService,
        containerTokens.cacheService,
      ],
      resolve: ({ resolve }) =>
        new SavedPostingsService(
          resolve(containerTokens.savedPostingsRepository),
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.postingsPublicCacheService),
          resolve(containerTokens.cacheService),
        ),
    });
  },
};
