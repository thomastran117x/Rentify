import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { RequestValidationError } from "@/configuration/validation/request";
import { RecommendationsController } from "@/features/recommendations/recommendations.controller";

const mockGetOptionalJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

function createContext(url: string) {
  const context = {
    req: {
      url,
    },
    get: (name: string) => {
      if (name === "requestId") {
        return "request-1";
      }

      return undefined;
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

describe("RecommendationsController", () => {
  beforeEach(() => {
    mockGetOptionalJwtAuth.mockReset();
  });

  it("maps recommendation query params into the service input", async () => {
    const getRecommendations = jest.fn(async () => ({
      items: [],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      mode: "popular" as const,
      fallback: false,
    }));
    const controller = new RecommendationsController({
      getRecommendations,
    } as never);
    const context = createContext(
      "https://example.test/postings/recommendations?page=2&pageSize=5&family=vehicle&subtype=car&latitude=43.7&longitude=-79.4&radiusKm=25&startAt=2026-05-08T00:00:00.000Z&endAt=2026-05-09T00:00:00.000Z",
    );
    mockGetOptionalJwtAuth.mockResolvedValue({
      authMethod: "jwt",
      sub: "user-1",
    });

    const response = await controller.list(context);

    expect(getRecommendations).toHaveBeenCalledWith(
      {
        page: 2,
        pageSize: 5,
        family: "vehicle",
        subtype: "car",
        geo: {
          latitude: 43.7,
          longitude: -79.4,
          radiusKm: 25,
        },
        availabilityWindow: {
          startAt: "2026-05-08T00:00:00.000Z",
          endAt: "2026-05-09T00:00:00.000Z",
        },
      },
      expect.objectContaining({
        authMethod: "jwt",
        sub: "user-1",
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        items: [],
        pagination: {
          page: 2,
          pageSize: 5,
          total: 0,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: true,
        },
        mode: "popular",
        fallback: false,
      },
      error: null,
      message: "Request completed successfully.",
      meta: {
        requestId: "request-1",
        pagination: {
          page: 2,
          pageSize: 5,
          total: 0,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: true,
        },
        mode: "popular",
        fallback: false,
      },
    });
  });

  it("returns wrapped items without exposing internal score fields", async () => {
    const getRecommendations = jest.fn(async () => ({
      items: [
        {
          posting: {
            id: "posting-1",
          },
          reasonCodes: ["popular"],
        },
      ],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      mode: "popular" as const,
      fallback: false,
      snapshotGeneratedAt: "2026-05-08T09:00:00.000Z",
    }));
    const controller = new RecommendationsController({
      getRecommendations,
    } as never);
    const context = createContext(
      "https://example.test/postings/recommendations",
    );
    mockGetOptionalJwtAuth.mockResolvedValue(null);

    const response = await controller.list(context);
    const payload = await response.json();

    expect(payload).toEqual({
      success: true,
      data: {
        items: [
          {
            posting: {
              id: "posting-1",
            },
            reasonCodes: ["popular"],
          },
        ],
        pagination: {
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        mode: "popular",
        fallback: false,
        snapshotGeneratedAt: "2026-05-08T09:00:00.000Z",
      },
      error: null,
      message: "Request completed successfully.",
      meta: {
        requestId: "request-1",
        pagination: {
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        mode: "popular",
        fallback: false,
        snapshotGeneratedAt: "2026-05-08T09:00:00.000Z",
      },
    });
    expect(payload.data.items[0]).not.toHaveProperty("score");
  });

  it("allows anonymous requests", async () => {
    const getRecommendations = jest.fn(async () => ({
      items: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      mode: "popular" as const,
      fallback: false,
    }));
    const controller = new RecommendationsController({
      getRecommendations,
    } as never);
    const context = createContext(
      "https://example.test/postings/recommendations",
    );
    mockGetOptionalJwtAuth.mockResolvedValue(null);

    await controller.list(context);

    expect(getRecommendations).toHaveBeenCalledWith(
      {
        page: 1,
        pageSize: 20,
        family: undefined,
        subtype: undefined,
        geo: undefined,
        availabilityWindow: undefined,
      },
      null,
    );
  });

  it("rejects incomplete availability window filters", async () => {
    const controller = new RecommendationsController({
      getRecommendations: jest.fn(),
    } as never);
    const context = createContext(
      "https://example.test/postings/recommendations?startAt=2026-05-08T00:00:00.000Z",
    );

    await expect(controller.list(context)).rejects.toMatchObject<
      Partial<RequestValidationError>
    >({
      message: "Request query validation failed.",
      details: [
        {
          path: "startAt",
          message: "startAt and endAt must be provided together.",
        },
      ],
    });
  });
});
