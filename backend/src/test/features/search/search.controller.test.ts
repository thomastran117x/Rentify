import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { SearchController } from "@/features/search/search.controller";
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
        "https://example.test/api/v1/search/reindex/run-1?limit=15",
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
        headers: {
          "content-type": "application/json",
        },
      }),
  };

  return context as unknown as Context<AppBindings>;
}

describe("SearchController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockRequireJwtAuth.mockResolvedValue(createClaims());
  });

  it("returns a reindex run by route id", async () => {
    const getReindexRun = jest.fn(async () => ({
      id: "run-1",
      status: "running",
    }));
    const controller = new SearchController({
      getReindexRun,
    } as never);

    const response = await controller.getReindexRun(
      createContext({
        params: {
          id: "run-1",
        },
      }),
    );

    expect(getReindexRun).toHaveBeenCalledWith("run-1");
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: "Request completed successfully.",
      data: {
        id: "run-1",
        status: "running",
      },
      error: null,
      meta: {
        requestId: "request-1",
      },
    });
  });

  it("returns a null run payload when the run cannot be found", async () => {
    const controller = new SearchController({
      getReindexRun: jest.fn(async () => null),
    } as never);

    const response = await controller.getReindexRun(
      createContext({
        params: {
          id: "run-missing",
        },
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      data: {
        run: null,
      },
    });
  });

  it("parses replay limits and falls back for invalid values", async () => {
    const replayDeadLetteredOutbox = jest
      .fn(async () => ({
        accepted: 25,
      }))
      .mockResolvedValueOnce({
        accepted: 7,
      });
    const controller = new SearchController({
      replayDeadLetteredOutbox,
    } as never);

    await controller.replayDeadLettered(
      createContext({
        url: "https://example.test/api/v1/search/replay?limit=7",
      }),
    );
    const fallbackResponse = await controller.replayDeadLettered(
      createContext({
        url: "https://example.test/api/v1/search/replay?limit=-3",
      }),
    );

    expect(replayDeadLetteredOutbox).toHaveBeenNthCalledWith(1, 7);
    expect(replayDeadLetteredOutbox).toHaveBeenNthCalledWith(2, 100);
    await expect(fallbackResponse.json()).resolves.toMatchObject({
      message: "Dead-lettered search outbox entries are being replayed.",
    });
  });

  it("starts cleanup and status actions through accepted/ok envelopes", async () => {
    const cleanupRetainedIndices = jest.fn(async () => ({
      deletedIndices: 2,
    }));
    const getStatus = jest.fn(async () => ({
      ok: true,
      targetIndexName: "postings_v2",
    }));
    const controller = new SearchController({
      cleanupRetainedIndices,
      getStatus,
    } as never);

    const cleanupResponse = await controller.cleanupRetainedIndices(
      createContext(),
    );
    const statusResponse = await controller.getStatus(createContext());

    expect(cleanupRetainedIndices).toHaveBeenCalled();
    expect(getStatus).toHaveBeenCalled();
    expect(cleanupResponse.status).toBe(202);
    expect(statusResponse.status).toBe(200);
  });
});
