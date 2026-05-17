import { RequestValidationError } from "@/configuration/validation/request";
import type { AppBindings } from "@/configuration/http/bindings";
import { PostingsController } from "@/features/postings/postings.controller";
import type { JwtClaims } from "@/features/auth/token/token.service";
import type { Context } from "hono";

const mockRequireJwtAuth = jest.fn();
const mockGetOptionalJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "owner-1",
    email: "owner@example.com",
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

function createContext(options?: {
  body?: unknown;
  url?: string;
  params?: Record<string, string>;
}) {
  const context = {
    req: {
      json: async () => options?.body ?? {},
      url: options?.url ?? "https://example.test/postings",
      param: (name?: string) => (name ? options?.params?.[name] : options?.params ?? {}),
    },
    get: (name?: string) => {
      if (name === "client") {
        return {
          ip: "127.0.0.1",
          device: {
            id: "device-1",
            type: "desktop",
            isMobile: false,
            userAgent: "test-agent",
            platform: "test-os",
          },
        };
      }

      if (name === "requestId") {
        return "request-1";
      }

      return {
        resolve: () => ({
          inspectRequest: () => [],
        }),
      };
    },
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
        },
      }),
  };

  return context as unknown as Context<AppBindings>;
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
    const controller = new PostingsController(
      {
        searchPublic,
      } as never,
      {
        trackSearchImpressions: jest.fn(async () => undefined),
      } as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      url: "https://example.test/postings?page=2&pageSize=5&family=vehicle&subtype=car",
    });

    const response = await controller.search(context);

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
    const controller = new PostingsController(
      {
        searchPublic,
      } as never,
      {
        trackSearchImpressions: jest.fn(async () => undefined),
      } as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      url: "https://example.test/postings?family=place&subtype=entire_place&attr.bedrooms.min=2&attr.bedrooms.max=4&attr.amenities=wifi&attr.amenities=desk",
    });

    await controller.search(context);

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
    const controller = new PostingsController(
      {
        searchPublic,
      } as never,
      {
        trackSearchImpressions: jest.fn(async () => undefined),
      } as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      url: "https://example.test/postings?latitude=43.6532&longitude=-79.3832&radiusKm=12",
    });

    await controller.search(context);

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
    const controller = new PostingsController(
      {
        searchPublic,
      } as never,
      {
        trackSearchImpressions: jest.fn(async () => undefined),
      } as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      url: "https://example.test/postings?latitude=43.6532&radiusKm=12",
    });

    await expect(controller.search(context)).rejects.toMatchObject<Partial<RequestValidationError>>({
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
    const controller = new PostingsController(
      {
        searchPublic,
      } as never,
      {
        trackSearchImpressions: jest.fn(async () => undefined),
      } as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      url: "https://example.test/postings?page=&pageSize=&q=&family=&subtype=&availabilityStatus=&minDailyPrice=&maxDailyPrice=&latitude=&longitude=&radiusKm=&startAt=&endAt=&sort=&attr.bedrooms.min=",
    });

    await controller.search(context);

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
    const controller = new PostingsController(
      {
        searchPublic,
      } as never,
      {
        trackSearchImpressions: jest.fn(async () => {
          throw new Error("analytics unavailable");
        }),
      } as never,
      {} as never,
      {} as never,
    );
    const context = createContext();

    const response = await controller.search(context);

    expect(searchPublic).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it("rejects create requests that omit the required variant", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const createDraft = jest.fn();
    const controller = new PostingsController(
      {
        createDraft,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      body: {
        name: "Test posting",
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

    await expect(controller.create(context)).rejects.toMatchObject<
      Partial<RequestValidationError>
    >({
      details: [
        {
          path: "",
        },
      ],
    });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("rejects create requests whose tags contain commas", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const createDraft = jest.fn();
    const controller = new PostingsController(
      {
        createDraft,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      body: {
        variant: {
          family: "place",
          subtype: "entire_place",
        },
        name: "Test posting",
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

    await expect(controller.create(context)).rejects.toMatchObject<
      Partial<RequestValidationError>
    >({
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
    const controller = new PostingsController(
      {
        update,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      params: {
        id: "posting-1",
      },
      body: {
        variant: {
          family: "place",
          subtype: "entire_place",
        },
        name: "Test posting",
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

    await expect(controller.update(context)).rejects.toMatchObject<
      Partial<RequestValidationError>
    >({
      details: [
        {
          path: "",
        },
      ],
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("routes duplicate with posting id and owner id", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const duplicate = jest.fn(async () => ({
      id: "posting-2",
      status: "draft",
    }));
    const controller = new PostingsController(
      {
        duplicate,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      params: {
        id: "posting-1",
      },
    });

    const response = await controller.duplicate(context);

    expect(duplicate).toHaveBeenCalledWith("posting-1", "owner-1");
    expect(response.status).toBe(201);
  });

  it("routes availability block creation with posting id and owner id", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const createOwnerAvailabilityBlock = jest.fn(async () => ({
      id: "block-1",
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-03T00:00:00.000Z",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    }));
    const controller = new PostingsController(
      {
        createOwnerAvailabilityBlock,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      params: {
        id: "posting-1",
      },
      body: {
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-03T00:00:00.000Z",
        note: "Maintenance",
      },
    });

    const response = await controller.createAvailabilityBlock(context);

    expect(createOwnerAvailabilityBlock).toHaveBeenCalledWith("posting-1", "owner-1", {
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-03T00:00:00.000Z",
      note: "Maintenance",
    });
    expect(response.status).toBe(201);
  });

  it("routes availability block update with block id", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const updateOwnerAvailabilityBlock = jest.fn(async () => ({
      id: "block-1",
      startAt: "2026-05-02T00:00:00.000Z",
      endAt: "2026-05-04T00:00:00.000Z",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    }));
    const controller = new PostingsController(
      {
        updateOwnerAvailabilityBlock,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      params: {
        id: "posting-1",
        blockId: "block-1",
      },
      body: {
        startAt: "2026-05-02T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
      },
    });

    const response = await controller.updateAvailabilityBlock(context);

    expect(updateOwnerAvailabilityBlock).toHaveBeenCalledWith("posting-1", "owner-1", "block-1", {
      startAt: "2026-05-02T00:00:00.000Z",
      endAt: "2026-05-04T00:00:00.000Z",
      note: undefined,
    });
    expect(response.status).toBe(200);
  });

  it("routes pause and unpause with posting id and owner id", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims());
    const pause = jest.fn(async () => ({
      id: "posting-1",
      status: "paused",
    }));
    const unpause = jest.fn(async () => ({
      id: "posting-1",
      status: "published",
    }));
    const controller = new PostingsController(
      {
        pause,
        unpause,
      } as never,
      {} as never,
      {} as never,
      {
        publishPostingLifecycle: jest.fn(async () => undefined),
      } as never,
    );
    const context = createContext({
      params: {
        id: "posting-1",
      },
    });

    const pauseResponse = await controller.pause(context);
    const unpauseResponse = await controller.unpause(context);

    expect(pause).toHaveBeenCalledWith("posting-1", "owner-1");
    expect(unpause).toHaveBeenCalledWith("posting-1", "owner-1");
    expect(pauseResponse.status).toBe(200);
    expect(unpauseResponse.status).toBe(200);
  });

  it("requires owner auth for listing availability blocks", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ role: "renter" }));
    const listOwnerAvailabilityBlocks = jest.fn();
    const controller = new PostingsController(
      {
        listOwnerAvailabilityBlocks,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const context = createContext({
      params: {
        id: "posting-1",
      },
    });

    await expect(controller.listAvailabilityBlocks(context)).rejects.toThrow();
    expect(listOwnerAvailabilityBlocks).not.toHaveBeenCalled();
  });

  it("tracks search click activity and returns 202", async () => {
    mockGetOptionalJwtAuth.mockResolvedValue(null);
    const publishSearchClick = jest.fn(async () => undefined);
    const controller = new PostingsController(
      {} as never,
      {
        trackSearchClick: jest.fn(async () => undefined),
      } as never,
      {} as never,
      {
        publishSearchClick,
      } as never,
    );
    const context = createContext({
      params: {
        id: "posting-1",
      },
      body: {
        searchSessionId: "search-1",
        page: 1,
        position: 0,
        hasGeoFilter: false,
        hasAvailabilityFilter: true,
      },
    });

    const response = await controller.trackSearchClick(context);

    expect(publishSearchClick).toHaveBeenCalledWith(
      expect.objectContaining({
        postingId: "posting-1",
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
    const controller = new PostingsController(
      {
        getById: jest.fn(async () => ({
          id: "posting-1",
          ownerId: "owner-1",
          status: "published",
        })),
      } as never,
      {
        trackPublicView,
      } as never,
      {} as never,
      {
        publishPostingView,
      } as never,
    );
    const context = createContext({
      params: {
        id: "posting-1",
      },
      url: "https://example.test/postings/posting-1",
    });

    const response = await controller.getById(context);

    expect(trackPublicView).toHaveBeenCalledTimes(1);
    expect(publishPostingView).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });
});
