import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PostingsController } from "@/features/postings/postings.controller";
import { PostingsRepository } from "@/features/postings/postings.repository";
import { PostingsService } from "@/features/postings/postings.service";

export const postingsCoreRegistrationModule: ContainerRegistrationModule = {
  id: "postings-core",
  register(container) {
    container.register({
      token: containerTokens.postingsRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new PostingsRepository(),
    });
    container.register({
      token: containerTokens.postingsService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.postingsRepository,
        containerTokens.postingsPublicSearchService,
        containerTokens.postingsReviewsRepository,
        containerTokens.rentingsRepository,
        containerTokens.blobService,
        containerTokens.postingThumbnailQueueService,
        containerTokens.contentSanitizationService,
        containerTokens.cacheService,
        containerTokens.postingsPublicCacheService,
      ],
      resolve: ({ resolve }) =>
        new PostingsService(
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.postingsPublicSearchService),
          resolve(containerTokens.postingsReviewsRepository),
          resolve(containerTokens.rentingsRepository),
          resolve(containerTokens.blobService),
          resolve(containerTokens.postingThumbnailQueueService),
          resolve(containerTokens.contentSanitizationService),
          resolve(containerTokens.cacheService),
          resolve(containerTokens.postingsPublicCacheService),
        ),
    });
    container.register({
      token: containerTokens.postingsController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.postingsService,
        containerTokens.postingsPublicAutocompleteService,
        containerTokens.postingsAnalyticsService,
        containerTokens.postingsReviewsService,
        containerTokens.recommendationActivityPublisher,
      ],
      resolve: ({ resolve }) =>
        new PostingsController(
          resolve(containerTokens.postingsService),
          resolve(containerTokens.postingsPublicAutocompleteService),
          resolve(containerTokens.postingsAnalyticsService),
          resolve(containerTokens.postingsReviewsService),
          resolve(containerTokens.recommendationActivityPublisher),
        ),
    });
  },
};
