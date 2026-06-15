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
import { FeedbacksController } from "@/features/feedbacks/feedbacks.controller";
import { FeedbacksRepository } from "@/features/feedbacks/feedbacks.repository";
import { FeedbacksService } from "@/features/feedbacks/feedbacks.service";
import { OrganizationsController } from "@/features/organizations/organizations.controller";
import { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { OrganizationsRepository } from "@/features/organizations/organizations.repository";
import { OrganizationsService } from "@/features/organizations/organizations.service";
import type { PaymentProviderAdapter } from "@/features/payments/payment-provider";
import { PaymentsController } from "@/features/payments/payments.controller";
import { PaymentsRepository } from "@/features/payments/payments.repository";
import { PaymentsService } from "@/features/payments/payments.service";
import { ProfileController } from "@/features/profile/profile.controller";
import { ProfileRepository } from "@/features/profile/profile.repository";
import { ProfileService } from "@/features/profile/profile.service";
import { ReportsController } from "@/features/reports/reports.controller";
import { ReportsRepository } from "@/features/reports/reports.repository";
import { ReportsService } from "@/features/reports/reports.service";
import { ReportsSearchIndexService } from "@/features/reports/search/index.service";
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
import { PostingsReviewsRepository } from "@/features/postings/reviews/reviews.repository";
import { PostingsReviewsService } from "@/features/postings/reviews/reviews.service";
import { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
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
import { createServiceToken } from "@/configuration/container/core";
import type { LoggerFactory } from "@/configuration/logging";

export const containerTokens = {
  loggerFactory: createServiceToken<LoggerFactory>("LoggerFactory"),
  cacheService: createServiceToken<CacheService>("CacheService"),
  emailQueueService: createServiceToken<EmailQueueService>("EmailQueueService"),
  emailDeliveryService: createServiceToken<EmailDeliveryService>(
    "EmailDeliveryService",
  ),
  emailService: createServiceToken<EmailService>("EmailService"),
  feedbacksRepository:
    createServiceToken<FeedbacksRepository>("FeedbacksRepository"),
  feedbacksService: createServiceToken<FeedbacksService>("FeedbacksService"),
  feedbacksController:
    createServiceToken<FeedbacksController>("FeedbacksController"),
  organizationsRepository: createServiceToken<OrganizationsRepository>(
    "OrganizationsRepository",
  ),
  organizationAccessService: createServiceToken<OrganizationAccessService>(
    "OrganizationAccessService",
  ),
  organizationsService: createServiceToken<OrganizationsService>(
    "OrganizationsService",
  ),
  organizationsController: createServiceToken<OrganizationsController>(
    "OrganizationsController",
  ),
  captchaService: createServiceToken<CaptchaService>("CaptchaService"),
  otpService: createServiceToken<OtpService>("OtpService"),
  oauthTokenVerifier:
    createServiceToken<OAuthTokenVerifier>("OAuthTokenVerifier"),
  googleOAuthService:
    createServiceToken<GoogleOAuthService>("GoogleOAuthService"),
  microsoftOAuthService: createServiceToken<MicrosoftOAuthService>(
    "MicrosoftOAuthService",
  ),
  appleOAuthService: createServiceToken<AppleOAuthService>("AppleOAuthService"),
  deviceRepository: createServiceToken<DeviceRepository>("DeviceRepository"),
  deviceService: createServiceToken<DeviceService>("DeviceService"),
  tokenService: createServiceToken<TokenService>("TokenService"),
  authRepository: createServiceToken<AuthRepository>("AuthRepository"),
  personalAccessTokenRepository:
    createServiceToken<PersonalAccessTokenRepository>(
      "PersonalAccessTokenRepository",
    ),
  personalAccessTokenService: createServiceToken<PersonalAccessTokenService>(
    "PersonalAccessTokenService",
  ),
  authService: createServiceToken<AuthService>("AuthService"),
  authController: createServiceToken<AuthController>("AuthController"),
  personalAccessTokenController:
    createServiceToken<PersonalAccessTokenController>(
      "PersonalAccessTokenController",
    ),
  blobService: createServiceToken<BlobService>("BlobService"),
  blobController: createServiceToken<BlobController>("BlobController"),
  bookingsRepository:
    createServiceToken<BookingsRepository>("BookingsRepository"),
  bookingsService: createServiceToken<BookingsService>("BookingsService"),
  bookingsController:
    createServiceToken<BookingsController>("BookingsController"),
  paymentsRepository:
    createServiceToken<PaymentsRepository>("PaymentsRepository"),
  paymentProvider:
    createServiceToken<PaymentProviderAdapter>("PaymentProvider"),
  paymentsService: createServiceToken<PaymentsService>("PaymentsService"),
  paymentsController:
    createServiceToken<PaymentsController>("PaymentsController"),
  profileRepository: createServiceToken<ProfileRepository>("ProfileRepository"),
  profileService: createServiceToken<ProfileService>("ProfileService"),
  profileController: createServiceToken<ProfileController>("ProfileController"),
  reportsRepository: createServiceToken<ReportsRepository>("ReportsRepository"),
  reportsSearchIndexService: createServiceToken<ReportsSearchIndexService>(
    "ReportsSearchIndexService",
  ),
  reportsService: createServiceToken<ReportsService>("ReportsService"),
  reportsController: createServiceToken<ReportsController>("ReportsController"),
  recommendationActivityQueueService:
    createServiceToken<RecommendationActivityQueueService>(
      "RecommendationActivityQueueService",
    ),
  recommendationActivityRepository:
    createServiceToken<RecommendationActivityRepository>(
      "RecommendationActivityRepository",
    ),
  recommendationActivityProcessor:
    createServiceToken<RecommendationActivityProcessor>(
      "RecommendationActivityProcessor",
    ),
  recommendationActivityPublisher:
    createServiceToken<RecommendationActivityPublisher>(
      "RecommendationActivityPublisher",
    ),
  recommendationPrecomputeRepository:
    createServiceToken<RecommendationPrecomputeRepository>(
      "RecommendationPrecomputeRepository",
    ),
  recommendationPrecomputeService:
    createServiceToken<RecommendationPrecomputeService>(
      "RecommendationPrecomputeService",
    ),
  recommendationQueryRepository:
    createServiceToken<RecommendationQueryRepository>(
      "RecommendationQueryRepository",
    ),
  recommendationQueryService: createServiceToken<RecommendationQueryService>(
    "RecommendationQueryService",
  ),
  recommendationsController: createServiceToken<RecommendationsController>(
    "RecommendationsController",
  ),
  postingsRepository:
    createServiceToken<PostingsRepository>("PostingsRepository"),
  rentingsRepository:
    createServiceToken<RentingsRepository>("RentingsRepository"),
  rentingsService: createServiceToken<RentingsService>("RentingsService"),
  rentingsController:
    createServiceToken<RentingsController>("RentingsController"),
  postingsAnalyticsRepository: createServiceToken<PostingsAnalyticsRepository>(
    "PostingsAnalyticsRepository",
  ),
  postingsAnalyticsService: createServiceToken<PostingsAnalyticsService>(
    "PostingsAnalyticsService",
  ),
  postingsReviewsRepository: createServiceToken<PostingsReviewsRepository>(
    "PostingsReviewsRepository",
  ),
  postingsReviewsService: createServiceToken<PostingsReviewsService>(
    "PostingsReviewsService",
  ),
  postingsPublicCacheService: createServiceToken<PostingsPublicCacheService>(
    "PostingsPublicCacheService",
  ),
  postingsPublicAutocompleteService:
    createServiceToken<PostingsPublicAutocompleteService>(
      "PostingsPublicAutocompleteService",
    ),
  postingsPublicSearchService: createServiceToken<PostingsPublicSearchService>(
    "PostingsPublicSearchService",
  ),
  postingsSearchIndexService: createServiceToken<PostingsSearchIndexService>(
    "PostingsSearchIndexService",
  ),
  postingThumbnailQueueService:
    createServiceToken<PostingThumbnailQueueService>(
      "PostingThumbnailQueueService",
    ),
  postingThumbnailService: createServiceToken<PostingThumbnailService>(
    "PostingThumbnailService",
  ),
  searchQueueService:
    createServiceToken<SearchQueueService>("SearchQueueService"),
  searchService: createServiceToken<SearchService>("SearchService"),
  searchController: createServiceToken<SearchController>("SearchController"),
  contentSanitizationService: createServiceToken<ContentSanitizationService>(
    "ContentSanitizationService",
  ),
  postingsService: createServiceToken<PostingsService>("PostingsService"),
  postingsController:
    createServiceToken<PostingsController>("PostingsController"),
} as const;
