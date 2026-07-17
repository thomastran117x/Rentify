import { Hono } from "hono";
import { mountRoutes } from "@/configuration/bootstrap/routes";
import { buildApiPath } from "@/configuration/http/api-path";
import {
  containerTokens,
  type ServiceContainer,
} from "@/configuration/bootstrap/container";
import type { AppBindings } from "@/configuration/http/bindings";
import { clientContextMiddleware } from "@/configuration/middlewares/client-context.middleware";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { outputFormatMiddleware } from "@/configuration/middlewares/output-format.middleware";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { PostingsController } from "@/features/postings/postings.controller";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import BadRequestError from "@/errors/http/bad-request.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { createPatPrincipal } from "../../support/integration-app";

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "owner-1",
    email: "owner@example.com",
    role: "owner",
    deviceId: "device-1",
    tokenVersion: 1,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createPosting(overrides: Record<string, unknown> = {}) {
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
    instantBooking: false,
    reviewCount: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    publishedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createAvailabilityBlock(overrides: Record<string, unknown> = {}) {
  return {
    id: "block-1",
    startAt: "2026-06-01T00:00:00.000Z",
    endAt: "2026-06-03T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createReview(overrides: Record<string, unknown> = {}) {
  return {
    id: "review-1",
    postingId: "posting-1",
    reviewerId: "user-1",
    rating: 5,
    title: "Great stay",
    comment: "Exactly as described.",
    reviewer: {
      username: "renter-one",
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createOwnerListingResult() {
  return {
    postings: [createPosting()],
    pagination: {
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    status: "published",
  };
}

function createPublicSearchResult(overrides: Record<string, unknown> = {}) {
  return {
    postings: [createPosting()],
    pagination: {
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    source: "elasticsearch" as const,
    query: "loft",
    ...overrides,
  };
}

class FakeRequestContainer implements ServiceContainer {
  private readonly contentSanitizationService =
    new ContentSanitizationService();

  constructor(
    private readonly postingsController: PostingsController,
    private readonly tokenService: {
      verifyAccessToken(token: string): Promise<JwtClaims>;
    },
    private readonly personalAccessTokenService: {
      authenticateToken(
        token: string,
      ): Promise<ReturnType<typeof createPatPrincipal>>;
    },
  ) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.postingsController) {
      return this.postingsController as TValue;
    }

    if (token === containerTokens.tokenService) {
      return this.tokenService as TValue;
    }

    if (token === containerTokens.personalAccessTokenService) {
      return this.personalAccessTokenService as TValue;
    }

    if (token === containerTokens.contentSanitizationService) {
      return this.contentSanitizationService as TValue;
    }

    throw new Error("Unsupported test container token.");
  }

  createScope(): ServiceContainer {
    return this;
  }

  async dispose(): Promise<void> {}
}

function createApp() {
  const postingsService = {
    createDraft: jest.fn(async () => ({
      ...createPosting({
        status: "draft",
      }),
    })),
    update: jest.fn(async () =>
      createPosting({
        name: "Updated name",
      }),
    ),
    duplicate: jest.fn(async () =>
      createPosting({
        id: "posting-2",
        status: "draft",
      }),
    ),
    publish: jest.fn(async () => createPosting()),
    pause: jest.fn(async () =>
      createPosting({
        status: "paused",
        pausedAt: "2026-05-02T00:00:00.000Z",
      }),
    ),
    unpause: jest.fn(async () => createPosting()),
    archive: jest.fn(async () =>
      createPosting({
        status: "archived",
        archivedAt: "2026-05-03T00:00:00.000Z",
      }),
    ),
    getById: jest.fn(async () => createPosting()),
    listByOwner: jest.fn(async () => createOwnerListingResult()),
    getOwnerStatusSummary: jest.fn(async () => ({
      total: 7,
      byStatus: { draft: 2, published: 3, paused: 1, archived: 1 },
    })),
    batchByOwner: jest.fn(async () => ({
      postings: [createPosting()],
      missingIds: ["posting-missing"],
    })),
    batchPublic: jest.fn(async () => ({
      postings: [createPosting()],
      missingIds: ["posting-missing"],
    })),
    searchPublic: jest.fn(async () => ({
      postings: [createPosting()],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 6,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      source: "elasticsearch" as const,
      query: "loft",
    })),
    listOwnerAvailabilityBlocks: jest.fn(async () => ({
      availabilityBlocks: [createAvailabilityBlock()],
    })),
    createOwnerAvailabilityBlock: jest.fn(async () =>
      createAvailabilityBlock(),
    ),
    updateOwnerAvailabilityBlock: jest.fn(async () =>
      createAvailabilityBlock({
        note: "Updated block",
      }),
    ),
    deleteOwnerAvailabilityBlock: jest.fn(async () => undefined),
  };

  const postingsAnalyticsService = {
    trackPublicView: jest.fn(async () => undefined),
    trackSearchImpressions: jest.fn(async () => undefined),
    trackSearchClick: jest.fn(async () => undefined),
    getOwnerSummary: jest.fn(async () => ({
      window: "30d",
      totals: {
        searchImpressions: 100,
      },
    })),
    listOwnerPostingsAnalytics: jest.fn(async () => ({
      window: "7d",
      postings: [
        {
          postingId: "posting-1",
          name: "Sunny loft",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      dataAvailability: {
        isPartial: false,
      },
      range: {
        endAt: "2026-05-20T00:00:00.000Z",
      },
    })),
    getPostingAnalyticsDetail: jest.fn(
      async (input: { window: string; granularity: string }) => {
        if (input.window !== "7d" && input.granularity === "hour") {
          throw new BadRequestError(
            "Hourly analytics are only supported for the 7d window.",
          );
        }

        return {
          postingId: "posting-1",
          name: "Sunny loft",
          status: "published",
          window: input.window,
          granularity: input.granularity,
          totals: {
            views: 10,
          },
          derivedMetrics: {
            ctr: 0.2,
          },
          buckets: [],
          dataAvailability: {
            isPartial: false,
          },
          range: {
            endAt: "2026-05-20T00:00:00.000Z",
          },
        };
      },
    ),
    exportAsCsv: jest.fn(
      async () =>
        "date,postingId,postingName,searchImpressions\n2026-06-01,posting-1,Sunny loft,42",
    ),
  };

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

  const postingsReviewsService = {
    list: jest.fn(async () => ({
      reviews: [createReview()],
      summary: {
        averageRating: 5,
        reviewCount: 1,
      },
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    create: jest.fn(async () => createReview()),
    updateOwn: jest.fn(async () =>
      createReview({
        comment: "Updated review",
      }),
    ),
  };

  const recommendationActivityPublisher = {
    publishPostingLifecycle: jest.fn(async () => undefined),
    publishPostingView: jest.fn(async () => undefined),
    publishSearchClick: jest.fn(async () => undefined),
  };

  const seasonalPricingService = {
    list: jest.fn(async () => []),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const controller = new PostingsController(
    postingsService as any,
    postingsPublicAutocompleteService as any,
    postingsAnalyticsService as any,
    postingsReviewsService as any,
    seasonalPricingService as any,
    recommendationActivityPublisher as any,
  );
  const tokenService = {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token === "owner-token") {
        return createClaims();
      }

      if (token === "user-token") {
        return createClaims({
          sub: "user-1",
          email: "user@example.com",
          role: "user",
        });
      }

      throw new UnauthorizedError("Invalid access token signature.");
    }),
  };
  const personalAccessTokenService = {
    authenticateToken: jest.fn(async () => createPatPrincipal()),
  };
  const container = new FakeRequestContainer(
    controller,
    tokenService,
    personalAccessTokenService,
  );
  const app = new Hono<AppBindings>();

  app.use("*", clientContextMiddleware);
  app.use("*", async (context, next) => {
    context.set("container", container);
    await next();
  });
  app.use("*", outputFormatMiddleware);
  app.onError(handleApplicationError);
  mountRoutes(app);

  return {
    app,
    postingsService,
    postingsAnalyticsService,
    postingsPublicAutocompleteService,
    postingsReviewsService,
    recommendationActivityPublisher,
    tokenService,
    personalAccessTokenService,
  };
}

function ownerHeaders() {
  return {
    authorization: "Bearer owner-token",
    "content-type": "application/json",
  };
}

function userHeaders() {
  return {
    authorization: "Bearer user-token",
    "content-type": "application/json",
  };
}

function createPostingBody() {
  return {
    variant: {
      family: "place",
      subtype: "workspace",
    },
    name: "Sunny loft",
    description: "Bright loft with workspace",
    pricing: {
      currency: "cad",
      daily: {
        amount: 150,
      },
    },
    photos: [
      {
        blobUrl: "https://example.blob.core.windows.net/postings/photo-1.jpg",
        blobName: "postings/photo-1.jpg",
        position: 0,
      },
    ],
    tags: ["loft"],
    details: {
      guest_capacity: 4,
      property_type: "loft",
      amenities: ["wifi"],
    },
    availabilityStatus: "available",
    availabilityBlocks: [],
    location: {
      latitude: 43.7,
      longitude: -79.4,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
    },
  };
}

function createUpdatePostingBody() {
  const { availabilityBlocks, ...body } = createPostingBody();
  void availabilityBlocks;
  return body;
}

describe("Postings integration", () => {
  it("serves public search and detail flows with real route wiring", async () => {
    const {
      app,
      postingsService,
      postingsAnalyticsService,
      recommendationActivityPublisher,
    } = createApp();

    const searchResponse = await app.request(
      `http://rent.test${buildApiPath("/postings?page=2&pageSize=5&q=loft&family=place&subtype=workspace")}`,
    );

    expect(postingsService.searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        pageSize: 5,
        query: "loft",
        family: "place",
        subtype: "workspace",
      }),
    );
    expect(
      postingsAnalyticsService.trackSearchImpressions,
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "posting-1",
      }),
    ]);
    expect(searchResponse.status).toBe(200);
    await expect(searchResponse.json()).resolves.toEqual({
      success: true,
      data: {
        postings: [expect.objectContaining({ id: "posting-1" })],
        pagination: {
          page: 2,
          pageSize: 5,
          total: 6,
          totalPages: 2,
          hasNextPage: false,
          hasPreviousPage: true,
        },
        source: "elasticsearch",
        query: "loft",
      },
      error: null,
      message: "Request completed successfully.",
      meta: {
        requestId: "unknown",
        pagination: {
          page: 2,
          pageSize: 5,
          total: 6,
          totalPages: 2,
          hasNextPage: false,
          hasPreviousPage: true,
        },
        source: "elasticsearch",
      },
    });

    const detailResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1")}`,
    );

    expect(postingsService.getById).toHaveBeenCalledWith(
      "posting-1",
      undefined,
    );
    expect(postingsAnalyticsService.trackPublicView).toHaveBeenCalledTimes(1);
    expect(
      recommendationActivityPublisher.publishPostingView,
    ).toHaveBeenCalledTimes(1);
    expect(detailResponse.status).toBe(200);
  });

  it("preserves relevance-ranked public search results and metadata through the route layer", async () => {
    const { app, postingsService, postingsAnalyticsService } = createApp();
    postingsService.searchPublic.mockResolvedValueOnce(
      createPublicSearchResult({
        postings: [
          createPosting({
            id: "posting-exact",
            name: "Saint-Roch Production Flat",
            tags: ["quebec-city", "flat", "production"],
            location: {
              latitude: 46.81,
              longitude: -71.22,
              city: "Quebec City",
              region: "Quebec",
              country: "Canada",
            },
          }),
          createPosting({
            id: "posting-broad",
            name: "Gastown Production Loft",
            tags: ["vancouver", "loft", "production"],
            location: {
              latitude: 49.28,
              longitude: -123.11,
              city: "Vancouver",
              region: "British Columbia",
              country: "Canada",
            },
          }),
        ],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        query: "Saint-Roch Production Flat",
      }),
    );

    const response = await app.request(
      `http://rent.test${buildApiPath("/postings?page=1&pageSize=20&q=Saint-Roch%20Production%20Flat")}`,
    );

    expect(postingsService.searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        query: "Saint-Roch Production Flat",
        sort: "relevance",
      }),
    );
    expect(
      postingsAnalyticsService.trackSearchImpressions,
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "posting-exact",
        name: "Saint-Roch Production Flat",
      }),
      expect.objectContaining({
        id: "posting-broad",
        name: "Gastown Production Loft",
      }),
    ]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        postings: [
          {
            id: "posting-exact",
            name: "Saint-Roch Production Flat",
          },
          {
            id: "posting-broad",
            name: "Gastown Production Loft",
          },
        ],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        source: "elasticsearch",
        query: "Saint-Roch Production Flat",
      },
      error: null,
      message: "Request completed successfully.",
      meta: {
        requestId: "unknown",
        pagination: {
          page: 1,
          pageSize: 20,
          total: 2,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        source: "elasticsearch",
      },
    });
  });

  it("handles owner lifecycle, owner listings, and batch endpoints", async () => {
    const { app, postingsService, recommendationActivityPublisher } =
      createApp();

    const createResponse = await app.request(
      `http://rent.test${buildApiPath("/postings")}`,
      {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify(createPostingBody()),
      },
    );
    const updateResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1")}`,
      {
        method: "PUT",
        headers: ownerHeaders(),
        body: JSON.stringify(createUpdatePostingBody()),
      },
    );
    const duplicateResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/duplicate")}`,
      {
        method: "POST",
        headers: ownerHeaders(),
      },
    );
    const publishResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/publish")}`,
      {
        method: "POST",
        headers: ownerHeaders(),
      },
    );
    const pauseResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/pause")}`,
      {
        method: "POST",
        headers: ownerHeaders(),
      },
    );
    const unpauseResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/unpause")}`,
      {
        method: "POST",
        headers: ownerHeaders(),
      },
    );
    const archiveResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/archive")}`,
      {
        method: "POST",
        headers: ownerHeaders(),
      },
    );
    const listMineResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/me?page=1&pageSize=20&status=published")}`,
      {
        headers: ownerHeaders(),
      },
    );
    const summaryResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/me/summary")}`,
      {
        headers: ownerHeaders(),
      },
    );
    const searchMineResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/me?page=1&pageSize=20&q=studio")}`,
      {
        headers: ownerHeaders(),
      },
    );
    const batchMineResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/me/batch?ids=posting-1,posting-missing")}`,
      {
        headers: ownerHeaders(),
      },
    );
    const batchPublicResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/batch?ids=posting-1,posting-missing")}`,
    );

    expect(createResponse.status).toBe(201);
    expect(updateResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(201);
    expect(publishResponse.status).toBe(200);
    expect(pauseResponse.status).toBe(200);
    expect(unpauseResponse.status).toBe(200);
    expect(archiveResponse.status).toBe(200);
    expect(listMineResponse.status).toBe(200);
    expect(summaryResponse.status).toBe(200);
    expect(searchMineResponse.status).toBe(200);
    expect(batchMineResponse.status).toBe(200);
    expect(batchPublicResponse.status).toBe(200);

    expect(postingsService.listByOwner).toHaveBeenCalledWith("owner-1", {
      page: 1,
      pageSize: 20,
      status: "published",
    });
    expect(postingsService.listByOwner).toHaveBeenCalledWith("owner-1", {
      page: 1,
      pageSize: 20,
      status: undefined,
      q: "studio",
    });
    expect(postingsService.getOwnerStatusSummary).toHaveBeenCalledWith(
      "owner-1",
    );
    await expect(summaryResponse.json()).resolves.toMatchObject({
      success: true,
      data: {
        total: 7,
        byStatus: { draft: 2, published: 3, paused: 1, archived: 1 },
      },
    });
    expect(postingsService.batchByOwner).toHaveBeenCalledWith("owner-1", [
      "posting-1",
      "posting-missing",
    ]);
    expect(postingsService.batchPublic).toHaveBeenCalledWith([
      "posting-1",
      "posting-missing",
    ]);
    expect(
      recommendationActivityPublisher.publishPostingLifecycle,
    ).toHaveBeenCalledTimes(4);
  });

  it("handles availability, reviews, analytics, and search click flows", async () => {
    const {
      app,
      postingsService,
      postingsReviewsService,
      postingsAnalyticsService,
      recommendationActivityPublisher,
    } = createApp();

    const listAvailabilityResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/availability-blocks")}`,
      {
        headers: ownerHeaders(),
      },
    );
    const createAvailabilityResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/availability-blocks")}`,
      {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({
          startAt: "2026-06-01T00:00:00.000Z",
          endAt: "2026-06-03T00:00:00.000Z",
          note: "Maintenance",
        }),
      },
    );
    const updateAvailabilityResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/availability-blocks/block-1")}`,
      {
        method: "PUT",
        headers: ownerHeaders(),
        body: JSON.stringify({
          startAt: "2026-06-02T00:00:00.000Z",
          endAt: "2026-06-04T00:00:00.000Z",
          note: "Updated block",
        }),
      },
    );
    const deleteAvailabilityResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/availability-blocks/block-1")}`,
      {
        method: "DELETE",
        headers: ownerHeaders(),
      },
    );
    const listReviewsResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/reviews")}`,
    );
    const createReviewResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/reviews")}`,
      {
        method: "POST",
        headers: userHeaders(),
        body: JSON.stringify({
          rating: 5,
          title: "Great stay",
          comment: "Exactly as described.",
        }),
      },
    );
    const updateReviewResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/reviews/me")}`,
      {
        method: "PUT",
        headers: userHeaders(),
        body: JSON.stringify({
          rating: 5,
          title: "Great stay",
          comment: "Updated review",
        }),
      },
    );
    const summaryResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/analytics/summary?window=30d")}`,
      {
        headers: ownerHeaders(),
      },
    );
    const listAnalyticsResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/analytics/postings?window=7d&page=1&pageSize=10")}`,
      {
        headers: ownerHeaders(),
      },
    );
    const detailAnalyticsResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/analytics?window=7d&granularity=day")}`,
      {
        headers: ownerHeaders(),
      },
    );
    const searchClickResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/activity/search-click")}`,
      {
        method: "POST",
        headers: userHeaders(),
        body: JSON.stringify({
          searchSessionId: "search-1",
          query: "loft",
          family: "place",
          subtype: "workspace",
          page: 1,
          position: 0,
          hasGeoFilter: false,
          hasAvailabilityFilter: true,
        }),
      },
    );

    expect(listAvailabilityResponse.status).toBe(200);
    expect(createAvailabilityResponse.status).toBe(201);
    expect(updateAvailabilityResponse.status).toBe(200);
    expect(deleteAvailabilityResponse.status).toBe(204);
    expect(listReviewsResponse.status).toBe(200);
    expect(createReviewResponse.status).toBe(201);
    expect(updateReviewResponse.status).toBe(200);
    expect(summaryResponse.status).toBe(200);
    expect(listAnalyticsResponse.status).toBe(200);
    expect(detailAnalyticsResponse.status).toBe(200);
    expect(searchClickResponse.status).toBe(202);

    expect(postingsService.listOwnerAvailabilityBlocks).toHaveBeenCalledWith(
      "posting-1",
      "owner-1",
    );
    expect(postingsReviewsService.list).toHaveBeenCalledWith(
      "posting-1",
      1,
      20,
    );
    expect(postingsReviewsService.create).toHaveBeenCalledWith(
      "posting-1",
      "user-1",
      expect.objectContaining({
        rating: 5,
      }),
    );
    expect(postingsAnalyticsService.getOwnerSummary).toHaveBeenCalledWith(
      "owner-1",
      "30d",
    );
    expect(
      postingsAnalyticsService.listOwnerPostingsAnalytics,
    ).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      organizationId: "",
      window: "7d",
      page: 1,
      pageSize: 10,
    });
    expect(postingsAnalyticsService.trackSearchClick).toHaveBeenCalledWith(
      "posting-1",
      "user-1",
    );
    expect(
      recommendationActivityPublisher.publishSearchClick,
    ).toHaveBeenCalledTimes(1);
  });

  it("exports analytics as CSV through the dedicated route", async () => {
    const { app, postingsAnalyticsService } = createApp();

    const defaultWindowResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/analytics/export")}`,
      { headers: ownerHeaders() },
    );
    const thirtyDayResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/analytics/export?window=30d")}`,
      { headers: ownerHeaders() },
    );
    const unauthenticatedResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/analytics/export")}`,
    );

    expect(defaultWindowResponse.status).toBe(200);
    expect(defaultWindowResponse.headers.get("content-type")).toContain(
      "text/csv",
    );
    expect(defaultWindowResponse.headers.get("content-disposition")).toContain(
      "attachment",
    );
    const csvBody = await defaultWindowResponse.text();
    expect(csvBody).toContain("date,postingId");

    expect(thirtyDayResponse.status).toBe(200);
    expect(postingsAnalyticsService.exportAsCsv).toHaveBeenCalledWith(
      "owner-1",
      "30d",
    );

    expect(unauthenticatedResponse.status).toBe(401);
  });

  it("passes new booking rule fields through to the service on create and update", async () => {
    const { app, postingsService } = createApp();

    const createBody = {
      ...createPostingBody(),
      minBookingDurationDays: 3,
      advanceNoticeDays: 1,
      cancellationPolicy: "flexible",
      cancellationPolicyNotes: "Full refund within 24h.",
    };

    const createResponse = await app.request(
      `http://rent.test${buildApiPath("/postings")}`,
      {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify(createBody),
      },
    );

    expect(createResponse.status).toBe(201);
    expect(postingsService.createDraft).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        minBookingDurationDays: 3,
        advanceNoticeDays: 1,
        cancellationPolicy: "flexible",
        cancellationPolicyNotes: "Full refund within 24h.",
      }),
    );

    const updateBody = {
      ...createUpdatePostingBody(),
      minBookingDurationDays: 2,
      advanceNoticeDays: 0,
      cancellationPolicy: "strict",
      cancellationPolicyNotes: null,
    };

    const updateResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1")}`,
      {
        method: "PUT",
        headers: ownerHeaders(),
        body: JSON.stringify(updateBody),
      },
    );

    expect(updateResponse.status).toBe(200);
    expect(postingsService.update).toHaveBeenCalledWith(
      "posting-1",
      "owner-1",
      expect.objectContaining({
        minBookingDurationDays: 2,
        advanceNoticeDays: 0,
        cancellationPolicy: "strict",
        cancellationPolicyNotes: null,
      }),
    );
  });

  it("returns structured failures for unauthorized access and invalid postings inputs", async () => {
    const { app } = createApp();

    const unauthorizedResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/me")}`,
    );
    const invalidQueryResponse = await app.request(
      `http://rent.test${buildApiPath("/postings?latitude=43.6532&radiusKm=12")}`,
    );
    const invalidRouteResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting%201/duplicate")}`,
      {
        method: "POST",
        headers: ownerHeaders(),
      },
    );
    const invalidAnalyticsResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/analytics?window=30d&granularity=hour")}`,
      {
        headers: ownerHeaders(),
      },
    );

    expect(unauthorizedResponse.status).toBe(401);
    await expect(unauthorizedResponse.json()).resolves.toEqual({
      success: false,
      message: "Authorization header is required.",
      data: null,
      error: {
        code: "UNAUTHORIZED",
      },
      meta: {
        requestId: "unknown",
      },
    });

    expect(invalidQueryResponse.status).toBe(400);
    await expect(invalidQueryResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Request query validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(invalidRouteResponse.status).toBe(400);
    await expect(invalidRouteResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Route parameter validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(invalidAnalyticsResponse.status).toBe(400);
    await expect(invalidAnalyticsResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Hourly analytics are only supported for the 7d window.",
      error: {
        code: "BAD_REQUEST",
      },
    });
  });

  it("covers postings validation edge cases across create, search, autocomplete, batch, reviews, and availability routes", async () => {
    const { app } = createApp();

    const invalidCreateResponse = await app.request(
      `http://rent.test${buildApiPath("/postings")}`,
      {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({
          ...createPostingBody(),
          extraField: true,
        }),
      },
    );
    const invalidUpdateResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1")}`,
      {
        method: "PUT",
        headers: ownerHeaders(),
        body: JSON.stringify({
          ...createUpdatePostingBody(),
          location: {
            ...createUpdatePostingBody().location,
            latitude: 999,
          },
        }),
      },
    );
    const invalidAutocompleteResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/autocomplete?q=l&limit=9")}`,
    );
    const invalidBatchResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/batch")}`,
    );
    const invalidAttributeRangeResponse = await app.request(
      `http://rent.test${buildApiPath("/postings?attr.capacity.min=10&attr.capacity.max=5")}`,
    );
    const invalidAttributeNumberResponse = await app.request(
      `http://rent.test${buildApiPath("/postings?attr.capacity.min=abc")}`,
    );
    const invalidReviewResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/reviews")}`,
      {
        method: "POST",
        headers: userHeaders(),
        body: JSON.stringify({
          rating: 6,
          title: "Too high",
        }),
      },
    );
    const invalidAvailabilityRouteResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/availability-blocks/block%201")}`,
      {
        method: "DELETE",
        headers: ownerHeaders(),
      },
    );

    for (const response of [
      invalidCreateResponse,
      invalidUpdateResponse,
      invalidAutocompleteResponse,
      invalidBatchResponse,
      invalidAttributeRangeResponse,
      invalidAttributeNumberResponse,
      invalidReviewResponse,
      invalidAvailabilityRouteResponse,
    ]) {
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
      });
    }
  });

  it("handles optional auth and PAT posting edge cases", async () => {
    const {
      app,
      postingsService,
      postingsAnalyticsService,
      recommendationActivityPublisher,
      personalAccessTokenService,
    } = createApp();

    const authenticatedDetailResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1")}`,
      {
        headers: {
          authorization: "Bearer owner-token",
        },
      },
    );
    const patReadResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/me?page=1&pageSize=20")}`,
      {
        headers: {
          authorization:
            "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
        },
      },
    );
    personalAccessTokenService.authenticateToken.mockResolvedValueOnce(
      createPatPrincipal({
        scopes: ["mcp:read"],
      }),
    );
    const patWriteDeniedResponse = await app.request(
      `http://rent.test${buildApiPath("/postings")}`,
      {
        method: "POST",
        headers: {
          authorization:
            "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
          "content-type": "application/json",
        },
        body: JSON.stringify(createPostingBody()),
      },
    );

    expect(authenticatedDetailResponse.status).toBe(200);
    expect(postingsService.getById).toHaveBeenCalledWith(
      "posting-1",
      "owner-1",
    );
    expect(postingsAnalyticsService.trackPublicView).not.toHaveBeenCalled();
    expect(
      recommendationActivityPublisher.publishPostingView,
    ).not.toHaveBeenCalled();

    expect(patReadResponse.status).toBe(200);
    expect(postingsService.listByOwner).toHaveBeenCalledWith("pat-user-1", {
      page: 1,
      pageSize: 20,
      status: undefined,
    });

    expect(patWriteDeniedResponse.status).toBe(403);
    await expect(patWriteDeniedResponse.json()).resolves.toEqual({
      success: false,
      message: "Personal access token does not include the required scope.",
      data: null,
      error: {
        code: "FORBIDDEN",
        details: {
          requiredScope: "mcp:write",
          scopes: ["mcp:read"],
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("parses complex search filters and deduplicates batch ids before calling services", async () => {
    const { app, postingsService } = createApp();

    const searchResponse = await app.request(
      `http://rent.test${buildApiPath(
        "/postings?page=3&pageSize=4&q=studio&family=place&subtype=workspace&tags=wifi,loft&tags=parking&availabilityStatus=available&minDailyPrice=100&maxDailyPrice=250&latitude=43.7&longitude=-79.4&radiusKm=25&startAt=2026-06-10T00:00:00.000Z&endAt=2026-06-12T00:00:00.000Z&sort=nearest&attr.guest_capacity.min=2&attr.guest_capacity.max=6&attr.amenities=wifi&attr.amenities=parking",
      )}`,
    );
    const batchMineResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/me/batch?ids=posting-1,posting-1,posting-2")}`,
      {
        headers: ownerHeaders(),
      },
    );
    const batchPublicResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/batch?ids=posting-1,posting-1,posting-2")}`,
    );

    expect(searchResponse.status).toBe(200);
    expect(batchMineResponse.status).toBe(200);
    expect(batchPublicResponse.status).toBe(200);

    expect(postingsService.searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 3,
        pageSize: 4,
        query: "studio",
        family: "place",
        subtype: "workspace",
        tags: ["wifi", "loft", "parking"],
        availabilityStatus: "available",
        minDailyPrice: 100,
        maxDailyPrice: 250,
        geo: {
          latitude: 43.7,
          longitude: -79.4,
          radiusKm: 25,
        },
        availabilityWindow: {
          startAt: "2026-06-10T00:00:00.000Z",
          endAt: "2026-06-12T00:00:00.000Z",
        },
        sort: "nearest",
        attributeFilters: expect.arrayContaining([
          {
            key: "guest_capacity",
            min: 2,
            max: 6,
          },
          {
            key: "amenities",
            value: ["wifi", "parking"],
          },
        ]),
      }),
    );
    expect(postingsService.batchByOwner).toHaveBeenCalledWith("owner-1", [
      "posting-1",
      "posting-2",
    ]);
    expect(postingsService.batchPublic).toHaveBeenCalledWith([
      "posting-1",
      "posting-2",
    ]);
  });

  it("returns authorization and validation failures for optional-auth public postings endpoints", async () => {
    const { app } = createApp();

    const invalidDetailAuthResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1")}`,
      {
        headers: {
          authorization: "Bearer broken-token",
        },
      },
    );
    const invalidSearchClickAuthResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/activity/search-click")}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer broken-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          searchSessionId: "search-1",
          query: "loft",
          family: "place",
          subtype: "workspace",
          page: 1,
          position: 0,
        }),
      },
    );
    const invalidReviewsQueryResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/reviews?page=0&pageSize=99")}`,
    );
    const invalidAvailabilityBodyResponse = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1/availability-blocks")}`,
      {
        method: "POST",
        headers: ownerHeaders(),
        body: JSON.stringify({
          startAt: "not-a-date",
          endAt: "2026-06-03T00:00:00.000Z",
        }),
      },
    );

    expect(invalidDetailAuthResponse.status).toBe(401);
    await expect(invalidDetailAuthResponse.json()).resolves.toEqual({
      success: false,
      message: "Invalid access token signature.",
      data: null,
      error: {
        code: "UNAUTHORIZED",
      },
      meta: {
        requestId: "unknown",
      },
    });

    expect(invalidSearchClickAuthResponse.status).toBe(401);
    await expect(invalidSearchClickAuthResponse.json()).resolves.toEqual({
      success: false,
      message: "Invalid access token signature.",
      data: null,
      error: {
        code: "UNAUTHORIZED",
      },
      meta: {
        requestId: "unknown",
      },
    });

    expect(invalidReviewsQueryResponse.status).toBe(400);
    await expect(invalidReviewsQueryResponse.json()).resolves.toMatchObject({
      success: false,
      message: "Request query validation failed.",
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    expect(invalidAvailabilityBodyResponse.status).toBe(400);
    await expect(invalidAvailabilityBodyResponse.json()).resolves.toMatchObject(
      {
        success: false,
        message: "Request body validation failed.",
        error: {
          code: "VALIDATION_ERROR",
        },
      },
    );
  });

  it("still tracks views for authenticated requests when the service returns a public posting record shape", async () => {
    const {
      app,
      postingsService,
      postingsAnalyticsService,
      recommendationActivityPublisher,
    } = createApp();
    const { organizationId, ...publicPosting } = createPosting();
    void organizationId;
    postingsService.getById.mockResolvedValueOnce(publicPosting as any);

    const response = await app.request(
      `http://rent.test${buildApiPath("/postings/posting-1")}`,
      {
        headers: {
          authorization: "Bearer owner-token",
          "x-forwarded-for": "127.0.0.1",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(postingsAnalyticsService.trackPublicView).toHaveBeenCalledWith(
      publicPosting,
      expect.any(Object),
      "owner-1",
    );
    expect(
      recommendationActivityPublisher.publishPostingView,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        posting: publicPosting,
        actorUserId: "owner-1",
      }),
    );
  });
});
