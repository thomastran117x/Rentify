import { containerTokens } from "@/configuration/bootstrap/container";
import { buildApiPath } from "@/configuration/http/api-path";
import { BookingsController } from "@/features/bookings/bookings.controller";
import { FeatureFlagController } from "@/features/feature-flags/feature-flag.controller";
import { FeedbacksController } from "@/features/feedbacks/feedbacks.controller";
import { OrganizationBlogSearchController } from "@/features/organizations/blog-search/organization-blog-search.controller";
import { OrganizationsController } from "@/features/organizations/organizations.controller";
import { OrganizationsSearchController } from "@/features/organizations/search/organizations-search.controller";
import { PaymentsController } from "@/features/payments/payments.controller";
import { RentingsController } from "@/features/rentings/rentings.controller";
import { ReportsController } from "@/features/reports/reports.controller";
import { SmsController } from "@/features/sms/sms.controller";
import { createRouteTestApp } from "../../support/integration-app";

const serviceStub = new Proxy(
  {},
  {
    get: () => jest.fn(async () => undefined),
  },
);

function createApp(token: unknown, controller: unknown) {
  return createRouteTestApp(new Map([[token, controller]]));
}

describe("registered controller HTTP routes", () => {
  it.each([
    [
      "BookingsController",
      containerTokens.bookingsController,
      new BookingsController(serviceStub as any, serviceStub as any),
      "/booking-requests/me",
      "GET",
    ],
    [
      "FeatureFlagController",
      containerTokens.featureFlagController,
      new FeatureFlagController(serviceStub as any),
      "/admin/feature-flags",
      "GET",
    ],
    [
      "FeedbacksController",
      containerTokens.feedbacksController,
      new FeedbacksController(serviceStub as any, serviceStub as any),
      "/feedback",
      "POST",
    ],
    [
      "OrganizationBlogSearchController",
      containerTokens.organizationBlogSearchController,
      new OrganizationBlogSearchController(serviceStub as any),
      "/admin/organizations/blog-search/reindex",
      "POST",
    ],
    [
      "OrganizationsController",
      containerTokens.organizationsController,
      new OrganizationsController({
        listPublic: jest.fn(async () => ({
          organizations: [],
          pagination: {
            page: 1,
            pageSize: 20,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        })),
      } as any),
      "/organizations",
      "GET",
    ],
    [
      "OrganizationsSearchController",
      containerTokens.organizationsSearchController,
      new OrganizationsSearchController(serviceStub as any),
      "/admin/organizations/search/reindex",
      "POST",
    ],
    [
      "PaymentsController",
      containerTokens.paymentsController,
      new PaymentsController(serviceStub as any),
      "/booking-requests/booking-1/payment",
      "GET",
    ],
    [
      "RentingsController",
      containerTokens.rentingsController,
      new RentingsController(serviceStub as any, serviceStub as any),
      "/rentings/me",
      "GET",
    ],
    [
      "ReportsController",
      containerTokens.reportsController,
      new ReportsController(serviceStub as any),
      "/reports",
      "POST",
    ],
    [
      "SmsController",
      containerTokens.smsController,
      new SmsController(serviceStub as any),
      "/sms/webhooks/telnyx",
      "POST",
    ],
  ])(
    "routes %s through the production HTTP composition",
    async (_, token, controller, path, method) => {
      const app = createApp(token, controller);

      const response = await app.request(
        `http://rent.test${buildApiPath(path)}`,
        {
          method,
          headers: { "content-type": "application/json" },
          body: method === "POST" ? "{}" : undefined,
        },
      );

      expect(response.status).not.toBe(404);
      expect(response.status).toBeLessThan(500);
    },
  );
});
