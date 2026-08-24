import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PostingsController } from "@/features/postings/postings.controller";
import { PostingsRepository } from "@/features/postings/postings.repository";
import { PostingsService } from "@/features/postings/postings.service";
import { PostingExpiryService } from "@/features/postings/posting-expiry.service";
import { PostingExpiryEmailComposer } from "@/features/postings/posting-expiry-email.composer";
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
      token: containerTokens.postingExpiryEmailComposer,
      lifetime: "singleton",
      dependencies: [
        containerTokens.postingsRepository,
        containerTokens.authUsersRepository,
        containerTokens.organizationAccessService,
      ],
      resolve: ({ resolve }) =>
        new PostingExpiryEmailComposer(
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.authUsersRepository),
          resolve(containerTokens.organizationAccessService),
        ),
    });
    container.register({
      token: containerTokens.postingExpiryService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.postingsRepository,
        containerTokens.postingsPublicCacheService,
        containerTokens.cacheService,
        containerTokens.organizationAuditService,
        containerTokens.organizationsMembersRepository,
        containerTokens.emailService,
      ],
      resolve: ({ resolve }) =>
        new PostingExpiryService(
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.postingsPublicCacheService),
          resolve(containerTokens.cacheService),
          resolve(containerTokens.organizationAuditService),
          resolve(containerTokens.organizationsMembersRepository),
          resolve(containerTokens.emailService),
        ),
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
        containerTokens.authUsersRepository,
        containerTokens.organizationAuditService,
        containerTokens.organizationsProfileRepository,
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
          resolve(containerTokens.authUsersRepository),
          resolve(containerTokens.organizationAuditService),
          resolve(containerTokens.organizationsProfileRepository),
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
        containerTokens.organizationAuditService,
      ],
      resolve: ({ resolve }) =>
        new SeasonalPricingService(
          resolve(containerTokens.seasonalPricingRepository),
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.organizationAccessService),
          resolve(containerTokens.organizationAuditService),
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
        containerTokens.savedPostingsService,
      ],
      resolve: ({ resolve }) =>
        new PostingsController(
          resolve(containerTokens.postingsService),
          resolve(containerTokens.postingsPublicAutocompleteService),
          resolve(containerTokens.postingsAnalyticsService),
          resolve(containerTokens.postingsReviewsService),
          resolve(containerTokens.seasonalPricingService),
          resolve(containerTokens.recommendationActivityPublisher),
          resolve(containerTokens.savedPostingsService),
        ),
    });
  },
};
