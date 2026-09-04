import { createTestContext, invoke } from "../../support/mock-http";
import { RequestValidationError } from "@/configuration/validation/request";
import type { AppBindings } from "@/configuration/http/bindings";
import { PostingsController } from "@/features/postings/postings.controller";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { testUuid } from "../../support/uuid";

const POSTING_ID = testUuid(2000, 1);
const POSTING_TWO_ID = testUuid(2000, 2);
const POSTING_THREE_ID = testUuid(2000, 3);
const POSTING_FOUR_ID = testUuid(2000, 4);
const POSTING_FIVE_ID = testUuid(2000, 5);
const OWNER_ID = testUuid(1000, 1);
const USER_ID = testUuid(1000, 2);
const BLOCK_ID = testUuid(2100, 1);
const RULE_ID = testUuid(2100, 9);
const SAVED_SEARCH_ID = testUuid(2200, 1);

const mockRequireJwtAuth = jest.fn();
const mockGetOptionalJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: OWNER_ID,
    email: `${OWNER_ID}@example.com`,
    role: "owner",
    deviceId: "device-1",
    tokenVersion: 0,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createPlaceDetails() {
  return {
    guest_capacity: 2,
    property_type: "condo",
    amenities: [],
  };
}

function createPostingBody() {
  return {
    variant: {
      family: "place",
      subtype: "entire_place",
    },
    name: `Test ${POSTING_ID}`,
    description: "Nice place",
    pricing: {
      currency: "cad",
      daily: {
        amount: 100,
      },
    },
    photos: [
      {
        blobUrl: "https://example.blob.core.windows.net/postings/photo-1.jpg",
        blobName: "postings/photo-1.jpg",
        position: 0,
      },
    ],
    tags: ["camera"],
    details: createPlaceDetails(),
    availabilityStatus: "available",
    availabilityNotes: "Available soon",
    maxBookingDurationDays: 7,
    availabilityBlocks: [
      {
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-03T00:00:00.000Z",
        note: "Cleaning",
      },
    ],
    location: {
      latitude: 43.7,
      longitude: -79.4,
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      postalCode: "M5H 2N2",
    },
  };
}

function createContext(options?: {
  body?: unknown;
  url?: string;
  params?: Record<string, string>;
}) {
  return createTestContext({
    body: options?.body,
    params: options?.params,
    url: options?.url ?? "https://example.test/postings",
    state: {
      client: {
        ip: "127.0.0.1",
        device: {
          id: "device-1",
          type: "desktop",
          isMobile: false,
          userAgent: "test-agent",
          platform: "test-os",
        },
      },
      requestId: "request-1",
      container: {
        resolve: () => ({
          inspectRequest: () => [],
        }),
      },
    },
  });
}

function createController(
  postingsService: Record<string, unknown>,
  overrides?: {
    autocomplete?: Record<string, unknown>;
    analytics?: Record<string, unknown>;
    reviews?: Record<string, unknown>;
    seasonalPricing?: Record<string, unknown>;
    recommendationActivityPublisher?: Record<string, unknown>;
    savedPostings?: Record<string, unknown>;
  },
) {
  return new PostingsController(
    postingsService as any,
    (overrides?.autocomplete ?? {}) as any,
    (overrides?.analytics ?? {}) as any,
    (overrides?.reviews ?? {}) as any,
    (overrides?.seasonalPricing ?? {}) as any,
    (overrides?.recommendationActivityPublisher ?? {}) as any,
    (overrides?.savedPostings ?? {}) as any,
  );
}

describe("PostingsController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockGetOptionalJwtAuth.mockReset();
  });

  it("maps family and subtype search filters into the service input", async () => {
    const searchPublic = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      source: "elasticsearch" as const,
    }));
    const controller = createController(
      {
        searchPublic,
      },
      {
        analytics: {
          trackSearchImpressions: jest.fn(async () => undefined),
        },
      },
    );
    const context = createContext({
      url: "https://example.test/postings?page=2&pageSize=5&family=vehicle&subtype=car",
    });

    const response = await invoke(controller.search, context);

    expect(searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        pageSize: 5,
        family: "vehicle",
        subtype: "car",
        sort: "relevance",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("maps organization search filters into the service input", async () => {
    const searchPublic = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "elasticsearch" as const,
    }));
    const controller = createController(
      {
        searchPublic,
      },
      {
        analytics: {
          trackSearchImpressions: jest.fn(async () => undefined),
        },
      },
    );
    const context = createContext({
      url: "https://example.test/postings?organization=Maya%20Santos%20Organization&organizationId=6f1c8b2e-6b0a-4f0e-9b6e-2f9a1c2d3e4f&sort=organizationAsc",
    });

    const response = await invoke(controller.search, context);

    expect(searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationQuery: "Maya Santos Organization",
        organizationId: "6f1c8b2e-6b0a-4f0e-9b6e-2f9a1c2d3e4f",
        sort: "organizationAsc",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("rejects a malformed organizationId with a validation error", async () => {
    const searchPublic = jest.fn();
    const controller = createController(
      {
        searchPublic,
      },
      {
        analytics: {
          trackSearchImpressions: jest.fn(async () => undefined),
        },
      },
    );
    const context = createContext({
      url: "https://example.test/postings?organizationId=not-a-uuid",
    });

    await expect(invoke(controller.search, context)).rejects.toThrow();
    expect(searchPublic).not.toHaveBeenCalled();
  });

  it("maps attribute search filters into the service input", async () => {
    const searchPublic = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 1,
        pageSize: 5,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "elasticsearch" as const,
    }));
    const controller = createController(
      {
        searchPublic,
      },
      {
        analytics: {
          trackSearchImpressions: jest.fn(async () => undefined),
        },
      },
    );
    const context = createContext({
      url: "https://example.test/postings?family=place&subtype=entire_place&attr.bedrooms.min=2&attr.bedrooms.max=4&attr.amenities=wifi&attr.amenities=desk",
    });

    await invoke(controller.search, context);

    expect(searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        family: "place",
        subtype: "entire_place",
        attributeFilters: [
          {
            key: "bedrooms",
            min: 2,
            max: 4,
          },
          {
            key: "amenities",
            value: ["wifi", "desk"],
          },
        ],
      }),
    );
  });

  it("maps paired geo filters into the service input", async () => {
    const searchPublic = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 1,
        pageSize: 5,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "elasticsearch" as const,
    }));
    const controller = createController(
      {
        searchPublic,
      },
      {
        analytics: {
          trackSearchImpressions: jest.fn(async () => undefined),
        },
      },
    );
    const context = createContext({
      url: "https://example.test/postings?latitude=43.6532&longitude=-79.3832&radiusKm=12",
    });

    await invoke(controller.search, context);

    expect(searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        geo: {
          latitude: 43.6532,
          longitude: -79.3832,
          radiusKm: 12,
        },
      }),
    );
  });

  it("rejects partial geo filters before reaching the service", async () => {
    const searchPublic = jest.fn();
    const controller = createController(
      {
        searchPublic,
      },
      {
        analytics: {
          trackSearchImpressions: jest.fn(async () => undefined),
        },
      },
    );
    const context = createContext({
      url: "https://example.test/postings?latitude=43.6532&radiusKm=12",
    });

    await expect(invoke(controller.search, context)).rejects.toMatchObject<
      Partial<RequestValidationError>
    >({
      message: "Request query validation failed.",
      details: expect.arrayContaining([
        {
          path: "latitude",
          message: "latitude and longitude must be provided together.",
        },
        {
          path: "longitude",
          message: "latitude and longitude must be provided together.",
        },
        {
          path: "radiusKm",
          message: "radiusKm requires both latitude and longitude.",
        },
      ]),
    });
    expect(searchPublic).not.toHaveBeenCalled();
  });

  it("treats blank public search query params as omitted values", async () => {
    const searchPublic = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "elasticsearch" as const,
    }));
    const controller = createController(
      {
        searchPublic,
      },
      {
        analytics: {
          trackSearchImpressions: jest.fn(async () => undefined),
        },
      },
    );
    const context = createContext({
      url: "https://example.test/postings?page=&pageSize=&q=&family=&subtype=&availabilityStatus=&minDailyPrice=&maxDailyPrice=&latitude=&longitude=&radiusKm=&startAt=&endAt=&sort=&attr.bedrooms.min=",
    });

    await invoke(controller.search, context);

    expect(searchPublic).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sort: "relevance",
      tags: undefined,
      attributeFilters: undefined,
      availabilityStatus: undefined,
      availabilityWindow: undefined,
      family: undefined,
      geo: undefined,
      maxDailyPrice: undefined,
      minDailyPrice: undefined,
      query: undefined,
      subtype: undefined,
    });
  });

  it("maps trimmed query, split tags, and availability windows into the service input", async () => {
    const searchPublic = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "elasticsearch" as const,
      query: "Saint-Roch Production Flat",
    }));
    const controller = createController(
      {
        searchPublic,
      },
      {
        analytics: {
          trackSearchImpressions: jest.fn(async () => undefined),
        },
      },
    );
    const context = createContext({
      url: "https://example.test/postings?q=%20Saint-Roch%20Production%20Flat%20&tags=flat,production&tags=quebec-city&startAt=2026-07-01T00:00:00.000Z&endAt=2026-07-05T00:00:00.000Z",
    });

    await invoke(controller.search, context);

    expect(searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Saint-Roch Production Flat",
        tags: ["flat", "production", "quebec-city"],
        availabilityWindow: {
          startAt: "2026-07-01T00:00:00.000Z",
          endAt: "2026-07-05T00:00:00.000Z",
        },
      }),
    );
  });

  it("rejects invalid attribute range values before reaching the service", async () => {
    const searchPublic = jest.fn();
    const controller = createController(
      {
        searchPublic,
      },
      {
        analytics: {
          trackSearchImpressions: jest.fn(async () => undefined),
        },
      },
    );
    const context = createContext({
      url: "https://example.test/postings?family=place&subtype=entire_place&attr.bedrooms.min=two",
    });

    await expect(invoke(controller.search, context)).rejects.toMatchObject<
      Partial<RequestValidationError>
    >({
      message: "Request query validation failed.",
      details: [
        {
          path: "attr.bedrooms.min",
          message: "Attribute range values must be valid numbers.",
        },
      ],
    });
    expect(searchPublic).not.toHaveBeenCalled();
  });

  it("returns search results even when impression tracking fails", async () => {
    const searchPublic = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      source: "elasticsearch" as const,
    }));
    const controller = createController(
      {
        searchPublic,
      },
      {
        analytics: {
          trackSearchImpressions: jest.fn(async () => {
            throw new Error("analytics unavailable");
          }),
        },
      },
    );
    const context = createContext();

    const response = await invoke(controller.search, context);

    expect(searchPublic).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it("creates drafts from validated request bodies", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const createDraft = jest.fn(async () => ({
      id: POSTING_ID,
      status: "draft",
    }));
    const controller = createController({
      createDraft,
    });
    const context = createContext({
      body: createPostingBody(),
    });

    const response = await invoke(controller.create, context);

    expect(createDraft).toHaveBeenCalledWith(
      OWNER_ID,
      expect.objectContaining({
        availabilityBlocks: [
          {
            startAt: "2026-05-01T00:00:00.000Z",
            endAt: "2026-05-03T00:00:00.000Z",
            note: "Cleaning",
          },
        ],
        location: expect.objectContaining({
          postalCode: "M5H 2N2",
        }),
      }),
    );
    expect(response.status).toBe(201);
  });

  it("updates drafts from validated request bodies and omits availability blocks", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const update = jest.fn(async () => ({
      id: POSTING_ID,
      status: "draft",
    }));
    const controller = createController({
      update,
    });
    const context = createContext({
      params: {
        id: POSTING_ID,
      },
      body: {
        variant: {
          family: "place",
          subtype: "entire_place",
        },
        name: `Updated ${POSTING_ID}`,
        description: "Still nice",
        pricing: {
          currency: "cad",
          daily: {
            amount: 120,
          },
        },
        photos: [
          {
            blobUrl:
              "https://example.blob.core.windows.net/postings/photo-1.jpg",
            blobName: "postings/photo-1.jpg",
            position: 0,
          },
        ],
        tags: ["camera"],
        details: createPlaceDetails(),
        availabilityStatus: "available",
        availabilityNotes: null,
        maxBookingDurationDays: null,
        location: {
          latitude: 43.7,
          longitude: -79.4,
          city: "Toronto",
          region: "Ontario",
          country: "Canada",
        },
      },
    });

    const response = await invoke(controller.update, context);

    expect(update).toHaveBeenCalledWith(
      POSTING_ID,
      OWNER_ID,
      expect.objectContaining({
        availabilityBlocks: [],
        location: expect.objectContaining({
          postalCode: undefined,
        }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it("rejects create requests that omit the required variant", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const createDraft = jest.fn();
    const controller = createController({
      createDraft,
    });
    const context = createContext({
      body: {
        name: `Test ${POSTING_ID}`,
        description: "Nice place",
        pricing: {
          currency: "cad",
          daily: {
            amount: 100,
          },
        },
        photos: [
          {
            blobUrl:
              "https://example.blob.core.windows.net/postings/photo-1.jpg",
            blobName: "postings/photo-1.jpg",
            position: 0,
          },
        ],
        tags: [],
        details: createPlaceDetails(),
        availabilityStatus: "available",
        availabilityBlocks: [],
        location: {
          latitude: 43.7,
          longitude: -79.4,
          city: "Toronto",
          region: "Ontario",
          country: "Canada",
        },
      },
    });

    await expect(invoke(controller.create, context)).rejects.toMatchObject({
      details: [expect.objectContaining({ path: "" })],
    });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("rejects create requests whose tags contain commas", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const createDraft = jest.fn();
    const controller = createController({
      createDraft,
    });
    const context = createContext({
      body: {
        variant: {
          family: "place",
          subtype: "entire_place",
        },
        name: `Test ${POSTING_ID}`,
        description: "Nice place",
        pricing: {
          currency: "cad",
          daily: {
            amount: 100,
          },
        },
        photos: [
          {
            blobUrl:
              "https://example.blob.core.windows.net/postings/photo-1.jpg",
            blobName: "postings/photo-1.jpg",
            position: 0,
          },
        ],
        tags: ["camera, lens"],
        details: createPlaceDetails(),
        availabilityStatus: "available",
        availabilityBlocks: [],
        location: {
          latitude: 43.7,
          longitude: -79.4,
          city: "Toronto",
          region: "Ontario",
          country: "Canada",
        },
      },
    });

    await expect(invoke(controller.create, context)).rejects.toMatchObject({
      message: "Request body validation failed.",
      details: expect.arrayContaining([
        expect.objectContaining({
          path: "tags.0",
        }),
      ]),
    });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("rejects update requests that include availability blocks", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const update = jest.fn();
    const controller = createController({
      update,
    });
    const context = createContext({
      params: {
        id: POSTING_ID,
      },
      body: {
        variant: {
          family: "place",
          subtype: "entire_place",
        },
        name: `Test ${POSTING_ID}`,
        description: "Nice place",
        pricing: {
          currency: "cad",
          daily: {
            amount: 100,
          },
        },
        photos: [
          {
            blobUrl:
              "https://example.blob.core.windows.net/postings/photo-1.jpg",
            blobName: "postings/photo-1.jpg",
            position: 0,
          },
        ],
        tags: [],
        details: createPlaceDetails(),
        availabilityStatus: "available",
        availabilityBlocks: [],
        location: {
          latitude: 43.7,
          longitude: -79.4,
          city: "Toronto",
          region: "Ontario",
          country: "Canada",
        },
      },
    });

    await expect(invoke(controller.update, context)).rejects.toMatchObject({
      details: [expect.objectContaining({ path: "" })],
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("routes duplicate with posting id and owner id", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const duplicate = jest.fn(async () => ({
      id: POSTING_TWO_ID,
      status: "draft",
    }));
    const controller = createController({
      duplicate,
    });
    const context = createContext({
      params: {
        id: POSTING_ID,
      },
    });

    const response = await invoke(controller.duplicate, context);

    expect(duplicate).toHaveBeenCalledWith(POSTING_ID, OWNER_ID);
    expect(response.status).toBe(201);
  });

  it("routes availability block creation with posting id and owner id", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const createOwnerAvailabilityBlock = jest.fn(async () => ({
      id: BLOCK_ID,
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-03T00:00:00.000Z",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    }));
    const controller = createController({
      createOwnerAvailabilityBlock,
    });
    const context = createContext({
      params: {
        id: POSTING_ID,
      },
      body: {
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-03T00:00:00.000Z",
        note: "Maintenance",
      },
    });

    const response = await invoke(controller.createAvailabilityBlock, context);

    expect(createOwnerAvailabilityBlock).toHaveBeenCalledWith(
      POSTING_ID,
      OWNER_ID,
      {
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-03T00:00:00.000Z",
        note: "Maintenance",
      },
    );
    expect(response.status).toBe(201);
  });

  it("routes availability block update with block id", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const updateOwnerAvailabilityBlock = jest.fn(async () => ({
      id: BLOCK_ID,
      startAt: "2026-05-02T00:00:00.000Z",
      endAt: "2026-05-04T00:00:00.000Z",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    }));
    const controller = createController({
      updateOwnerAvailabilityBlock,
    });
    const context = createContext({
      params: {
        id: POSTING_ID,
        blockId: BLOCK_ID,
      },
      body: {
        startAt: "2026-05-02T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
      },
    });

    const response = await invoke(controller.updateAvailabilityBlock, context);

    expect(updateOwnerAvailabilityBlock).toHaveBeenCalledWith(
      POSTING_ID,
      OWNER_ID,
      BLOCK_ID,
      {
        startAt: "2026-05-02T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
        note: undefined,
      },
    );
    expect(response.status).toBe(200);
  });

  it("routes availability block deletion and returns 204", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const deleteOwnerAvailabilityBlock = jest.fn(async () => undefined);
    const controller = createController({
      deleteOwnerAvailabilityBlock,
    });
    const context = createContext({
      params: {
        id: POSTING_ID,
        blockId: BLOCK_ID,
      },
    });

    const response = await invoke(controller.deleteAvailabilityBlock, context);

    expect(deleteOwnerAvailabilityBlock).toHaveBeenCalledWith(
      POSTING_ID,
      OWNER_ID,
      BLOCK_ID,
    );
    expect(response.status).toBe(204);
  });

  it("routes pause and unpause with posting id and owner id", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const pause = jest.fn(async () => ({
      id: POSTING_ID,
      status: "paused",
    }));
    const unpause = jest.fn(async () => ({
      id: POSTING_ID,
      status: "published",
    }));
    const controller = createController(
      {
        pause,
        unpause,
      },
      {
        recommendationActivityPublisher: {
          publishPostingLifecycle: jest.fn(async () => undefined),
        },
      },
    );
    const context = createContext({
      params: {
        id: POSTING_ID,
      },
    });

    const pauseResponse = await invoke(controller.pause, context);
    const unpauseResponse = await invoke(controller.unpause, context);

    expect(pause).toHaveBeenCalledWith(POSTING_ID, OWNER_ID);
    expect(unpause).toHaveBeenCalledWith(POSTING_ID, OWNER_ID);
    expect(pauseResponse.status).toBe(200);
    expect(unpauseResponse.status).toBe(200);
  });

  it("publishes and archives postings while emitting lifecycle activity", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const publishPostingLifecycle = jest.fn(async () => undefined);
    const controller = createController(
      {
        publish: jest.fn(async () => ({
          id: POSTING_ID,
          status: "published",
        })),
        archive: jest.fn(async () => ({
          id: POSTING_ID,
          status: "archived",
        })),
      },
      {
        recommendationActivityPublisher: {
          publishPostingLifecycle,
        },
      },
    );
    const context = createContext({
      params: {
        id: POSTING_ID,
      },
    });

    const publishResponse = await invoke(controller.publish, context);
    const archiveResponse = await invoke(controller.archive, context);

    expect(publishPostingLifecycle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: "posting_published",
        actorUserId: OWNER_ID,
        requestId: "request-1",
      }),
    );
    expect(publishPostingLifecycle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: "posting_archived",
        actorUserId: OWNER_ID,
        requestId: "request-1",
      }),
    );
    expect(publishResponse.status).toBe(200);
    expect(archiveResponse.status).toBe(200);
  });

  it("allows authenticated org members to list availability blocks", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ role: "user" }));
    const listOwnerAvailabilityBlocks = jest.fn(async () => ({
      availabilityBlocks: [],
    }));
    const controller = createController({
      listOwnerAvailabilityBlocks,
    });
    const context = createContext({
      params: {
        id: POSTING_ID,
      },
    });

    const response = await invoke(controller.listAvailabilityBlocks, context);

    expect(response.status).toBe(200);
    expect(listOwnerAvailabilityBlocks).toHaveBeenCalledWith(
      POSTING_ID,
      OWNER_ID,
    );
  });

  it("lists the caller's postings and parses owner query filters", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const listByOwner = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    }));
    const controller = createController({
      listByOwner,
    });
    const context = createContext({
      url: "https://example.test/postings/mine?page=2&pageSize=5&status=paused",
    });

    const response = await invoke(controller.listMine, context);

    expect(listByOwner).toHaveBeenCalledWith(OWNER_ID, {
      page: 2,
      pageSize: 5,
      status: "paused",
    });
    expect(response.status).toBe(200);
  });

  it("routes batch and autocomplete queries", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const batchByOwner = jest.fn(async () => ({
      postings: [],
      missingIds: [],
    }));
    const batchPublic = jest.fn(async () => ({
      postings: [],
      missingIds: [],
    }));
    const autocompletePublic = jest.fn(async () => ({
      suggestions: [],
    }));
    const controller = createController(
      {
        batchByOwner,
        batchPublic,
      },
      {
        autocomplete: {
          autocompletePublic,
        },
      },
    );

    const mineResponse = await invoke(
      controller.batchMine,
      createContext({
        url: `https://example.test/postings/mine/batch?ids=${POSTING_ID},${POSTING_TWO_ID}&ids=${POSTING_THREE_ID}`,
      }),
    );
    const publicResponse = await invoke(
      controller.batchPublic,
      createContext({
        url: `https://example.test/postings/batch?ids=${POSTING_FOUR_ID}&ids=${POSTING_FIVE_ID}`,
      }),
    );
    const autocompleteResponse = await invoke(
      controller.autocomplete,
      createContext({
        url: "https://example.test/postings/autocomplete?q= loft &family=place&subtype=entire_place&limit=8",
      }),
    );

    expect(batchByOwner).toHaveBeenCalledWith(OWNER_ID, [
      POSTING_ID,
      POSTING_TWO_ID,
      POSTING_THREE_ID,
    ]);
    expect(batchPublic).toHaveBeenCalledWith([
      POSTING_FOUR_ID,
      POSTING_FIVE_ID,
    ]);
    expect(autocompletePublic).toHaveBeenCalledWith({
      query: "loft",
      family: "place",
      subtype: "entire_place",
      limit: 8,
    });
    expect(mineResponse.status).toBe(200);
    expect(publicResponse.status).toBe(200);
    expect(autocompleteResponse.status).toBe(200);
  });

  it("routes analytics and review endpoints with parsed inputs", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const getOwnerSummary = jest.fn(async () => ({ window: "30d" }));
    const listOwnerPostingsAnalytics = jest.fn(async () => ({
      postings: [],
      pagination: {
        page: 3,
        pageSize: 7,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    }));
    const getPostingAnalyticsDetail = jest.fn(async () => ({
      postingId: POSTING_ID,
      window: "all",
      granularity: "hour",
      buckets: [],
    }));
    const list = jest.fn(async () => ({
      reviews: [],
      summary: {
        averageRating: 0,
        reviewCount: 0,
      },
      pagination: {
        page: 2,
        pageSize: 4,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    }));
    const create = jest.fn(async () => ({ id: "review-1" }));
    const updateOwn = jest.fn(async () => ({ id: "review-1" }));
    const getOwn = jest.fn(async () => ({ eligible: true, review: null }));
    const controller = createController(
      {},
      {
        analytics: {
          getOwnerSummary,
          listOwnerPostingsAnalytics,
          getPostingAnalyticsDetail,
        },
        reviews: {
          list,
          create,
          updateOwn,
          getOwn,
        },
      },
    );

    const summaryResponse = await invoke(
      controller.analyticsSummary,
      createContext({
        url: "https://example.test/postings/analytics/summary?window=30d",
      }),
    );
    const analyticsResponse = await invoke(
      controller.analyticsPostings,
      createContext({
        url: "https://example.test/postings/analytics/postings?window=all&page=3&pageSize=7",
      }),
    );
    const detailResponse = await invoke(
      controller.analyticsById,
      createContext({
        params: {
          id: POSTING_ID,
        },
        url: "https://example.test/postings/posting-1/analytics?window=all&granularity=hour",
      }),
    );
    const listReviewsResponse = await invoke(
      controller.listReviews,
      createContext({
        params: {
          id: POSTING_ID,
        },
        url: "https://example.test/postings/posting-1/reviews?page=2&pageSize=4",
      }),
    );
    const createReviewResponse = await invoke(
      controller.createReview,
      createContext({
        params: {
          id: POSTING_ID,
        },
        body: {
          rating: 5,
          title: "Great stay",
          comment: "Exactly as described.",
        },
      }),
    );
    const updateReviewResponse = await invoke(
      controller.updateOwnReview,
      createContext({
        params: {
          id: POSTING_ID,
        },
        body: {
          rating: 4,
          title: "Updated",
          comment: "Still good.",
        },
      }),
    );
    const getOwnReviewResponse = await invoke(
      controller.getOwnReview,
      createContext({
        params: {
          id: POSTING_ID,
        },
      }),
    );

    expect(getOwnerSummary).toHaveBeenCalledWith(OWNER_ID, "30d");
    expect(listOwnerPostingsAnalytics).toHaveBeenCalledWith({
      actorUserId: OWNER_ID,
      page: 3,
      pageSize: 7,
      window: "all",
    });
    expect(getPostingAnalyticsDetail).toHaveBeenCalledWith({
      actorUserId: OWNER_ID,
      postingId: POSTING_ID,
      window: "all",
      granularity: "hour",
    });
    expect(list).toHaveBeenCalledWith(POSTING_ID, 2, 4);
    expect(create).toHaveBeenCalledWith(POSTING_ID, OWNER_ID, {
      rating: 5,
      title: "Great stay",
      comment: "Exactly as described.",
    });
    expect(updateOwn).toHaveBeenCalledWith(POSTING_ID, OWNER_ID, {
      rating: 4,
      title: "Updated",
      comment: "Still good.",
    });
    expect(getOwn).toHaveBeenCalledWith(POSTING_ID, OWNER_ID);
    expect(summaryResponse.status).toBe(200);
    expect(analyticsResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(listReviewsResponse.status).toBe(200);
    expect(createReviewResponse.status).toBe(201);
    expect(updateReviewResponse.status).toBe(200);
    expect(getOwnReviewResponse.status).toBe(200);
  });

  it("tracks search click activity and returns 202", async () => {
    mockGetOptionalJwtAuth.mockResolvedValue(null);
    const publishSearchClick = jest.fn(async () => undefined);
    const controller = createController({} as any, {
      analytics: {
        trackSearchClick: jest.fn(async () => undefined),
      },
      recommendationActivityPublisher: {
        publishSearchClick,
      },
    });
    const context = createContext({
      params: {
        id: POSTING_ID,
      },
      body: {
        searchSessionId: SAVED_SEARCH_ID,
        page: 1,
        position: 0,
        hasGeoFilter: false,
        hasAvailabilityFilter: true,
      },
    });

    const response = await invoke(controller.trackSearchClick, context);

    expect(publishSearchClick).toHaveBeenCalledWith(
      expect.objectContaining({
        postingId: POSTING_ID,
        actorUserId: undefined,
        requestId: "request-1",
      }),
    );
    expect(response.status).toBe(202);
  });

  it("publishes recommendation posting views alongside owner analytics for public viewers", async () => {
    mockGetOptionalJwtAuth.mockResolvedValue(null);
    const trackPublicView = jest.fn(async () => undefined);
    const publishPostingView = jest.fn(async () => undefined);
    const controller = createController(
      {
        getById: jest.fn(async () => ({
          id: POSTING_ID,
          ownerId: OWNER_ID,
          status: "published",
        })),
      },
      {
        analytics: {
          trackPublicView,
        },
        recommendationActivityPublisher: {
          publishPostingView,
        },
      },
    );
    const context = createContext({
      params: {
        id: POSTING_ID,
      },
      url: "https://example.test/postings/posting-1",
    });

    const response = await invoke(controller.getById, context);

    expect(trackPublicView).toHaveBeenCalledTimes(1);
    expect(publishPostingView).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it("skips public analytics side effects for authenticated managed posting reads", async () => {
    mockGetOptionalJwtAuth.mockResolvedValue(createClaims());
    const trackPublicView = jest.fn(async () => undefined);
    const publishPostingView = jest.fn(async () => undefined);
    const controller = createController(
      {
        getById: jest.fn(async () => ({
          id: POSTING_ID,
          organizationId: "org-1",
          status: "draft",
        })),
      },
      {
        analytics: {
          trackPublicView,
        },
        recommendationActivityPublisher: {
          publishPostingView,
        },
      },
    );
    const context = createContext({
      params: {
        id: POSTING_ID,
      },
      url: "https://example.test/postings/posting-1",
    });

    const response = await invoke(controller.getById, context);

    expect(trackPublicView).not.toHaveBeenCalled();
    expect(publishPostingView).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  describe("exportAnalytics handler", () => {
    it("returns a text/csv response with the analytics export", async () => {
      mockRequireJwtAuth.mockResolvedValue(createClaims());
      const exportAsCsv = jest.fn(async () => "date,views\n2026-06-01,100\n");
      const controller = createController({}, { analytics: { exportAsCsv } });
      const context = createContext({
        url: "https://example.test/postings/analytics/export?window=7d",
      });

      const response = await invoke(controller.exportAnalytics, context);

      expect(exportAsCsv).toHaveBeenCalledWith(OWNER_ID, "7d");
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "text/csv; charset=utf-8",
      );
      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="analytics.csv"',
      );
    });

    it("throws a validation error when the window query param is not a recognised value", async () => {
      mockRequireJwtAuth.mockResolvedValue(createClaims());
      const controller = createController({}, { analytics: {} });
      const context = createContext({
        url: "https://example.test/postings/analytics/summary?window=not_a_real_window",
      });

      await expect(
        invoke(controller.analyticsSummary, context),
      ).rejects.toBeInstanceOf(RequestValidationError);
    });
  });

  describe("seasonal pricing handlers", () => {
    const rule = {
      id: RULE_ID,
      postingId: POSTING_ID,
      name: "Peak",
      startDate: "2026-06-01",
      endDate: "2026-08-31",
      dailyAmount: 200,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const ruleBody = {
      name: "Peak",
      startDate: "2026-06-01",
      endDate: "2026-08-31",
      dailyAmount: 200,
    };

    beforeEach(() => {
      mockRequireJwtAuth.mockResolvedValue(createClaims());
    });

    it("listSeasonalPricing — returns 200 with the rule list", async () => {
      const list = jest.fn(async () => [rule]);
      const controller = createController({}, { seasonalPricing: { list } });
      const context = createContext({ params: { id: POSTING_ID } });

      const response = await invoke(controller.listSeasonalPricing, context);

      expect(list).toHaveBeenCalledWith(POSTING_ID, OWNER_ID);
      expect(response.status).toBe(200);
    });

    it("createSeasonalPricingRule — returns 201 after delegating to service", async () => {
      const create = jest.fn(async () => rule);
      const controller = createController({}, { seasonalPricing: { create } });
      const context = createContext({
        params: { id: POSTING_ID },
        body: ruleBody,
      });

      const response = await invoke(
        controller.createSeasonalPricingRule,
        context,
      );

      expect(create).toHaveBeenCalledWith(
        POSTING_ID,
        OWNER_ID,
        expect.objectContaining({ name: "Peak" }),
      );
      expect(response.status).toBe(201);
    });

    it("updateSeasonalPricingRule — returns 200 with the updated rule", async () => {
      const update = jest.fn(async () => ({ ...rule, name: "Updated" }));
      const controller = createController({}, { seasonalPricing: { update } });
      const context = createContext({
        params: { id: POSTING_ID, ruleId: RULE_ID },
        body: { ...ruleBody, name: "Updated" },
      });

      const response = await invoke(
        controller.updateSeasonalPricingRule,
        context,
      );

      expect(update).toHaveBeenCalledWith(
        POSTING_ID,
        RULE_ID,
        OWNER_ID,
        expect.objectContaining({ name: "Updated" }),
      );
      expect(response.status).toBe(200);
    });

    it("deleteSeasonalPricingRule — returns 204 after deleting the rule", async () => {
      const del = jest.fn(async () => undefined);
      const controller = createController(
        {},
        { seasonalPricing: { delete: del } },
      );
      const context = createContext({
        params: { id: POSTING_ID, ruleId: RULE_ID },
      });

      const response = await invoke(
        controller.deleteSeasonalPricingRule,
        context,
      );

      expect(del).toHaveBeenCalledWith(POSTING_ID, RULE_ID, OWNER_ID);
      expect(response.status).toBe(204);
    });
  });

  describe("saved postings", () => {
    beforeEach(() => {
      mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: USER_ID }));
    });

    it("listSaved — forwards the parsed page and exposes pagination meta", async () => {
      const pagination = {
        page: 2,
        pageSize: 5,
        total: 7,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      };
      const list = jest.fn(async () => ({
        postings: [],
        pagination,
        unavailablePostings: [],
      }));
      const controller = createController({}, { savedPostings: { list } });
      const context = createContext({
        url: "https://example.test/postings/saved?page=2&pageSize=5",
      });

      const response = await invoke(controller.listSaved, context);

      expect(list).toHaveBeenCalledWith(USER_ID, 2, 5);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          meta: expect.objectContaining({ pagination }),
        }),
      );
    });

    it("listSaved — defaults page and pageSize when absent", async () => {
      const list = jest.fn(async () => ({
        postings: [],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        unavailablePostings: [],
      }));
      const controller = createController({}, { savedPostings: { list } });

      await invoke(
        controller.listSaved,
        createContext({ url: "https://example.test/postings/saved" }),
      );

      expect(list).toHaveBeenCalledWith(USER_ID, 1, 20);
    });

    it.each([
      ["page=0", "https://example.test/postings/saved?page=0"],
      ["pageSize=999", "https://example.test/postings/saved?pageSize=999"],
    ])("listSaved — rejects %s", async (_label, url) => {
      const list = jest.fn();
      const controller = createController({}, { savedPostings: { list } });

      await expect(
        invoke(controller.listSaved, createContext({ url })),
      ).rejects.toBeInstanceOf(RequestValidationError);
      expect(list).not.toHaveBeenCalled();
    });

    it("listSavedIds — forwards the caller identifier", async () => {
      const listIds = jest.fn(async () => ({
        postingIds: [POSTING_ID],
        truncated: false,
      }));
      const controller = createController({}, { savedPostings: { listIds } });

      const response = await invoke(controller.listSavedIds, createContext());

      expect(listIds).toHaveBeenCalledWith(USER_ID);
      expect(response.status).toBe(200);
    });

    it("save — returns 200 with the saved state", async () => {
      const save = jest.fn(async () => ({
        postingId: POSTING_ID,
        saved: true,
        savedAt: "2026-08-01T12:00:00.000Z",
      }));
      const controller = createController({}, { savedPostings: { save } });
      const context = createContext({ params: { id: POSTING_ID } });

      const response = await invoke(controller.save, context);

      expect(save).toHaveBeenCalledWith(POSTING_ID, USER_ID);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          data: expect.objectContaining({ saved: true }),
        }),
      );
    });

    it("unsave — returns 200 with the cleared state", async () => {
      const unsave = jest.fn(async () => ({
        postingId: POSTING_ID,
        saved: false,
        savedAt: null,
      }));
      const controller = createController({}, { savedPostings: { unsave } });
      const context = createContext({ params: { id: POSTING_ID } });

      const response = await invoke(controller.unsave, context);

      expect(unsave).toHaveBeenCalledWith(POSTING_ID, USER_ID);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          data: expect.objectContaining({ saved: false, savedAt: null }),
        }),
      );
    });
  });
});
