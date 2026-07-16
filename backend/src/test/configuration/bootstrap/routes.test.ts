import { Hono } from "hono";
import { mountRoutes } from "@/configuration/bootstrap/routes";
import { filterRouteModules } from "@/configuration/bootstrap/routes/registry";
import {
  containerTokens,
  type ServiceContainer,
} from "@/configuration/bootstrap/container";
import { buildApiPath } from "@/configuration/http/api-path";
import type { AppBindings } from "@/configuration/http/bindings";
import type {
  RouteModule,
  RouteModuleId,
} from "@/configuration/bootstrap/routes/types";

class FakeRequestContainer implements ServiceContainer {
  constructor(private readonly services: Map<unknown, unknown>) {}

  resolve<TValue>(token: unknown): TValue {
    if (!this.services.has(token)) {
      throw new Error("Unsupported test container token.");
    }

    return this.services.get(token) as TValue;
  }

  createScope(): ServiceContainer {
    return this;
  }

  async dispose(): Promise<void> {}
}

function createApp(services: Map<unknown, unknown> = new Map()) {
  const container = new FakeRequestContainer(services);
  const app = new Hono<AppBindings>();

  app.use("*", async (context, next) => {
    context.set("container", container);
    await next();
  });

  mountRoutes(app);
  return app;
}

describe("mountRoutes", () => {
  const originalDisabledRouteModules = process.env.DISABLED_ROUTE_MODULES;

  afterEach(() => {
    if (originalDisabledRouteModules === undefined) {
      delete process.env.DISABLED_ROUTE_MODULES;
    } else {
      process.env.DISABLED_ROUTE_MODULES = originalDisabledRouteModules;
    }
  });

  it("mounts enabled route modules by default", async () => {
    delete process.env.DISABLED_ROUTE_MODULES;
    const blobController = {
      createUploadUrl: async (
        context: Parameters<
          Exclude<typeof createApp, undefined>
        >[0] extends never
          ? never
          : never,
      ) => {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=UTF-8",
          },
          status: 200,
        });
      },
    };
    const app = createApp(
      new Map([[containerTokens.blobController, blobController]]),
    );

    const response = await app.request(
      `http://rent.test${buildApiPath("/blob/upload-url")}`,
      {
        method: "POST",
      },
    );
    const legacyResponse = await app.request(
      "http://rent.test/blob/upload-url",
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(legacyResponse.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
  });

  it("does not mount disabled route modules", async () => {
    process.env.DISABLED_ROUTE_MODULES = "blob";
    const app = createApp(
      new Map([
        [
          containerTokens.blobController,
          {
            createUploadUrl: async () =>
              new Response(JSON.stringify({ ok: true }), {
                headers: {
                  "content-type": "application/json; charset=UTF-8",
                },
                status: 200,
              }),
          },
        ],
      ]),
    );

    const response = await app.request(
      `http://rent.test${buildApiPath("/blob/upload-url")}`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(404);
  });

  it("disabling one module does not affect neighboring modules", async () => {
    process.env.DISABLED_ROUTE_MODULES = "auth-local";
    const authController = {
      linkedOAuthProviders: async () =>
        new Response(JSON.stringify({ providers: ["google"] }), {
          headers: {
            "content-type": "application/json; charset=UTF-8",
          },
          status: 200,
        }),
      localAuthenticate: async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=UTF-8",
          },
          status: 200,
        }),
    };
    const app = createApp(
      new Map([[containerTokens.authController, authController]]),
    );

    const disabledResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
      },
    );
    const enabledResponse = await app.request(
      `http://rent.test${buildApiPath("/auth/oauth/providers")}`,
    );

    expect(disabledResponse.status).toBe(404);
    expect(enabledResponse.status).toBe(200);
    await expect(enabledResponse.json()).resolves.toEqual({
      providers: ["google"],
    });
  });

  it("preserves static-before-dynamic postings route behavior", async () => {
    delete process.env.DISABLED_ROUTE_MODULES;
    const postingsController = {
      analyticsSummary: async () =>
        new Response(JSON.stringify({ route: "analyticsSummary" }), {
          headers: {
            "content-type": "application/json; charset=UTF-8",
          },
          status: 200,
        }),
      batchPublic: async () =>
        new Response(JSON.stringify({ route: "batchPublic" }), {
          headers: {
            "content-type": "application/json; charset=UTF-8",
          },
          status: 200,
        }),
      getById: async (context: { req: { param(name: string): string } }) =>
        new Response(
          JSON.stringify({ id: context.req.param("id"), route: "getById" }),
          {
            headers: {
              "content-type": "application/json; charset=UTF-8",
            },
            status: 200,
          },
        ),
      listMine: async () =>
        new Response(JSON.stringify({ route: "listMine" }), {
          headers: {
            "content-type": "application/json; charset=UTF-8",
          },
          status: 200,
        }),
      search: async () =>
        new Response(JSON.stringify({ route: "search" }), {
          headers: {
            "content-type": "application/json; charset=UTF-8",
          },
          status: 200,
        }),
    };
    const app = createApp(
      new Map([[containerTokens.postingsController, postingsController]]),
    );

    const [batchResponse, mineResponse, analyticsResponse, itemResponse] =
      await Promise.all([
        app.request(`http://rent.test${buildApiPath("/postings/batch")}`),
        app.request(`http://rent.test${buildApiPath("/postings/me")}`),
        app.request(
          `http://rent.test${buildApiPath("/postings/analytics/summary")}`,
        ),
        app.request(`http://rent.test${buildApiPath("/postings/posting-123")}`),
      ]);

    await expect(batchResponse.json()).resolves.toEqual({
      route: "batchPublic",
    });
    await expect(mineResponse.json()).resolves.toEqual({ route: "listMine" });
    await expect(analyticsResponse.json()).resolves.toEqual({
      route: "analyticsSummary",
    });
    await expect(itemResponse.json()).resolves.toEqual({
      id: "posting-123",
      route: "getById",
    });
  });

  it("preserves static-before-dynamic organization route behavior", async () => {
    delete process.env.DISABLED_ROUTE_MODULES;
    const organizationsController = {
      listMine: async () =>
        new Response(JSON.stringify({ route: "listMine" }), {
          headers: {
            "content-type": "application/json; charset=UTF-8",
          },
          status: 200,
        }),
      previewInvitation: async (context: {
        req: { param(name: string): string };
      }) =>
        new Response(
          JSON.stringify({
            route: "previewInvitation",
            token: context.req.param("token"),
          }),
          {
            headers: {
              "content-type": "application/json; charset=UTF-8",
            },
            status: 200,
          },
        ),
      getWorkspaceById: async (context: {
        req: { param(name: string): string };
      }) =>
        new Response(
          JSON.stringify({
            route: "getWorkspaceById",
            id: context.req.param("id"),
          }),
          {
            headers: {
              "content-type": "application/json; charset=UTF-8",
            },
            status: 200,
          },
        ),
      getById: async (context: { req: { param(name: string): string } }) =>
        new Response(
          JSON.stringify({ route: "getById", id: context.req.param("id") }),
          {
            headers: {
              "content-type": "application/json; charset=UTF-8",
            },
            status: 200,
          },
        ),
    };
    const app = createApp(
      new Map([
        [containerTokens.organizationsController, organizationsController],
      ]),
    );

    const [mineResponse, invitationResponse, workspaceResponse, itemResponse] =
      await Promise.all([
        app.request(`http://rent.test${buildApiPath("/organizations/me")}`),
        app.request(
          `http://rent.test${buildApiPath("/organizations/invitations/token-123")}`,
        ),
        app.request(
          `http://rent.test${buildApiPath("/organizations/org-123/workspace")}`,
        ),
        app.request(`http://rent.test${buildApiPath("/organizations/org-123")}`),
      ]);

    await expect(mineResponse.json()).resolves.toEqual({
      route: "listMine",
    });
    await expect(invitationResponse.json()).resolves.toEqual({
      route: "previewInvitation",
      token: "token-123",
    });
    await expect(workspaceResponse.json()).resolves.toEqual({
      route: "getWorkspaceById",
      id: "org-123",
    });
    await expect(itemResponse.json()).resolves.toEqual({
      route: "getById",
      id: "org-123",
    });
  });
});

function makeModule(id: RouteModuleId, featureId?: string): RouteModule {
  return {
    id,
    featureId,
    register: () => {},
  };
}

describe("filterRouteModules", () => {
  it("includes all modules when nothing is disabled", () => {
    const modules = [makeModule("blob"), makeModule("profiles")];
    const result = filterRouteModules(modules, new Set());
    expect(result.map((m) => m.id)).toEqual(["blob", "profiles"]);
  });

  it("excludes modules whose id is in the disabled set", () => {
    const modules = [makeModule("blob"), makeModule("profiles")];
    const result = filterRouteModules(
      modules,
      new Set<RouteModuleId>(["blob"]),
    );
    expect(result.map((m) => m.id)).toEqual(["profiles"]);
  });

  it("includes feature-gated modules regardless of featureId (gating is per-request, not startup)", () => {
    const modules = [
      makeModule("blob", "file-uploads"),
      makeModule("profiles"),
    ];
    const result = filterRouteModules(modules, new Set());
    expect(result.map((m) => m.id)).toEqual(["blob", "profiles"]);
  });

  it("only DISABLED_ROUTE_MODULES excludes a module at startup", () => {
    const modules = [
      makeModule("blob", "file-uploads"),
      makeModule("profiles", "user-profiles"),
      makeModule("feedbacks"),
    ];
    const result = filterRouteModules(
      modules,
      new Set<RouteModuleId>(["feedbacks"]),
    );
    expect(result.map((m) => m.id)).toEqual(["blob", "profiles"]);
  });
});
