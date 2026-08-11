import type { Context } from "hono";
import { createLegacyTestContext } from "../../support/mock-http";
import ForbiddenError from "@/errors/http/forbidden.error";
import {
  getAuthRole,
  hasAnyRole,
  hasMinimumRole,
  requireAnyRole,
  requireMinimumRole,
} from "@/features/auth/authorization";
import { normalizeAppRole } from "@/features/auth/auth.model";
import { containerTokens } from "@/configuration/container/tokens";
import { PaymentsController } from "@/features/payments/payments.controller";
import { PostingsController } from "@/features/postings/postings.controller";
import { SearchController } from "@/features/search/search.controller";
import type {
  AppBindings,
  ClientRequestContext,
} from "@/configuration/http/bindings";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";

class FakeTokenService {
  constructor(
    private readonly verify: (token: string) => Promise<JwtClaims> | JwtClaims,
  ) {}

  verifyAccessToken(token: string): Promise<JwtClaims> {
    return Promise.resolve(this.verify(token));
  }
}

class FakeContainer implements ServiceContainer {
  private readonly contentSanitizationService =
    new ContentSanitizationService();

  constructor(private readonly tokenService: FakeTokenService) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.contentSanitizationService) {
      return this.contentSanitizationService as TValue;
    }

    return this.tokenService as TValue;
  }

  createScope(): ServiceContainer {
    return this;
  }

  async dispose(): Promise<void> {}
}

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    email: "user@example.com",
    role: "user",
    tokenVersion: 0,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createClientContext(): ClientRequestContext {
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

function createContext(options?: {
  authorization?: string;
  url?: string;
  params?: Record<string, string>;
  body?: unknown;
  tokenService?: FakeTokenService;
}): Context<AppBindings> {
  const variables = new Map<string, unknown>();

  variables.set(
    "container",
    new FakeContainer(
      options?.tokenService ?? new FakeTokenService(() => createClaims()),
    ),
  );
  variables.set("client", createClientContext());

  return createLegacyTestContext({
    body: options?.body,
    params: options?.params,
    url: options?.url ?? "https://example.test/resource",
    headers: {
      authorization: options?.authorization,
    },
    state: Object.fromEntries(variables),
  });
}

describe("authorization", () => {
  it("defaults missing roles to user", () => {
    expect(normalizeAppRole(undefined)).toBe("user");
    expect(getAuthRole(createClaims({ role: undefined }))).toBe("user");
  });

  it("allows owner routes for owner and admin roles only", () => {
    expect(requireMinimumRole(createClaims({ role: "owner" }), "owner")).toBe(
      "owner",
    );
    expect(requireMinimumRole(createClaims({ role: "admin" }), "owner")).toBe(
      "admin",
    );
    expect(hasMinimumRole(createClaims({ role: "admin" }), "owner")).toBe(true);
    expect(hasMinimumRole(createClaims({ role: "moderator" }), "owner")).toBe(
      false,
    );
  });

  it("rejects regular users from owner routes", () => {
    expect(() =>
      requireMinimumRole(createClaims({ role: "user" }), "owner"),
    ).toThrow(ForbiddenError);
  });

  it("allows moderator routes for moderators and admins only", () => {
    expect(
      requireMinimumRole(createClaims({ role: "moderator" }), "moderator"),
    ).toBe("moderator");
    expect(
      requireMinimumRole(createClaims({ role: "admin" }), "moderator"),
    ).toBe("admin");
    expect(hasAnyRole(createClaims({ role: "moderator" }), ["moderator"])).toBe(
      true,
    );
    expect(() =>
      requireAnyRole(createClaims({ role: "owner" }), ["moderator", "admin"]),
    ).toThrow(ForbiddenError);
  });

  it("does not block posting creation at the controller layer for authenticated users", async () => {
    let createDraftCalled = false;
    const controller = new PostingsController(
      {
        createDraft: async () => {
          createDraftCalled = true;
          return { id: "posting-1" };
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const context = createContext({
      authorization: "Bearer user-token",
      tokenService: new FakeTokenService(() => createClaims({ role: "user" })),
      body: {
        variant: {
          family: "place",
          subtype: "entire_place",
        },
        name: "Test posting",
        description: "Nice place",
        pricing: { currency: "cad", daily: { amount: 100 } },
        photos: [
          {
            blobUrl:
              "https://example.blob.core.windows.net/postings/photo-1.jpg",
            blobName: "postings/photo-1.jpg",
            position: 0,
          },
        ],
        tags: [],
        details: {
          guest_capacity: 2,
          property_type: "condo",
          amenities: [],
        },
        availabilityStatus: "available",
        availabilityBlocks: [],
        location: {
          latitude: 43.7,
          longitude: -79.4,
          city: "Toronto",
          region: "Ontario",
          country: "Canada",
        },
      },
    });

    const response = await controller.create(context);

    expect(response.status).toBe(201);
    expect(createDraftCalled).toBe(true);
  });

  it("restricts payment repair to admins", async () => {
    let repairCalled = false;
    const controller = new PaymentsController({
      repairPayment: async () => {
        repairCalled = true;
      },
    } as any);
    const ownerContext = createContext({
      authorization: "Bearer owner-token",
      params: {
        id: "payment-1",
      },
      tokenService: new FakeTokenService(() => createClaims({ role: "owner" })),
    });

    await expect(controller.repair(ownerContext)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(repairCalled).toBe(false);

    const adminContext = createContext({
      authorization: "Bearer admin-token",
      params: {
        id: "payment-2",
      },
      tokenService: new FakeTokenService(() => createClaims({ role: "admin" })),
    });

    const response = await controller.repair(adminContext);

    expect(repairCalled).toBe(true);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { ok: true },
      error: null,
      message: "Payment repair queued successfully.",
      meta: { requestId: "unknown" },
    });
  });

  it("restricts search reindex operations to admins", async () => {
    let reindexCalled = false;
    const controller = new SearchController({
      startReindex: async () => {
        reindexCalled = true;
        return { id: "run-1", status: "pending" };
      },
      getReindexRun: async () => ({ id: "run-1", status: "running" }),
      getStatus: async () => ({ ok: true }),
    } as any);

    const ownerContext = createContext({
      authorization: "Bearer owner-token",
      tokenService: new FakeTokenService(() => createClaims({ role: "owner" })),
    });

    await expect(controller.startReindex(ownerContext)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(reindexCalled).toBe(false);

    const adminContext = createContext({
      authorization: "Bearer admin-token",
      tokenService: new FakeTokenService(() => createClaims({ role: "admin" })),
    });

    const response = await controller.startReindex(adminContext);

    expect(reindexCalled).toBe(true);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { id: "run-1", status: "pending" },
      error: null,
      message: "Search reindex has been started.",
      meta: { requestId: "unknown" },
    });
  });
});
