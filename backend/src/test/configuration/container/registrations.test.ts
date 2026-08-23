import {
  containerTokens,
  createRootContainer,
} from "@/configuration/bootstrap/container";
import {
  connectElasticsearch,
  disconnectElasticsearch,
} from "@/configuration/resources/elasticsearch";
import {
  CONTAINER_REGISTRATION_MODULE_IDS,
  containerRegistrationModules,
  registerApplicationServices,
} from "@/configuration/container/registrations";
import { LocalAuthController } from "@/features/auth/local/local-auth.controller";
import { AuthSessionController } from "@/features/auth/session/session.controller";
import { DeviceManagementController } from "@/features/auth/device/device-management.controller";
import { LoginLockoutController } from "@/features/auth/lockout/login-lockout.controller";
import { OAuthController } from "@/features/auth/oauth/oauth.controller";
import { PasswordController } from "@/features/auth/password/password.controller";
import { UsernameController } from "@/features/auth/username/username.controller";
import { BlobController } from "@/features/blob/blob.controller";
import { BookingsController } from "@/features/bookings/bookings.controller";
import { FeedbacksController } from "@/features/feedbacks/feedbacks.controller";
import { PaymentsController } from "@/features/payments/payments.controller";
import { SmsController } from "@/features/sms/sms.controller";
import { PostingsController } from "@/features/postings/postings.controller";
import { ProfileController } from "@/features/profile/profile.controller";
import { ReportsController } from "@/features/reports/reports.controller";
import { RecommendationsController } from "@/features/recommendations/recommendations.controller";
import { RentingsController } from "@/features/rentings/rentings.controller";
import { SearchController } from "@/features/search/search.controller";
import { OrganizationsController } from "@/features/organizations/organizations.controller";

jest.mock("@/configuration/resources/database", () => ({
  getDatabaseClient: () => ({}),
}));

function createConfiguredContainer() {
  const container = createRootContainer();
  registerApplicationServices(container);
  return container;
}

describe("container registrations", () => {
  it("includes every registration module id exactly once", () => {
    const moduleIds = containerRegistrationModules.map((module) => module.id);

    expect(moduleIds).toEqual([...CONTAINER_REGISTRATION_MODULE_IDS]);
    expect(new Set(moduleIds).size).toBe(moduleIds.length);
  });

  it("registers a valid application dependency graph", () => {
    const container = createConfiguredContainer();

    expect(() => container.validate()).not.toThrow();
  });

  it("resolves representative controllers across modules from a request scope", async () => {
    await connectElasticsearch();
    const container = createConfiguredContainer();
    const scope = container.createScope();

    try {
      // The auth surface is spread across seven controllers, so each one is
      // resolved here rather than trusting that one of them standing in proves
      // the others are wired.
      expect(scope.resolve(containerTokens.localAuthController)).toBeInstanceOf(
        LocalAuthController,
      );
      expect(scope.resolve(containerTokens.passwordController)).toBeInstanceOf(
        PasswordController,
      );
      expect(
        scope.resolve(containerTokens.loginLockoutController),
      ).toBeInstanceOf(LoginLockoutController);
      expect(scope.resolve(containerTokens.usernameController)).toBeInstanceOf(
        UsernameController,
      );
      expect(scope.resolve(containerTokens.oauthController)).toBeInstanceOf(
        OAuthController,
      );
      expect(
        scope.resolve(containerTokens.authSessionController),
      ).toBeInstanceOf(AuthSessionController);
      expect(
        scope.resolve(containerTokens.deviceManagementController),
      ).toBeInstanceOf(DeviceManagementController);
      expect(scope.resolve(containerTokens.reportsController)).toBeInstanceOf(
        ReportsController,
      );
      expect(scope.resolve(containerTokens.feedbacksController)).toBeInstanceOf(
        FeedbacksController,
      );
      expect(
        scope.resolve(containerTokens.recommendationsController),
      ).toBeInstanceOf(RecommendationsController);
      expect(scope.resolve(containerTokens.postingsController)).toBeInstanceOf(
        PostingsController,
      );
      expect(scope.resolve(containerTokens.bookingsController)).toBeInstanceOf(
        BookingsController,
      );
      expect(scope.resolve(containerTokens.smsController)).toBeInstanceOf(
        SmsController,
      );
      expect(scope.resolve(containerTokens.paymentsController)).toBeInstanceOf(
        PaymentsController,
      );
      expect(scope.resolve(containerTokens.rentingsController)).toBeInstanceOf(
        RentingsController,
      );
      expect(scope.resolve(containerTokens.searchController)).toBeInstanceOf(
        SearchController,
      );
      expect(scope.resolve(containerTokens.profileController)).toBeInstanceOf(
        ProfileController,
      );
      expect(
        scope.resolve(containerTokens.organizationsController),
      ).toBeInstanceOf(OrganizationsController);
      expect(scope.resolve(containerTokens.blobController)).toBeInstanceOf(
        BlobController,
      );
    } finally {
      await container.dispose();
      await disconnectElasticsearch();
    }
  });

  it("reuses scoped controllers within a scope and isolates them across scopes", async () => {
    const container = createConfiguredContainer();
    const firstScope = container.createScope();
    const secondScope = container.createScope();

    try {
      const first = firstScope.resolve(containerTokens.localAuthController);
      const second = firstScope.resolve(containerTokens.localAuthController);
      const third = secondScope.resolve(containerTokens.localAuthController);

      expect(first).toBe(second);
      expect(first).not.toBe(third);
    } finally {
      await container.dispose();
    }
  });
});
