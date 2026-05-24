import { AuthController } from "@/features/auth/auth.controller";
import { CaptchaService } from "@/features/auth/captcha/captcha.service";
import { DeviceRepository } from "@/features/auth/device/device.repository";
import { DeviceService } from "@/features/auth/device/device.service";
import { OtpService } from "@/features/auth/otp/otp.service";
import { AppleOAuthService } from "@/features/auth/oauth/apple.service";
import { GoogleOAuthService } from "@/features/auth/oauth/google.service";
import { MicrosoftOAuthService } from "@/features/auth/oauth/microsoft.service";
import { OAuthTokenVerifier } from "@/features/auth/oauth/oauth-token-verifier";
import { AuthRepository } from "@/features/auth/auth.repository";
import { AuthService } from "@/features/auth/auth.service";
import { PersonalAccessTokenController } from "@/features/auth/personal-access-token/personal-access-token.controller";
import { PersonalAccessTokenRepository } from "@/features/auth/personal-access-token/personal-access-token.repository";
import { PersonalAccessTokenService } from "@/features/auth/personal-access-token/personal-access-token.service";
import { TokenService } from "@/features/auth/token/token.service";
import { BlobController } from "@/features/blob/blob.controller";
import { BlobService } from "@/features/blob/blob.service";
import { BookingsController } from "@/features/bookings/bookings.controller";
import { BookingsRepository } from "@/features/bookings/bookings.repository";
import { BookingsService } from "@/features/bookings/bookings.service";
import { CacheService } from "@/features/cache/cache.service";
import { EmailDeliveryService } from "@/features/email/email.delivery.service";
import { EmailQueueService } from "@/features/email/email.queue.service";
import { EmailService } from "@/features/email/email.service";
import { PaymentsController } from "@/features/payments/payments.controller";
import { PaymentsRepository } from "@/features/payments/payments.repository";
import { PaymentsService } from "@/features/payments/payments.service";
import { SquarePaymentAdapter } from "@/features/payments/square.adapter";
import { ProfileController } from "@/features/profile/profile.controller";
import { ProfileRepository } from "@/features/profile/profile.repository";
import { ProfileService } from "@/features/profile/profile.service";
import { RecommendationActivityProcessor } from "@/features/recommendations/recommendation-activity.processor";
import { RecommendationActivityPublisher } from "@/features/recommendations/recommendation-activity.publisher";
import { RecommendationActivityQueueService } from "@/features/recommendations/recommendation-activity.queue.service";
import { RecommendationActivityRepository } from "@/features/recommendations/recommendation-activity.repository";
import { RecommendationPrecomputeRepository } from "@/features/recommendations/recommendation-precompute.repository";
import { RecommendationPrecomputeService } from "@/features/recommendations/recommendation-precompute.service";
import { RecommendationQueryRepository } from "@/features/recommendations/recommendation-query.repository";
import { RecommendationQueryService } from "@/features/recommendations/recommendation-query.service";
import { RecommendationsController } from "@/features/recommendations/recommendations.controller";
import { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import { PostingsAnalyticsService } from "@/features/postings/analytics/analytics.service";
import { PostingsController } from "@/features/postings/postings.controller";
import { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import { PostingsReviewsRepository } from "@/features/postings/reviews/reviews.repository";
import { PostingsReviewsService } from "@/features/postings/reviews/reviews.service";
import { PostingsRepository } from "@/features/postings/postings.repository";
import { PostingsPublicAutocompleteService } from "@/features/postings/search/autocomplete.service";
import { PostingsSearchIndexService } from "@/features/postings/search/index.service";
import { PostingsPublicSearchService } from "@/features/postings/search/public-search.service";
import { PostingThumbnailQueueService } from "@/features/postings/thumbnail/thumbnail.queue.service";
import { PostingsService } from "@/features/postings/postings.service";
import { PostingThumbnailService } from "@/features/postings/thumbnail/thumbnail.service";
import { RentingsController } from "@/features/rentings/rentings.controller";
import { RentingsRepository } from "@/features/rentings/rentings.repository";
import { RentingsService } from "@/features/rentings/rentings.service";
import { SearchController } from "@/features/search/search.controller";
import { SearchQueueService } from "@/features/search/search.queue.service";
import { SearchService } from "@/features/search/search.service";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import type { RootServiceContainer } from "@/configuration/container/core";
import { loggerFactory } from "@/configuration/logging";
import { containerTokens } from "@/configuration/container/tokens";

export function registerApplicationServices(container: RootServiceContainer): void {
  container.register({
    token: containerTokens.loggerFactory,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => loggerFactory,
  });
  container.register({
    token: containerTokens.cacheService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new CacheService(),
  });
  container.register({
    token: containerTokens.emailQueueService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new EmailQueueService(),
  });
  container.register({
    token: containerTokens.emailDeliveryService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new EmailDeliveryService(),
  });
  container.register({
    token: containerTokens.emailService,
    lifetime: "singleton",
    dependencies: [containerTokens.emailQueueService],
    resolve: ({ resolve }) => new EmailService(resolve(containerTokens.emailQueueService)),
  });
  container.register({
    token: containerTokens.captchaService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new CaptchaService(),
  });
  container.register({
    token: containerTokens.otpService,
    lifetime: "singleton",
    dependencies: [containerTokens.cacheService],
    resolve: ({ resolve }) =>
      new OtpService({
        cache: resolve(containerTokens.cacheService),
      }),
  });
  container.register({
    token: containerTokens.oauthTokenVerifier,
    lifetime: "transient",
    dependencies: [],
    resolve: () => new OAuthTokenVerifier(),
  });
  container.register({
    token: containerTokens.googleOAuthService,
    lifetime: "transient",
    dependencies: [containerTokens.oauthTokenVerifier],
    resolve: ({ resolve }) =>
      new GoogleOAuthService(resolve(containerTokens.oauthTokenVerifier)),
  });
  container.register({
    token: containerTokens.microsoftOAuthService,
    lifetime: "transient",
    dependencies: [containerTokens.oauthTokenVerifier],
    resolve: ({ resolve }) =>
      new MicrosoftOAuthService(resolve(containerTokens.oauthTokenVerifier)),
  });
  container.register({
    token: containerTokens.appleOAuthService,
    lifetime: "transient",
    dependencies: [],
    resolve: () => new AppleOAuthService(),
  });
  container.register({
    token: containerTokens.deviceRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new DeviceRepository(),
  });
  container.register({
    token: containerTokens.deviceService,
    lifetime: "singleton",
    dependencies: [
      containerTokens.deviceRepository,
      containerTokens.emailService,
      containerTokens.cacheService,
    ],
    resolve: ({ resolve }) =>
      new DeviceService({
        deviceRepository: resolve(containerTokens.deviceRepository),
        emailService: resolve(containerTokens.emailService),
        cache: resolve(containerTokens.cacheService),
      }),
  });
  container.register({
    token: containerTokens.tokenService,
    lifetime: "singleton",
    dependencies: [containerTokens.cacheService, containerTokens.authRepository],
    resolve: ({ resolve }) =>
      new TokenService({
        cache: resolve(containerTokens.cacheService),
        authRepository: resolve(containerTokens.authRepository),
      }),
  });
  container.register({
    token: containerTokens.authRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new AuthRepository(),
  });
  container.register({
    token: containerTokens.personalAccessTokenRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new PersonalAccessTokenRepository(),
  });
  container.register({
    token: containerTokens.authService,
    lifetime: "scoped",
    dependencies: [
      containerTokens.authRepository,
      containerTokens.tokenService,
      containerTokens.otpService,
      containerTokens.deviceService,
      containerTokens.emailService,
      containerTokens.googleOAuthService,
      containerTokens.microsoftOAuthService,
      containerTokens.appleOAuthService,
      containerTokens.cacheService,
    ],
    resolve: ({ resolve }) =>
      new AuthService(
        resolve(containerTokens.authRepository),
        resolve(containerTokens.tokenService),
        resolve(containerTokens.otpService),
        resolve(containerTokens.deviceService),
        resolve(containerTokens.emailService),
        resolve(containerTokens.googleOAuthService),
        resolve(containerTokens.microsoftOAuthService),
        resolve(containerTokens.appleOAuthService),
        resolve(containerTokens.cacheService),
      ),
  });
  container.register({
    token: containerTokens.personalAccessTokenService,
    lifetime: "singleton",
    dependencies: [containerTokens.personalAccessTokenRepository],
    resolve: ({ resolve }) =>
      new PersonalAccessTokenService(resolve(containerTokens.personalAccessTokenRepository)),
  });
  container.register({
    token: containerTokens.authController,
    lifetime: "scoped",
    dependencies: [
      containerTokens.authService,
      containerTokens.captchaService,
      containerTokens.tokenService,
    ],
    resolve: ({ resolve }) =>
      new AuthController(
        resolve(containerTokens.authService),
        resolve(containerTokens.captchaService),
        resolve(containerTokens.tokenService),
      ),
  });
  container.register({
    token: containerTokens.personalAccessTokenController,
    lifetime: "scoped",
    dependencies: [containerTokens.personalAccessTokenService],
    resolve: ({ resolve }) =>
      new PersonalAccessTokenController(resolve(containerTokens.personalAccessTokenService)),
  });
  container.register({
    token: containerTokens.blobService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new BlobService(),
  });
  container.register({
    token: containerTokens.blobController,
    lifetime: "scoped",
    dependencies: [containerTokens.blobService],
    resolve: ({ resolve }) => new BlobController(resolve(containerTokens.blobService)),
  });
  container.register({
    token: containerTokens.bookingsRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new BookingsRepository(),
  });
  container.register({
    token: containerTokens.rentingsRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new RentingsRepository(),
  });
  container.register({
    token: containerTokens.profileRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new ProfileRepository(),
  });
  container.register({
    token: containerTokens.profileService,
    lifetime: "scoped",
    dependencies: [containerTokens.profileRepository, containerTokens.blobService],
    resolve: ({ resolve }) =>
      new ProfileService(
        resolve(containerTokens.profileRepository),
        resolve(containerTokens.blobService),
      ),
  });
  container.register({
    token: containerTokens.profileController,
    lifetime: "scoped",
    dependencies: [containerTokens.profileService],
    resolve: ({ resolve }) => new ProfileController(resolve(containerTokens.profileService)),
  });
  container.register({
    token: containerTokens.recommendationActivityQueueService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new RecommendationActivityQueueService(),
  });
  container.register({
    token: containerTokens.recommendationActivityRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new RecommendationActivityRepository(),
  });
  container.register({
    token: containerTokens.recommendationActivityProcessor,
    lifetime: "scoped",
    dependencies: [containerTokens.recommendationActivityRepository],
    resolve: ({ resolve }) =>
      new RecommendationActivityProcessor(
        resolve(containerTokens.recommendationActivityRepository),
      ),
  });
  container.register({
    token: containerTokens.recommendationActivityPublisher,
    lifetime: "scoped",
    dependencies: [
      containerTokens.recommendationActivityQueueService,
      containerTokens.profileRepository,
    ],
    resolve: ({ resolve }) =>
      new RecommendationActivityPublisher(
        resolve(containerTokens.recommendationActivityQueueService),
        resolve(containerTokens.profileRepository),
      ),
  });
  container.register({
    token: containerTokens.recommendationPrecomputeRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new RecommendationPrecomputeRepository(),
  });
  container.register({
    token: containerTokens.recommendationPrecomputeService,
    lifetime: "scoped",
    dependencies: [containerTokens.recommendationPrecomputeRepository],
    resolve: ({ resolve }) =>
      new RecommendationPrecomputeService(
        resolve(containerTokens.recommendationPrecomputeRepository),
      ),
  });
  container.register({
    token: containerTokens.recommendationQueryRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new RecommendationQueryRepository(),
  });
  container.register({
    token: containerTokens.recommendationQueryService,
    lifetime: "scoped",
    dependencies: [
      containerTokens.recommendationQueryRepository,
      containerTokens.postingsPublicCacheService,
    ],
    resolve: ({ resolve }) =>
      new RecommendationQueryService(
        resolve(containerTokens.recommendationQueryRepository),
        resolve(containerTokens.postingsPublicCacheService),
      ),
  });
  container.register({
    token: containerTokens.recommendationsController,
    lifetime: "scoped",
    dependencies: [containerTokens.recommendationQueryService],
    resolve: ({ resolve }) =>
      new RecommendationsController(resolve(containerTokens.recommendationQueryService)),
  });
  container.register({
    token: containerTokens.postingsRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new PostingsRepository(),
  });
  container.register({
    token: containerTokens.postingsAnalyticsRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new PostingsAnalyticsRepository(),
  });
  container.register({
    token: containerTokens.postingsAnalyticsService,
    lifetime: "scoped",
    dependencies: [
      containerTokens.postingsAnalyticsRepository,
      containerTokens.postingsRepository,
    ],
    resolve: ({ resolve }) =>
      new PostingsAnalyticsService(
        resolve(containerTokens.postingsAnalyticsRepository),
        resolve(containerTokens.postingsRepository),
      ),
  });
  container.register({
    token: containerTokens.bookingsService,
    lifetime: "scoped",
    dependencies: [
      containerTokens.bookingsRepository,
      containerTokens.postingsRepository,
      containerTokens.postingsAnalyticsRepository,
      containerTokens.rentingsRepository,
      containerTokens.cacheService,
      containerTokens.postingsPublicCacheService,
      containerTokens.paymentsRepository,
      containerTokens.paymentProvider,
    ],
    resolve: ({ resolve }) =>
      new BookingsService(
        resolve(containerTokens.bookingsRepository),
        resolve(containerTokens.postingsRepository),
        resolve(containerTokens.postingsAnalyticsRepository),
        resolve(containerTokens.rentingsRepository),
        resolve(containerTokens.cacheService),
        resolve(containerTokens.postingsPublicCacheService),
        resolve(containerTokens.paymentsRepository),
        resolve(containerTokens.paymentProvider),
      ),
  });
  container.register({
    token: containerTokens.bookingsController,
    lifetime: "scoped",
    dependencies: [
      containerTokens.bookingsService,
      containerTokens.recommendationActivityPublisher,
    ],
    resolve: ({ resolve }) =>
      new BookingsController(
        resolve(containerTokens.bookingsService),
        resolve(containerTokens.recommendationActivityPublisher),
      ),
  });
  container.register({
    token: containerTokens.paymentsRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new PaymentsRepository(),
  });
  container.register({
    token: containerTokens.paymentProvider,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new SquarePaymentAdapter(),
  });
  container.register({
    token: containerTokens.paymentsService,
    lifetime: "scoped",
    dependencies: [
      containerTokens.paymentsRepository,
      containerTokens.paymentProvider,
      containerTokens.postingsAnalyticsRepository,
      containerTokens.postingsRepository,
      containerTokens.cacheService,
      containerTokens.postingsPublicCacheService,
    ],
    resolve: ({ resolve }) =>
      new PaymentsService(
        resolve(containerTokens.paymentsRepository),
        resolve(containerTokens.paymentProvider),
        resolve(containerTokens.postingsAnalyticsRepository),
        resolve(containerTokens.postingsRepository),
        resolve(containerTokens.cacheService),
        resolve(containerTokens.postingsPublicCacheService),
      ),
  });
  container.register({
    token: containerTokens.paymentsController,
    lifetime: "scoped",
    dependencies: [containerTokens.paymentsService],
    resolve: ({ resolve }) => new PaymentsController(resolve(containerTokens.paymentsService)),
  });
  container.register({
    token: containerTokens.rentingsService,
    lifetime: "scoped",
    dependencies: [
      containerTokens.rentingsRepository,
      containerTokens.bookingsRepository,
      containerTokens.postingsAnalyticsRepository,
      containerTokens.postingsRepository,
      containerTokens.cacheService,
      containerTokens.postingsPublicCacheService,
    ],
    resolve: ({ resolve }) =>
      new RentingsService(
        resolve(containerTokens.rentingsRepository),
        resolve(containerTokens.bookingsRepository),
        resolve(containerTokens.postingsAnalyticsRepository),
        resolve(containerTokens.postingsRepository),
        resolve(containerTokens.cacheService),
        resolve(containerTokens.postingsPublicCacheService),
      ),
  });
  container.register({
    token: containerTokens.rentingsController,
    lifetime: "scoped",
    dependencies: [
      containerTokens.rentingsService,
      containerTokens.recommendationActivityPublisher,
    ],
    resolve: ({ resolve }) =>
      new RentingsController(
        resolve(containerTokens.rentingsService),
        resolve(containerTokens.recommendationActivityPublisher),
      ),
  });
  container.register({
    token: containerTokens.postingsReviewsRepository,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new PostingsReviewsRepository(),
  });
  container.register({
    token: containerTokens.postingsReviewsService,
    lifetime: "scoped",
    dependencies: [
      containerTokens.postingsReviewsRepository,
      containerTokens.postingsRepository,
      containerTokens.rentingsRepository,
    ],
    resolve: ({ resolve }) =>
      new PostingsReviewsService(
        resolve(containerTokens.postingsReviewsRepository),
        resolve(containerTokens.postingsRepository),
        resolve(containerTokens.rentingsRepository),
      ),
  });
  container.register({
    token: containerTokens.postingsPublicCacheService,
    lifetime: "singleton",
    dependencies: [containerTokens.cacheService, containerTokens.postingsRepository],
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
      new PostingsPublicAutocompleteService(resolve(containerTokens.postingsRepository)),
  });
  container.register({
    token: containerTokens.postingsPublicSearchService,
    lifetime: "scoped",
    dependencies: [containerTokens.postingsRepository, containerTokens.postingsPublicCacheService],
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
  container.register({
    token: containerTokens.postingThumbnailService,
    lifetime: "scoped",
    dependencies: [
      containerTokens.postingsRepository,
      containerTokens.blobService,
      containerTokens.postingsPublicCacheService,
    ],
    resolve: ({ resolve }) =>
      new PostingThumbnailService(
        resolve(containerTokens.postingsRepository),
        resolve(containerTokens.blobService),
        resolve(containerTokens.postingsPublicCacheService),
      ),
  });
  container.register({
    token: containerTokens.postingThumbnailQueueService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new PostingThumbnailQueueService(),
  });
  container.register({
    token: containerTokens.searchQueueService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new SearchQueueService(),
  });
  container.register({
    token: containerTokens.searchService,
    lifetime: "scoped",
    dependencies: [
      containerTokens.postingsRepository,
      containerTokens.postingsSearchIndexService,
      containerTokens.searchQueueService,
    ],
    resolve: ({ resolve }) =>
      new SearchService(
        resolve(containerTokens.postingsRepository),
        resolve(containerTokens.postingsSearchIndexService),
        resolve(containerTokens.searchQueueService),
      ),
  });
  container.register({
    token: containerTokens.searchController,
    lifetime: "scoped",
    dependencies: [containerTokens.searchService],
    resolve: ({ resolve }) => new SearchController(resolve(containerTokens.searchService)),
  });
  container.register({
    token: containerTokens.contentSanitizationService,
    lifetime: "singleton",
    dependencies: [],
    resolve: () => new ContentSanitizationService(),
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
}
