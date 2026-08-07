import { containerTokens } from "@/configuration/bootstrap/container";
import type { BookingsController } from "@/features/bookings/bookings.controller";
import type { PostingsController } from "@/features/postings/postings.controller";
import type { RecommendationsController } from "@/features/recommendations/recommendations.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const postingsOwnerRouteModule: RouteModule = {
  id: "postings-owner",
  register(app, { resolveHandler }) {
    app.post(
      "/postings",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "create",
      ),
    );
    app.get(
      "/postings/me",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "listMine",
      ),
    );
    app.get(
      "/postings/me/summary",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "statusSummary",
      ),
    );
    app.get(
      "/postings/me/batch",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "batchMine",
      ),
    );
    app.put(
      "/postings/:id",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "update",
      ),
    );
    app.post(
      "/postings/:id/duplicate",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "duplicate",
      ),
    );
    app.post(
      "/postings/:id/publish",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "publish",
      ),
    );
    app.post(
      "/postings/:id/pause",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "pause",
      ),
    );
    app.post(
      "/postings/:id/unpause",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "unpause",
      ),
    );
    app.post(
      "/postings/:id/archive",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "archive",
      ),
    );
  },
};

export const postingsAnalyticsRouteModule: RouteModule = {
  id: "postings-analytics",
  register(app, { resolveHandler }) {
    app.get(
      "/postings/analytics/summary",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "analyticsSummary",
      ),
    );
    app.get(
      "/postings/analytics/postings",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "analyticsPostings",
      ),
    );
    app.get(
      "/postings/analytics/export",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "exportAnalytics",
      ),
    );
    app.get(
      "/postings/:id/analytics",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "analyticsById",
      ),
    );
  },
};

export const postingsReviewsRouteModule: RouteModule = {
  id: "postings-reviews",
  register(app, { resolveHandler }) {
    app.get(
      "/postings/:id/reviews",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "listReviews",
      ),
    );
    // Authenticated reviewer state: eligibility plus the caller's own review,
    // so the client can open its form in create or edit mode.
    app.get(
      "/postings/:id/reviews/me",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "getOwnReview",
      ),
    );
    app.post(
      "/postings/:id/reviews",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "createReview",
      ),
    );
    app.put(
      "/postings/:id/reviews/me",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "updateOwnReview",
      ),
    );
  },
};

export const postingsAvailabilityRouteModule: RouteModule = {
  id: "postings-availability",
  register(app, { resolveHandler }) {
    app.get(
      "/postings/:id/availability-calendar",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "getAvailabilityCalendar",
      ),
    );
    app.get(
      "/postings/:id/availability-blocks",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "listAvailabilityBlocks",
      ),
    );
    app.post(
      "/postings/:id/availability-blocks",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "createAvailabilityBlock",
      ),
    );
    app.put(
      "/postings/:id/availability-blocks/:blockId",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "updateAvailabilityBlock",
      ),
    );
    app.delete(
      "/postings/:id/availability-blocks/:blockId",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "deleteAvailabilityBlock",
      ),
    );
  },
};

export const postingsSeasonalPricingRouteModule: RouteModule = {
  id: "postings-seasonal-pricing",
  register(app, { resolveHandler }) {
    app.get(
      "/postings/:id/seasonal-pricing",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "listSeasonalPricing",
      ),
    );
    app.post(
      "/postings/:id/seasonal-pricing",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "createSeasonalPricingRule",
      ),
    );
    app.patch(
      "/postings/:id/seasonal-pricing/:ruleId",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "updateSeasonalPricingRule",
      ),
    );
    app.delete(
      "/postings/:id/seasonal-pricing/:ruleId",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "deleteSeasonalPricingRule",
      ),
    );
  },
};

export const postingsActivityRouteModule: RouteModule = {
  id: "postings-activity",
  register(app, { resolveHandler }) {
    app.post(
      "/postings/:id/activity/search-click",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "trackSearchClick",
      ),
    );
  },
};

export const postingsSavedRouteModule: RouteModule = {
  id: "postings-saved",
  register(app, { resolveHandler }) {
    // This module is registered before `postings-public` on purpose: `saved`
    // is a syntactically valid posting identifier, so `GET /postings/:id`
    // would otherwise swallow the two static routes below and 404.
    app.get(
      "/postings/saved",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "listSaved",
      ),
    );
    app.get(
      "/postings/saved/ids",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "listSavedIds",
      ),
    );
    app.post(
      "/postings/:id/save",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "save",
      ),
    );
    app.delete(
      "/postings/:id/save",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "unsave",
      ),
    );
  },
};

export const postingsPublicRouteModule: RouteModule = {
  id: "postings-public",
  register(app, { resolveHandler }) {
    app.get(
      "/postings",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "search",
      ),
    );
    app.get(
      "/postings/autocomplete",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "autocomplete",
      ),
    );
    app.get(
      "/postings/recommendations",
      resolveHandler<RecommendationsController>(
        containerTokens.recommendationsController,
        "list",
      ),
    );
    app.get(
      "/postings/batch",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "batchPublic",
      ),
    );
    app.get(
      "/postings/:id",
      resolveHandler<PostingsController>(
        containerTokens.postingsController,
        "getById",
      ),
    );
  },
};
