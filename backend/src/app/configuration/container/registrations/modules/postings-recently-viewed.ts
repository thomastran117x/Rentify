import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { RecentlyViewedPostingsRepository } from "@/features/postings/recently-viewed/recently-viewed.repository";
import { RecentlyViewedPostingsService } from "@/features/postings/recently-viewed/recently-viewed.service";

export const postingsRecentlyViewedRegistrationModule: ContainerRegistrationModule =
  {
    id: "postings-recently-viewed",
    register(container) {
      container.register({
        token: containerTokens.recentlyViewedPostingsRepository,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new RecentlyViewedPostingsRepository(),
      });
      container.register({
        token: containerTokens.recentlyViewedPostingsService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.recentlyViewedPostingsRepository,
          containerTokens.postingsRepository,
          containerTokens.postingsPublicCacheService,
          containerTokens.profileRepository,
          containerTokens.cacheService,
        ],
        resolve: ({ resolve }) =>
          new RecentlyViewedPostingsService(
            resolve(containerTokens.recentlyViewedPostingsRepository),
            resolve(containerTokens.postingsRepository),
            resolve(containerTokens.postingsPublicCacheService),
            resolve(containerTokens.profileRepository),
            resolve(containerTokens.cacheService),
          ),
      });
    },
  };
