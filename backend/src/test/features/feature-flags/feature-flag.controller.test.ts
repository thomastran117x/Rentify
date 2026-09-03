import { FeatureFlagController } from "@/features/feature-flags/feature-flag.controller";
import { createTestContext, invoke } from "../../support/mock-http";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import ForbiddenError from "@/errors/http/forbidden.error";
import { testUuid } from "../../support/uuid";

const ADMIN_1_ID = testUuid(9000, 185107);

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

function createAuth(
  overrides: Partial<JwtAuthPrincipal> = {},
): JwtAuthPrincipal {
  return {
    authMethod: "jwt",
    sub: ADMIN_1_ID,
    email: "admin@example.com",
    role: "admin",
    deviceId: "device-1",
    tokenVersion: 1,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createContext(
  options: {
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
) {
  const query = new URLSearchParams(options.query ?? {}).toString();

  return createTestContext({
    body: options.body,
    params: options.params,
    url: query ? `/?${query}` : "/",
    state: {
      requestId: "request-1",
      container: { resolve: () => ({ inspectRequest: () => [] }) },
    },
  });
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
      const controller = new FeatureFlagController({ listAll } as any);

      const response = await invoke(controller.list, createContext());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([flag("test-flag", true)]);
    });

    it("passes enabled=true filter from query param", async () => {
      const listAll = jest.fn(async () => []);
      const controller = new FeatureFlagController({ listAll } as any);

      await invoke(
        controller.list,
        createContext({ query: { enabled: "true" } }),
      );

      expect(listAll).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true }),
      );
    });

    it("passes enabled=false filter from query param", async () => {
      const listAll = jest.fn(async () => []);
      const controller = new FeatureFlagController({ listAll } as any);

      await invoke(
        controller.list,
        createContext({ query: { enabled: "false" } }),
      );

      expect(listAll).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      );
    });

    it("passes search filter from query param", async () => {
      const listAll = jest.fn(async () => []);
      const controller = new FeatureFlagController({ listAll } as any);

      await invoke(
        controller.list,
        createContext({ query: { search: "payments" } }),
      );

      expect(listAll).toHaveBeenCalledWith(
        expect.objectContaining({ search: "payments" }),
      );
    });

    it("passes group filter from query param", async () => {
      const listAll = jest.fn(async () => []);
      const controller = new FeatureFlagController({ listAll } as any);

      await invoke(
        controller.list,
        createContext({ query: { group: "payments" } }),
      );

      expect(listAll).toHaveBeenCalledWith(
        expect.objectContaining({ group: "payments" }),
      );
    });

    it("passes no filter when no query params are set", async () => {
      const listAll = jest.fn(async () => []);
      const controller = new FeatureFlagController({ listAll } as any);

      await invoke(controller.list, createContext());

      expect(listAll).toHaveBeenCalledWith({});
    });

    it("rejects non-admin callers", async () => {
      mockRequireJwtAuth.mockResolvedValue(createAuth({ role: "user" }));
      const controller = new FeatureFlagController({} as any);

      await expect(
        invoke(controller.list, createContext()),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("set", () => {
    it("creates or updates a flag and returns it", async () => {
      const setFlag = jest.fn(async () => flag("my-flag", true));
      const controller = new FeatureFlagController({ setFlag } as any);

      const response = await invoke(
        controller.set,
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
          actorUserId: ADMIN_1_ID,
        }),
      );
    });

    it("passes description when provided", async () => {
      const setFlag = jest.fn(async () => flag("my-flag", true));
      const controller = new FeatureFlagController({ setFlag } as any);

      await invoke(
        controller.set,
        createContext({
          body: { enabled: true, description: "my desc" },
          params: { name: "my-flag" },
        }),
      );

      expect(setFlag).toHaveBeenCalledWith(
        expect.objectContaining({ description: "my desc" }),
      );
    });

    it("passes group when provided", async () => {
      const setFlag = jest.fn(async () => flag("my-flag", true));
      const controller = new FeatureFlagController({ setFlag } as any);

      await invoke(
        controller.set,
        createContext({
          body: { enabled: true, group: "payments" },
          params: { name: "my-flag" },
        }),
      );

      expect(setFlag).toHaveBeenCalledWith(
        expect.objectContaining({ group: "payments" }),
      );
    });

    it("rejects non-admin callers", async () => {
      mockRequireJwtAuth.mockResolvedValue(createAuth({ role: "moderator" }));
      const controller = new FeatureFlagController({} as any);

      await expect(
        invoke(
          controller.set,
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
      const controller = new FeatureFlagController({ deleteFlag } as any);

      const response = await invoke(
        controller.delete,
        createContext({ params: { name: "my-flag" } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual(deleteResult);
      expect(deleteFlag).toHaveBeenCalledWith(
        expect.objectContaining({ name: "my-flag", actorUserId: ADMIN_1_ID }),
      );
    });

    it("rejects non-admin callers", async () => {
      mockRequireJwtAuth.mockResolvedValue(createAuth({ role: "owner" }));
      const controller = new FeatureFlagController({} as any);

      await expect(
        invoke(
          controller.delete,
          createContext({ params: { name: "my-flag" } }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
