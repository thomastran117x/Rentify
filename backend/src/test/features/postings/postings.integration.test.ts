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
    ownerId: "owner-1",
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
  ) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.postingsController) {
      return this.postingsController as TValue;
    }

    if (token === containerTokens.tokenService) {
      return this.tokenService as TValue;
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

  const controller = new PostingsController(
    postingsService as never,
    postingsPublicAutocompleteService as never,
    postingsAnalyticsService as never,
    postingsReviewsService as never,
    recommendationActivityPublisher as never,
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

      throw new Error("Invalid access token signature.");
    }),
  };
  const container = new FakeRequestContainer(controller, tokenService);
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
    expect(batchMineResponse.status).toBe(200);
    expect(batchPublicResponse.status).toBe(200);

    expect(postingsService.listByOwner).toHaveBeenCalledWith("owner-1", {
      page: 1,
      pageSize: 20,
      status: "published",
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
      ownerId: "owner-1",
      window: "7d",
      page: 1,
      pageSize: 10,
    });
    expect(postingsAnalyticsService.trackSearchClick).toHaveBeenCalledWith(
      "posting-1",
    );
    expect(
      recommendationActivityPublisher.publishSearchClick,
    ).toHaveBeenCalledTimes(1);
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
});
