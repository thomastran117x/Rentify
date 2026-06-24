import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { FeatureFlagController } from "@/features/feature-flags/feature-flag.controller";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import ForbiddenError from "@/errors/http/forbidden.error";

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

function createAuth(overrides: Partial<JwtAuthPrincipal> = {}): JwtAuthPrincipal {
  return {
    authMethod: "jwt",
    sub: "admin-1",
    email: "admin@example.com",
    role: "admin",
    deviceId: "device-1",
    tokenVersion: 1,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createContext(options: {
  body?: unknown;
  params?: Record<string, string>;
} = {}) {
  const context = {
    req: {
      json: async () => options.body ?? {},
      param: (name: string) => options.params?.[name],
    },
    get: (key: string) => {
      if (key === "requestId") return "request-1";
      return { resolve: () => ({ inspectRequest: () => [] }) };
    },
    json: (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
  };
  return context as unknown as Context<AppBindings>;
}

const flag = (name: string, enabled: boolean) => ({
  name,
  enabled,
  source: "db" as const,
  description: null,
});

describe("FeatureFlagController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockRequireJwtAuth.mockResolvedValue(createAuth());
  });

  describe("list", () => {
    it("returns all flags for an admin", async () => {
      const listAll = jest.fn(async () => [flag("test-flag", true)]);
      const controller = new FeatureFlagController({ listAll } as never);

      const response = await controller.list(createContext());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([flag("test-flag", true)]);
    });

    it("rejects non-admin callers", async () => {
      mockRequireJwtAuth.mockResolvedValue(createAuth({ role: "user" }));
      const controller = new FeatureFlagController({} as never);

      await expect(controller.list(createContext())).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  describe("set", () => {
    it("creates or updates a flag and returns it", async () => {
      const setFlag = jest.fn(async () => flag("my-flag", true));
      const controller = new FeatureFlagController({ setFlag } as never);

      const response = await controller.set(
        createContext({
          body: { enabled: true },
          params: { name: "my-flag" },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual(flag("my-flag", true));
      expect(setFlag).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "my-flag",
          enabled: true,
          actorUserId: "admin-1",
        }),
      );
    });

    it("passes description when provided", async () => {
      const setFlag = jest.fn(async () => flag("my-flag", true));
      const controller = new FeatureFlagController({ setFlag } as never);

      await controller.set(
        createContext({
          body: { enabled: true, description: "my desc" },
          params: { name: "my-flag" },
        }),
      );

      expect(setFlag).toHaveBeenCalledWith(
        expect.objectContaining({ description: "my desc" }),
      );
    });

    it("rejects non-admin callers", async () => {
      mockRequireJwtAuth.mockResolvedValue(createAuth({ role: "moderator" }));
      const controller = new FeatureFlagController({} as never);

      await expect(
        controller.set(
          createContext({
            body: { enabled: true },
            params: { name: "my-flag" },
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("delete", () => {
    it("deletes a flag override and returns the effective state", async () => {
      const deleteResult = {
        name: "my-flag",
        deletedOverride: true,
        effectiveEnabled: false,
        effectiveSource: "default" as const,
      };
      const deleteFlag = jest.fn(async () => deleteResult);
      const controller = new FeatureFlagController({ deleteFlag } as never);

      const response = await controller.delete(
        createContext({ params: { name: "my-flag" } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual(deleteResult);
      expect(deleteFlag).toHaveBeenCalledWith(
        expect.objectContaining({ name: "my-flag", actorUserId: "admin-1" }),
      );
    });

    it("rejects non-admin callers", async () => {
      mockRequireJwtAuth.mockResolvedValue(createAuth({ role: "owner" }));
      const controller = new FeatureFlagController({} as never);

      await expect(
        controller.delete(createContext({ params: { name: "my-flag" } })),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
