import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { SavedSearchesController } from "@/features/saved-searches/saved-searches.controller";

const mockRequireJwtAuth = jest.fn();
const mockRequireSafeRouteParam = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

jest.mock("@/configuration/validation/input-sanitization", () => ({
  ...jest.requireActual("@/configuration/validation/input-sanitization"),
  requireSafeRouteParam: (...args: unknown[]) =>
    mockRequireSafeRouteParam(...args),
}));

function createAuth(
  overrides: Partial<JwtAuthPrincipal> = {},
): JwtAuthPrincipal {
  return {
    authMethod: "jwt",
    sub: "user-1",
    email: "user@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 1,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createContext(body?: unknown) {
  const context = {
    req: {
      json: async () => body ?? {},
    },
    get: (key: string) => {
      if (key === "container") {
        return {
          resolve: () => ({ inspectRequest: () => [] }),
        };
      }
      if (key === "requestId") return "req-1";
      return undefined;
    },
    json: (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
  };

  return context as unknown as Context<AppBindings>;
}

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "ss-1",
    userId: "user-1",
    name: "Camera Search",
    searchParams: { family: "equipment" },
    alertEnabled: true,
    createdAt: "2026-06-15T10:00:00.000Z",
    updatedAt: "2026-06-15T10:00:00.000Z",
    ...overrides,
  };
}

function createController(serviceOverrides: Record<string, unknown> = {}) {
  const service = {
    create: jest.fn(async () => makeRecord()),
    list: jest.fn(async () => [makeRecord()]),
    update: jest.fn(async () => makeRecord()),
    delete: jest.fn(async () => undefined),
    ...serviceOverrides,
  };

  return {
    controller: new SavedSearchesController(service as never),
    service,
  };
}

describe("SavedSearchesController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockRequireSafeRouteParam.mockReset();
  });

  describe("create", () => {
    it("creates a saved search and returns 201", async () => {
      mockRequireJwtAuth.mockResolvedValue(createAuth());
      const { controller, service } = createController();

      const response = await controller.create(
        createContext({
          name: "Camera Search",
          searchParams: { family: "equipment" },
          alertEnabled: true,
        }),
      );

      expect(mockRequireJwtAuth).toHaveBeenCalled();
      expect(service.create).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ name: "Camera Search" }),
      );
      expect(response.status).toBe(201);
    });

    it("propagates auth errors from requireJwtAuth", async () => {
      mockRequireJwtAuth.mockRejectedValue(new Error("Unauthorized"));
      const { controller } = createController();

      await expect(
        controller.create(createContext({ name: "x", searchParams: {} })),
      ).rejects.toThrow("Unauthorized");
    });
  });

  describe("list", () => {
    it("returns 200 with the user's saved searches", async () => {
      mockRequireJwtAuth.mockResolvedValue(createAuth());
      const { controller, service } = createController({
        list: jest.fn(async () => [makeRecord(), makeRecord({ id: "ss-2" })]),
      });

      const response = await controller.list(createContext());
      const payload = await response.json();

      expect(service.list).toHaveBeenCalledWith("user-1");
      expect(response.status).toBe(200);
      expect(Array.isArray(payload.data)).toBe(true);
      expect(payload.data).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("resolves the id from the route param and returns 200", async () => {
      mockRequireJwtAuth.mockResolvedValue(createAuth());
      mockRequireSafeRouteParam.mockReturnValue("ss-1");
      const { controller, service } = createController();

      const response = await controller.update(
        createContext({ alertEnabled: false }),
      );

      expect(mockRequireSafeRouteParam).toHaveBeenCalledWith(
        expect.anything(),
        "id",
      );
      expect(service.update).toHaveBeenCalledWith(
        "user-1",
        "ss-1",
        expect.objectContaining({ alertEnabled: false }),
      );
      expect(response.status).toBe(200);
    });
  });

  describe("delete", () => {
    it("resolves the id from the route param and returns 204", async () => {
      mockRequireJwtAuth.mockResolvedValue(createAuth());
      mockRequireSafeRouteParam.mockReturnValue("ss-1");
      const { controller, service } = createController();

      const response = await controller.delete(createContext());

      expect(service.delete).toHaveBeenCalledWith("user-1", "ss-1");
      expect(response.status).toBe(204);
    });
  });
});
