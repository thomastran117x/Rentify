import express from "express";
import { mountRoutes } from "@/configuration/bootstrap/routes";
import { filterRouteModules } from "@/configuration/bootstrap/routes/registry";
import {
  containerTokens,
  type ServiceContainer,
} from "@/configuration/bootstrap/container";
import { buildApiPath, getApiRoutePrefix } from "@/configuration/http/api-path";
import type {
  RouteModule,
  RouteModuleId,
} from "@/configuration/bootstrap/routes/types";
import { createTestApp } from "../../support/fetch-app";

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

  return createTestApp((app) => {
    const api = express.Router();
    app.use(getApiRoutePrefix(), api);

    api.use((request, _response, next) => {
      request.container = container;
      next();
    });

    mountRoutes(api);
  });
}

/** A fake controller handler that writes a fixed JSON payload. */
function respond(payload: unknown) {
  return async (_request: any, response: any) => {
    response.status(200).json(payload);
  };
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
      createUploadUrl: respond({ ok: true }),
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
            createUploadUrl: respond({ ok: true }),
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
    // The two handlers live on different controllers now, which is what makes
    // this a real test of one module being disabled without its neighbour.
    const app = createApp(
      new Map<unknown, unknown>([
        [
          containerTokens.localAuthController,
          { localAuthenticate: respond({ ok: true }) },
        ],
        [
          containerTokens.oauthController,
          { linkedOAuthProviders: respond({ providers: ["google"] }) },
        ],
      ]),
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
      analyticsSummary: respond({ route: "analyticsSummary" }),
      batchPublic: respond({ route: "batchPublic" }),
      getById: async (request: any, response: any) => {
        response.status(200).json({ id: request.params.id, route: "getById" });
      },
      listMine: respond({ route: "listMine" }),
      search: respond({ route: "search" }),
      listSaved: respond({ route: "listSaved" }),
      listSavedIds: respond({ route: "listSavedIds" }),
    };
    const app = createApp(
      new Map([[containerTokens.postingsController, postingsController]]),
    );

    const [
      batchResponse,
      mineResponse,
      analyticsResponse,
      savedResponse,
      savedIdsResponse,
      itemResponse,
    ] = await Promise.all([
      app.request(`http://rent.test${buildApiPath("/postings/batch")}`),
      app.request(`http://rent.test${buildApiPath("/postings/me")}`),
      app.request(
        `http://rent.test${buildApiPath("/postings/analytics/summary")}`,
      ),
      app.request(`http://rent.test${buildApiPath("/postings/saved")}`),
      app.request(`http://rent.test${buildApiPath("/postings/saved/ids")}`),
      app.request(`http://rent.test${buildApiPath("/postings/posting-123")}`),
    ]);

    await expect(batchResponse.json()).resolves.toEqual({
      route: "batchPublic",
    });
    await expect(mineResponse.json()).resolves.toEqual({ route: "listMine" });
    await expect(analyticsResponse.json()).resolves.toEqual({
      route: "analyticsSummary",
    });
    // `saved` would satisfy the posting-id pattern, so these two assertions are
    // what catch a registry reordering that lets /postings/:id bind first.
    await expect(savedResponse.json()).resolves.toEqual({ route: "listSaved" });
    await expect(savedIdsResponse.json()).resolves.toEqual({
      route: "listSavedIds",
    });
    await expect(itemResponse.json()).resolves.toEqual({
      id: "posting-123",
      route: "getById",
    });
  });

  it("preserves static-before-dynamic organization route behavior", async () => {
    delete process.env.DISABLED_ROUTE_MODULES;
    const organizationMembersController = {
      listMine: respond({ route: "listMine" }),
    };
    const organizationInvitationsController = {
      preview: async (request: any, response: any) => {
        response.status(200).json({
          route: "previewInvitation",
          token: request.params.token,
        });
      },
    };
    const organizationProfileController = {
      getWorkspaceById: async (request: any, response: any) => {
        response.status(200).json({
          route: "getWorkspaceById",
          id: request.params.id,
        });
      },
      getById: async (request: any, response: any) => {
        response.status(200).json({ route: "getById", id: request.params.id });
      },
    };
    const app = createApp(
      new Map<unknown, unknown>([
        [
          containerTokens.organizationMembersController,
          organizationMembersController,
        ],
        [
          containerTokens.organizationInvitationsController,
          organizationInvitationsController,
        ],
        [
          containerTokens.organizationProfileController,
          organizationProfileController,
        ],
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
        app.request(
          `http://rent.test${buildApiPath("/organizations/org-123")}`,
        ),
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
