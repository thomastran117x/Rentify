import { authCoreRegistrationModule } from "@/configuration/container/registrations/modules/auth-core";
import { authDeviceRegistrationModule } from "@/configuration/container/registrations/modules/auth-device";
import { authLocalRegistrationModule } from "@/configuration/container/registrations/modules/auth-local";
import { authMfaTotpRegistrationModule } from "@/configuration/container/registrations/modules/auth-mfa-totp";
import { authMfaVerificationRegistrationModule } from "@/configuration/container/registrations/modules/auth-mfa-verification";
import { authOauthRegistrationModule } from "@/configuration/container/registrations/modules/auth-oauth";
import { authOtpRegistrationModule } from "@/configuration/container/registrations/modules/auth-otp";
import { authPersonalAccessTokensRegistrationModule } from "@/configuration/container/registrations/modules/auth-personal-access-tokens";
import { blobRegistrationModule } from "@/configuration/container/registrations/modules/blob";
import { bookingsRegistrationModule } from "@/configuration/container/registrations/modules/bookings";
import { feedbacksRegistrationModule } from "@/configuration/container/registrations/modules/feedbacks";
import { featureFlagsRegistrationModule } from "@/configuration/container/registrations/modules/feature-flags";
import { organizationsRegistrationModule } from "@/configuration/container/registrations/modules/organizations";
import { organizationsSearchRegistrationModule } from "@/configuration/container/registrations/modules/organizations-search";
import { organizationsBlogSearchRegistrationModule } from "@/configuration/container/registrations/modules/organizations-blog-search";
import { paymentsRegistrationModule } from "@/configuration/container/registrations/modules/payments";
import { postingsAnalyticsRegistrationModule } from "@/configuration/container/registrations/modules/postings-analytics";
import { postingsCoreRegistrationModule } from "@/configuration/container/registrations/modules/postings-core";
import { postingsReviewsRegistrationModule } from "@/configuration/container/registrations/modules/postings-reviews";
import { postingsSavedRegistrationModule } from "@/configuration/container/registrations/modules/postings-saved";
import { postingsSearchRegistrationModule } from "@/configuration/container/registrations/modules/postings-search";
import { postingsThumbnailRegistrationModule } from "@/configuration/container/registrations/modules/postings-thumbnail";
import { profileRegistrationModule } from "@/configuration/container/registrations/modules/profile";
import { recommendationsActivityRegistrationModule } from "@/configuration/container/registrations/modules/recommendations-activity";
import { recommendationsPrecomputeRegistrationModule } from "@/configuration/container/registrations/modules/recommendations-precompute";
import { recommendationsQueryRegistrationModule } from "@/configuration/container/registrations/modules/recommendations-query";
import { rentingsRegistrationModule } from "@/configuration/container/registrations/modules/rentings";
import { reportsRegistrationModule } from "@/configuration/container/registrations/modules/reports";
import { searchRegistrationModule } from "@/configuration/container/registrations/modules/search";
import { securityRegistrationModule } from "@/configuration/container/registrations/modules/security";
import { sharedRegistrationModule } from "@/configuration/container/registrations/modules/shared";
import { smsRegistrationModule } from "@/configuration/container/registrations/modules/sms";
import { usernameBloomRegistrationModule } from "@/configuration/container/registrations/modules/username-bloom";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";

export { CONTAINER_REGISTRATION_MODULE_IDS } from "@/configuration/container/registrations/types";
export type {
  ContainerRegistrationModule,
  ContainerRegistrationModuleId,
} from "@/configuration/container/registrations/types";

export const containerRegistrationModules: ContainerRegistrationModule[] = [
  sharedRegistrationModule,
  smsRegistrationModule,
  securityRegistrationModule,
  blobRegistrationModule,
  usernameBloomRegistrationModule,
  profileRegistrationModule,
  feedbacksRegistrationModule,
  authOtpRegistrationModule,
  authMfaTotpRegistrationModule,
  authMfaVerificationRegistrationModule,
  authCoreRegistrationModule,
  authOauthRegistrationModule,
  authDeviceRegistrationModule,
  authLocalRegistrationModule,
  authPersonalAccessTokensRegistrationModule,
  organizationsRegistrationModule,
  organizationsSearchRegistrationModule,
  organizationsBlogSearchRegistrationModule,
  reportsRegistrationModule,
  recommendationsActivityRegistrationModule,
  recommendationsPrecomputeRegistrationModule,
  postingsCoreRegistrationModule,
  postingsAnalyticsRegistrationModule,
  postingsReviewsRegistrationModule,
  postingsSavedRegistrationModule,
  postingsSearchRegistrationModule,
  postingsThumbnailRegistrationModule,
  recommendationsQueryRegistrationModule,
  searchRegistrationModule,
  paymentsRegistrationModule,
  bookingsRegistrationModule,
  rentingsRegistrationModule,
  featureFlagsRegistrationModule,
];
