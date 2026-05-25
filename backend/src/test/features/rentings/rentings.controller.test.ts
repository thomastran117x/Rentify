import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { RentingsController } from "@/features/rentings/rentings.controller";
import type { JwtClaims } from "@/features/auth/token/token.service";

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    email: "user@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 0,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
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
      url: options?.url ?? "https://example.test/rentings/renting-1",
      param: (name?: string) =>
        name ? options?.params?.[name] : (options?.params ?? {}),
    },
    get: (name?: string) => {
      if (name === "requestId") {
        return "request-1";
      }

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

describe("RentingsController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
  });

  it("maps list query params into listMine inputs", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ sub: "user-1" }));
    const listMine = jest.fn(async () => ({
      rentings: [],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      status: "active",
    }));
    const controller = new RentingsController(
      {
        listMine,
      } as never,
      {} as never,
    );

    const response = await controller.listMine(
      createContext({
        url: "https://example.test/rentings/me?page=2&pageSize=5&status=active",
      }),
    );

    expect(listMine).toHaveBeenCalledWith({
      userId: "user-1",
      page: 2,
      pageSize: 5,
      status: "active",
    });
    expect(response.status).toBe(200);
  });

  it("routes renting instruction updates to the service", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: "owner-1", role: "owner" }),
    );
    const updateInstructions = jest.fn(async () => ({ id: "renting-1" }));
    const controller = new RentingsController(
      {
        updateInstructions,
      } as never,
      {} as never,
    );

    const response = await controller.updateInstructions(
      createContext({
        params: {
          id: "renting-1",
        },
        body: {
          pickupInstructions: "Meet outside.",
          returnInstructions: "Return to concierge.",
        },
      }),
    );

    expect(updateInstructions).toHaveBeenCalledWith({
      rentingId: "renting-1",
      actorUserId: "owner-1",
      actorRole: "owner",
      pickupInstructions: "Meet outside.",
      returnInstructions: "Return to concierge.",
    });
    expect(response.status).toBe(200);
  });

  it("routes dispute creation through the renting service", async () => {
    mockRequireJwtAuth.mockResolvedValue(
      createClaims({ sub: "renter-1", role: "user" }),
    );
    const createDispute = jest.fn(async () => ({ id: "renting-1" }));
    const controller = new RentingsController(
      {
        createDispute,
      } as never,
      {} as never,
    );

    const response = await controller.createDispute(
      createContext({
        params: {
          id: "renting-1",
        },
        body: {
          reason: "Condition mismatch",
          details: "The item arrived damaged.",
        },
      }),
    );

    expect(createDispute).toHaveBeenCalledWith({
      rentingId: "renting-1",
      actorUserId: "renter-1",
      actorRole: "user",
      reason: "Condition mismatch",
      details: "The item arrived damaged.",
    });
    expect(response.status).toBe(201);
  });
});
