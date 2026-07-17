import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { OrganizationsSearchController } from "@/features/organizations/search/organizations-search.controller";
import type { JwtClaims } from "@/features/auth/token/token.service";

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "admin-1",
    email: "admin@example.com",
    role: "admin",
    tokenVersion: 0,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createContext(options?: {
  url?: string;
  params?: Record<string, string>;
}) {
  const variables = new Map<string, unknown>();
  variables.set("requestId", "request-1");
  variables.set("container", {
    resolve: () => ({
      inspectRequest: () => [],
    }),
  });

  const context = {
    req: {
      url:
        options?.url ??
        "https://example.test/api/v1/admin/organizations/search/reindex-runs/run-1?limit=15",
      param: (name?: string) =>
        name ? options?.params?.[name] : (options?.params ?? {}),
    },
    get: (name: string) => variables.get(name),
    set: (name: string, value: unknown) => {
      variables.set(name, value);
    },
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  };

  return context as unknown as Context<AppBindings>;
}

describe("OrganizationsSearchController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockRequireJwtAuth.mockResolvedValue(createClaims());
  });

  it("starts a reindex through the accepted envelope", async () => {
    const startReindex = jest.fn(async () => ({
      id: "run-1",
      status: "pending",
    }));
    const controller = new OrganizationsSearchController({
      startReindex,
    } as any);

    const response = await controller.startReindex(createContext());

    expect(startReindex).toHaveBeenCalled();
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      message: "Organization search reindex has been started.",
    });
  });

  it("returns a reindex run by route id", async () => {
    const getReindexRun = jest.fn(async () => ({
      id: "run-1",
      status: "running",
    }));
    const controller = new OrganizationsSearchController({
      getReindexRun,
    } as any);

    const response = await controller.getReindexRun(
      createContext({ params: { id: "run-1" } }),
    );

    expect(getReindexRun).toHaveBeenCalledWith("run-1");
    await expect(response.json()).resolves.toMatchObject({
      data: { id: "run-1", status: "running" },
    });
  });

  it("returns a null run payload when the run is missing", async () => {
    const controller = new OrganizationsSearchController({
      getReindexRun: jest.fn(async () => null),
    } as any);

    const response = await controller.getReindexRun(
      createContext({ params: { id: "missing" } }),
    );

    await expect(response.json()).resolves.toMatchObject({
      data: { run: null },
    });
  });

  it("parses replay limits and falls back for invalid values", async () => {
    const replayDeadLetteredOutbox = jest.fn(async () => ({ revived: 3 }));
    const controller = new OrganizationsSearchController({
      replayDeadLetteredOutbox,
    } as any);

    await controller.replayDeadLettered(
      createContext({ url: "https://example.test/x?limit=7" }),
    );
    await controller.replayDeadLettered(
      createContext({ url: "https://example.test/x?limit=-3" }),
    );

    expect(replayDeadLetteredOutbox).toHaveBeenNthCalledWith(1, 7);
    expect(replayDeadLetteredOutbox).toHaveBeenNthCalledWith(2, 100);
  });

  it("exposes status and cleanup actions", async () => {
    const getStatus = jest.fn(async () => ({ ok: true }));
    const cleanupRetainedIndices = jest.fn(async () => ({ deleted: 1 }));
    const controller = new OrganizationsSearchController({
      getStatus,
      cleanupRetainedIndices,
    } as any);

    const statusResponse = await controller.getStatus(createContext());
    const cleanupResponse =
      await controller.cleanupRetainedIndices(createContext());

    expect(getStatus).toHaveBeenCalled();
    expect(cleanupRetainedIndices).toHaveBeenCalled();
    expect(statusResponse.status).toBe(200);
    expect(cleanupResponse.status).toBe(202);
  });

  it("rejects non-admin callers", async () => {
    mockRequireJwtAuth.mockResolvedValue(createClaims({ role: "user" }));
    const startReindex = jest.fn();
    const controller = new OrganizationsSearchController({
      startReindex,
    } as any);

    await expect(
      controller.startReindex(createContext()),
    ).rejects.toBeDefined();
    expect(startReindex).not.toHaveBeenCalled();
  });
});
