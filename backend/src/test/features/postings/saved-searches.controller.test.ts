import { createTestContext, invoke } from "../../support/mock-http";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { SavedSearchesController } from "@/features/postings/saved-searches/saved-searches.controller";

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: jest.fn(),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    email: "renter@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 0,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createRecord() {
  return {
    id: "00000000-0000-0000-2400-000000000001",
    name: "Kayaks",
    queryParams: { q: "kayak" },
    notifyFrequency: "instant" as const,
    newMatchCount: 0,
    lastCheckedAt: null,
    lastNotifiedAt: null,
    invalidated: false,
    createdAt: "2026-08-25T12:00:00.000Z",
  };
}

function createContext(options: {
  method?: string;
  url: string;
  params?: Record<string, string>;
  body?: unknown;
}) {
  return createTestContext({
    ...options,
    state: {
      requestId: "request-1",
      // The route-parameter guard resolves the sanitization service through
      // the request container, which only the real app composition populates.
      container: {
        resolve: () => ({
          inspectRequest: () => [],
        }),
      },
    },
  });
}

function createController(overrides: Record<string, unknown> = {}) {
  const service = {
    list: jest.fn(async () => ({
      searches: [createRecord()],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      limit: 20,
    })),
    create: jest.fn(async () => createRecord()),
    update: jest.fn(async () => createRecord()),
    remove: jest.fn(async () => undefined),
    markSeen: jest.fn(async () => undefined),
    ...overrides,
  };

  return {
    service,
    controller: new SavedSearchesController(service as never),
  };
}

beforeEach(() => {
  mockRequireJwtAuth.mockReset();
  mockRequireJwtAuth.mockResolvedValue(createClaims());
});

describe("SavedSearchesController", () => {
  describe("list", () => {
    it("passes the pagination query through and returns pagination meta", async () => {
      const { controller, service } = createController();
      const context = createContext({
        url: "/postings/saved/searches?page=2&pageSize=5",
      });

      const response = await invoke(controller.list, context);

      expect(service.list).toHaveBeenCalledWith("user-1", 2, 5);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        meta: expect.objectContaining({ pagination: expect.anything() }),
      });
    });

    it("defaults the pagination when the caller sends none", async () => {
      const { controller, service } = createController();
      const context = createContext({ url: "/postings/saved/searches" });

      await invoke(controller.list, context);

      expect(service.list).toHaveBeenCalledWith("user-1", 1, 20);
    });

    it("rejects a page size beyond the maximum", async () => {
      const { controller, service } = createController();
      const context = createContext({
        url: "/postings/saved/searches?pageSize=5000",
      });

      await expect(invoke(controller.list, context)).rejects.toThrow();
      expect(service.list).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("returns 201 with the saved search", async () => {
      const { controller, service } = createController();
      const context = createContext({
        method: "POST",
        url: "/postings/saved/searches",
        body: { queryParams: { q: "kayak" }, notifyFrequency: "instant" },
      });

      const response = await invoke(controller.create, context);

      expect(service.create).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ notifyFrequency: "instant" }),
      );
      expect(response.status).toBe(201);
    });

    it("rejects a body carrying a filter the search does not support", async () => {
      const { controller, service } = createController();
      const context = createContext({
        method: "POST",
        url: "/postings/saved/searches",
        body: { queryParams: { noSuchFilter: true } },
      });

      await expect(invoke(controller.create, context)).rejects.toThrow();
      expect(service.create).not.toHaveBeenCalled();
    });

    it("rejects a search with no filters at all", async () => {
      const { controller, service } = createController();
      const context = createContext({
        method: "POST",
        url: "/postings/saved/searches",
        body: { queryParams: {} },
      });

      await expect(invoke(controller.create, context)).rejects.toThrow();
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("passes the route identifier and the patch through", async () => {
      const { controller, service } = createController();
      const context = createContext({
        method: "PATCH",
        url: "/postings/saved/searches/00000000-0000-0000-2400-000000000001",
        params: { id: "00000000-0000-0000-2400-000000000001" },
        body: { notifyFrequency: "daily" },
      });

      const response = await invoke(controller.update, context);

      expect(service.update).toHaveBeenCalledWith(
        "00000000-0000-0000-2400-000000000001",
        "user-1",
        { notifyFrequency: "daily" },
      );
      expect(response.status).toBe(200);
    });

    it("rejects an update that changes nothing", async () => {
      const { controller, service } = createController();
      const context = createContext({
        method: "PATCH",
        url: "/postings/saved/searches/00000000-0000-0000-2400-000000000001",
        params: { id: "00000000-0000-0000-2400-000000000001" },
        body: {},
      });

      await expect(invoke(controller.update, context)).rejects.toThrow();
      expect(service.update).not.toHaveBeenCalled();
    });

    it("rejects a route identifier carrying unsafe characters", async () => {
      const { controller, service } = createController();
      const context = createContext({
        method: "PATCH",
        url: "/postings/saved/searches/bad",
        params: { id: "bad id!" },
        body: { notifyFrequency: "daily" },
      });

      await expect(invoke(controller.update, context)).rejects.toThrow();
      expect(service.update).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("returns 204", async () => {
      const { controller, service } = createController();
      const context = createContext({
        method: "DELETE",
        url: "/postings/saved/searches/00000000-0000-0000-2400-000000000001",
        params: { id: "00000000-0000-0000-2400-000000000001" },
      });

      const response = await invoke(controller.remove, context);

      expect(service.remove).toHaveBeenCalledWith(
        "00000000-0000-0000-2400-000000000001",
        "user-1",
      );
      expect(response.status).toBe(204);
    });
  });

  describe("markSeen", () => {
    it("returns 204", async () => {
      const { controller, service } = createController();
      const context = createContext({
        method: "POST",
        url: "/postings/saved/searches/00000000-0000-0000-2400-000000000001/seen",
        params: { id: "00000000-0000-0000-2400-000000000001" },
      });

      const response = await invoke(controller.markSeen, context);

      expect(service.markSeen).toHaveBeenCalledWith(
        "00000000-0000-0000-2400-000000000001",
        "user-1",
      );
      expect(response.status).toBe(204);
    });
  });

  it("requires authentication on every operation", async () => {
    mockRequireJwtAuth.mockRejectedValue(new Error("unauthenticated"));

    const { controller, service } = createController();
    const context = createContext({ url: "/postings/saved/searches" });

    await expect(invoke(controller.list, context)).rejects.toThrow();
    expect(service.list).not.toHaveBeenCalled();
  });
});
