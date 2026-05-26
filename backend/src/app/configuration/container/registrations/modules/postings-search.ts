import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import { PostingsPublicAutocompleteService } from "@/features/postings/search/autocomplete.service";
import { PostingsSearchIndexService } from "@/features/postings/search/index.service";
import { PostingsPublicSearchService } from "@/features/postings/search/public-search.service";

export const postingsSearchRegistrationModule: ContainerRegistrationModule = {
  id: "postings-search",
  register(container) {
    container.register({
      token: containerTokens.postingsPublicCacheService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.cacheService,
        containerTokens.postingsRepository,
      ],
      resolve: ({ resolve }) =>
        new PostingsPublicCacheService(
          resolve(containerTokens.cacheService),
          resolve(containerTokens.postingsRepository),
        ),
    });
    container.register({
      token: containerTokens.postingsPublicAutocompleteService,
      lifetime: "scoped",
      dependencies: [containerTokens.postingsRepository],
      resolve: ({ resolve }) =>
        new PostingsPublicAutocompleteService(
          resolve(containerTokens.postingsRepository),
        ),
    });
    container.register({
      token: containerTokens.postingsPublicSearchService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.postingsRepository,
        containerTokens.postingsPublicCacheService,
      ],
      resolve: ({ resolve }) =>
        new PostingsPublicSearchService(
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.postingsPublicCacheService),
        ),
    });
    container.register({
      token: containerTokens.postingsSearchIndexService,
      lifetime: "scoped",
      dependencies: [],
      resolve: () => new PostingsSearchIndexService(),
    });
  },
};
