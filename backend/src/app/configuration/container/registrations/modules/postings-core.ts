import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PostingsController } from "@/features/postings/postings.controller";
import { PostingsRepository } from "@/features/postings/postings.repository";
import { PostingsService } from "@/features/postings/postings.service";
import { SeasonalPricingRepository } from "@/features/postings/seasonal-pricing/seasonal-pricing.repository";
import { SeasonalPricingService } from "@/features/postings/seasonal-pricing/seasonal-pricing.service";

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
        containerTokens.organizationAccessService,
        containerTokens.authRepository,
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
          resolve(containerTokens.organizationAccessService),
          resolve(containerTokens.authRepository),
        ),
    });
    container.register({
      token: containerTokens.seasonalPricingRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new SeasonalPricingRepository(),
    });
    container.register({
      token: containerTokens.seasonalPricingService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.seasonalPricingRepository,
        containerTokens.postingsRepository,
        containerTokens.organizationAccessService,
      ],
      resolve: ({ resolve }) =>
        new SeasonalPricingService(
          resolve(containerTokens.seasonalPricingRepository),
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.organizationAccessService),
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
        containerTokens.seasonalPricingService,
        containerTokens.recommendationActivityPublisher,
      ],
      resolve: ({ resolve }) =>
        new PostingsController(
          resolve(containerTokens.postingsService),
          resolve(containerTokens.postingsPublicAutocompleteService),
          resolve(containerTokens.postingsAnalyticsService),
          resolve(containerTokens.postingsReviewsService),
          resolve(containerTokens.seasonalPricingService),
          resolve(containerTokens.recommendationActivityPublisher),
        ),
    });
  },
};
