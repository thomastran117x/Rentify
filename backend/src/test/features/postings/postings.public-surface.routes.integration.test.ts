import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { PostingsController } from "@/features/postings/postings.controller";
import { RecommendationsController } from "@/features/recommendations/recommendations.controller";
import { createRouteTestApp } from "../../support/integration-app";

function createPosting() {
  return {
    id: "posting-1",
    organizationId: "org-1",
    status: "published",
    variant: {
      family: "place",
      subtype: "workspace",
    },
    name: "Sunny loft",
    description: "Bright loft with workspace",
    pricing: {
      currency: "CAD",
      daily: {
        amount: 150,
      },
    },
    pricingCurrency: "CAD",
    photos: [],
    tags: ["loft"],
    details: {
      guest_capacity: 4,
      property_type: "loft",
      amenities: ["wifi"],
    },
    availabilityStatus: "available",
    effectiveMaxBookingDurationDays: 30,
    availabilityBlocks: [],
    location: {
      latitude: 43.65,
      longitude: -79.38,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    publishedAt: "2026-05-01T00:00:00.000Z",
  };
}

function createApp() {
  const postingsService = {};
  const postingsPublicAutocompleteService = {
    autocompletePublic: jest.fn(async () => ({
      query: "lo",
      suggestions: [
        {
          value: "Sunny loft",
          kind: "name" as const,
        },
      ],
      source: "elasticsearch" as const,
    })),
  };
  const postingsAnalyticsService = {};
  const postingsReviewsService = {};
  const recommendationActivityPublisher = {};
  const recommendationQueryService = {
    getRecommendations: jest.fn(async () => ({
      postings: [createPosting()],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      mode: "popular" as const,
      fallback: "no_history" as const,
      snapshotGeneratedAt: "2026-05-20T00:00:00.000Z",
    })),
  };

  const registry = new Map<unknown, unknown>([
    [
      containerTokens.postingsController,
      new PostingsController(
        postingsService as any,
        postingsPublicAutocompleteService as any,
        postingsAnalyticsService as any,
        postingsReviewsService as any,
        {} as any,
        recommendationActivityPublisher as any,
      ),
    ],
    [
      containerTokens.recommendationsController,
      new RecommendationsController(recommendationQueryService as any),
    ],
  ]);

  return {
    app: createRouteTestApp(registry),
    postingsPublicAutocompleteService,
    recommendationQueryService,
  };
}

describe("Postings public surface integration", () => {
  it("covers autocomplete and recommendations endpoints", async () => {
    const {
      app,
      postingsPublicAutocompleteService,
      recommendationQueryService,
    } = createApp();

    const autocompleteResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/autocomplete?q=lo&limit=5")}`,
    );
    const recommendationsResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/recommendations?page=1&pageSize=10&family=place&subtype=workspace")}`,
    );

    expect(autocompleteResponse.status).toBe(200);
    expect(recommendationsResponse.status).toBe(200);
    expect(
      postingsPublicAutocompleteService.autocompletePublic,
    ).toHaveBeenCalledWith({
      query: "lo",
      family: undefined,
      subtype: undefined,
      limit: 5,
    });
    expect(recommendationQueryService.getRecommendations).toHaveBeenCalledWith(
      {
        page: 1,
        pageSize: 10,
        family: "place",
        subtype: "workspace",
        geo: undefined,
        availabilityWindow: undefined,
      },
      null,
    );
  });
});
