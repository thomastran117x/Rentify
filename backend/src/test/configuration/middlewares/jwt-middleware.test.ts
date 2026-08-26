import type { ClientRequestContext } from "@/configuration/http/bindings";
import { containerTokens } from "@/configuration/container/tokens";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import { ProfileController } from "@/features/profile/profile.controller";
import { PostingsController } from "@/features/postings/postings.controller";
import type { JwtClaims } from "@/features/auth/token/token.service";
import {
  getOptionalJwtAuth,
  requireJwtAuth,
  requireSessionAuth,
} from "@/configuration/middlewares/jwt-middleware";
import type { PersonalAccessTokenPrincipal } from "@/features/auth/auth.principal";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import {
  createMockRequest,
  invoke,
  toTestContext,
  type TestContext,
} from "../../support/mock-http";

class FakeTokenService {
  constructor(
    private readonly verify: (token: string) => Promise<JwtClaims> | JwtClaims,
  ) {}

  verifyAccessToken(token: string): Promise<JwtClaims> {
    return Promise.resolve(this.verify(token));
  }
}

class FakePersonalAccessTokenService {
  constructor(
    private readonly authenticate: (
      token: string,
    ) => Promise<PersonalAccessTokenPrincipal> | PersonalAccessTokenPrincipal,
  ) {}

  authenticateToken(token: string): Promise<PersonalAccessTokenPrincipal> {
    return Promise.resolve(this.authenticate(token));
  }
}

class FakeContainer implements ServiceContainer {
  private readonly contentSanitizationService =
    new ContentSanitizationService();

  constructor(
    private readonly tokenService: FakeTokenService,
    private readonly personalAccessTokenService: FakePersonalAccessTokenService,
  ) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.contentSanitizationService) {
      return this.contentSanitizationService as TValue;
    }

    if (token === containerTokens.personalAccessTokenService) {
      return this.personalAccessTokenService as TValue;
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
    deviceId: "device-1",
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

function createPatPrincipal(
  overrides: Partial<PersonalAccessTokenPrincipal> = {},
): PersonalAccessTokenPrincipal {
  return {
    sub: "user-1",
    email: "user@example.com",
    role: "owner",
    authMethod: "pat",
    scopes: ["mcp:read"],
    personalAccessTokenId: "pat-1",
    personalAccessTokenName: "Rentify MCP",
    ...overrides,
  };
}

function createContext(options?: {
  authorization?: string;
  url?: string;
  params?: Record<string, string>;
  tokenService?: FakeTokenService;
  personalAccessTokenService?: FakePersonalAccessTokenService;
  client?: ClientRequestContext;
  method?: string;
}): TestContext {
  // Built on the real legacy-context bridge over a mock Express request, so the
  // auth helpers (which now take a request) and the controllers (which still
  // take a context) both see what they expect.
  const request = createMockRequest({
    method: options?.method ?? "GET",
    url: options?.url ?? "https://example.test/resource",
    headers: {
      authorization: options?.authorization,
    },
    params: options?.params,
    body: {},
    state: {
      container: new FakeContainer(
        options?.tokenService ?? new FakeTokenService(() => createClaims()),
        options?.personalAccessTokenService ??
          new FakePersonalAccessTokenService(() => createPatPrincipal()),
      ),
      client: options?.client ?? createClientContext(),
    },
  });

  return toTestContext(request);
}

describe("jwt middleware helpers", () => {
  it("requireJwtAuth returns claims and stores auth on the context", async () => {
    const claims = createClaims({ sub: "verified-user" });
    const context = createContext({
      authorization: "Bearer good-token",
      tokenService: new FakeTokenService((token) => {
        expect(token).toBe("good-token");
        return claims;
      }),
    });

    const result = await requireJwtAuth(context.request);

    expect(result).toMatchObject({
      ...claims,
      authMethod: "jwt",
    });
    expect(context.get("auth")).toMatchObject({
      ...claims,
      authMethod: "jwt",
    });
  });

  it("requireJwtAuth rejects when the authorization header is missing", async () => {
    const context = createContext();

    await expect(requireJwtAuth(context.request)).rejects.toMatchObject<
      Partial<UnauthorizedError>
    >({
      message: "Authorization header is required.",
    });
  });

  it("requireJwtAuth rejects malformed non-bearer authorization headers", async () => {
    const context = createContext({
      authorization: "Basic abc123",
    });

    await expect(requireJwtAuth(context.request)).rejects.toMatchObject<
      Partial<UnauthorizedError>
    >({
      message: "Authorization header must use the Bearer scheme.",
    });
  });

  it("getOptionalJwtAuth returns null when no authorization header is supplied", async () => {
    const context = createContext();

    const result = await getOptionalJwtAuth(context.request);

    expect(result).toBeNull();
    expect(context.get("auth")).toBeUndefined();
  });

  it("getOptionalJwtAuth rejects malformed authorization headers instead of ignoring them", async () => {
    const context = createContext({
      authorization: "Token nope",
    });

    await expect(getOptionalJwtAuth(context.request)).rejects.toMatchObject<
      Partial<UnauthorizedError>
    >({
      message: "Authorization header must use the Bearer scheme.",
    });
  });

  it("profile controller getMe authenticates through the shared helper before reading auth", async () => {
    const claims = createClaims({ sub: "profile-user" });
    let receivedUserId: string | null = null;
    const controller = new ProfileController({
      getByUserId: async (userId: string) => {
        receivedUserId = userId;
        return { id: "profile-1", userId };
      },
    } as any);
    const context = createContext({
      authorization: "Bearer profile-token",
      tokenService: new FakeTokenService(() => claims),
    });

    const response = await invoke(controller.getMe, context);

    expect(receivedUserId).toBe("profile-user");
    expect(context.get("auth")).toMatchObject({
      ...claims,
      authMethod: "jwt",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { id: "profile-1", userId: "profile-user" },
      error: null,
      message: "Request completed successfully.",
      meta: { requestId: "unknown" },
    });
  });

  it("accepts PAT bearer auth on allowlisted MCP-safe routes", async () => {
    const principal = createPatPrincipal({
      sub: "owner-123",
    });
    const context = createContext({
      url: "https://example.test/profile/me",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(
        (token) => {
          expect(token).toContain("rpat_");
          return principal;
        },
      ),
    });

    const result = await requireJwtAuth(context.request);

    expect(result).toEqual(principal);
    expect(context.get("auth")).toEqual(principal);
  });

  it("accepts PAT bearer auth on versioned allowlisted MCP-safe routes", async () => {
    const principal = createPatPrincipal({
      sub: "owner-123",
    });
    const context = createContext({
      url: "https://example.test/api/v1/profile/me",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(
        () => principal,
      ),
    });

    const result = await requireJwtAuth(context.request);

    expect(result).toEqual(principal);
  });

  it("accepts PAT bearer auth on the saved searches list route", async () => {
    // Two segments deep, so the /postings/:id catch-all does not reach it. The
    // OpenAPI contract advertises this operation as jwt-or-pat with mcp:read,
    // and without an explicit policy a valid PAT is rejected with 403.
    const principal = createPatPrincipal({ scopes: ["mcp:read"] });
    const context = createContext({
      url: "https://example.test/api/v1/postings/saved/searches",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(
        () => principal,
      ),
    });

    await expect(requireJwtAuth(context.request)).resolves.toEqual(principal);
  });

  it("rejects PAT bearer auth on saved search writes", async () => {
    // Only the read is documented as PAT-accessible; the writes are not.
    const context = createContext({
      method: "POST",
      url: "https://example.test/api/v1/postings/saved/searches",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
    });

    await expect(requireJwtAuth(context.request)).rejects.toMatchObject<
      Partial<ForbiddenError>
    >({
      message: "Personal access tokens cannot access this endpoint.",
    });
  });

  it("rejects PAT bearer auth on non-allowlisted routes", async () => {
    const context = createContext({
      url: "https://example.test/postings/post_1/booking-quote",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
    });

    await expect(requireJwtAuth(context.request)).rejects.toMatchObject<
      Partial<ForbiddenError>
    >({
      message: "Personal access tokens cannot access this endpoint.",
    });
  });

  it("accepts PAT bearer auth on write-allowlisted posting routes with mcp:write scope", async () => {
    const principal = createPatPrincipal({
      scopes: ["mcp:read", "mcp:write"],
    });
    const context = createContext({
      method: "POST",
      url: "https://example.test/postings/post_1/publish",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(
        () => principal,
      ),
    });

    const result = await requireJwtAuth(context.request);

    expect(result).toEqual(principal);
  });

  it("accepts PAT bearer auth on booking quote routes with mcp:read scope", async () => {
    const principal = createPatPrincipal({
      scopes: ["mcp:read"],
    });
    const context = createContext({
      method: "POST",
      url: "https://example.test/postings/post_1/booking-quote",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(
        () => principal,
      ),
    });

    const result = await requireJwtAuth(context.request);

    expect(result).toEqual(principal);
  });

  it("accepts PAT bearer auth on posting search-click tracking routes with mcp:read scope", async () => {
    const principal = createPatPrincipal({
      scopes: ["mcp:read"],
    });
    const context = createContext({
      method: "POST",
      url: "https://example.test/postings/post_1/activity/search-click",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(
        () => principal,
      ),
    });

    const result = await requireJwtAuth(context.request);

    expect(result).toEqual(principal);
  });

  it("accepts PAT bearer auth on booking and renting read routes", async () => {
    const principal = createPatPrincipal({
      scopes: ["mcp:read"],
    });
    const bookingContext = createContext({
      method: "GET",
      url: "https://example.test/booking-requests/booking_1",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(
        () => principal,
      ),
    });
    const rentingContext = createContext({
      method: "GET",
      url: "https://example.test/rentings/renting_1",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(
        () => principal,
      ),
    });

    await expect(requireJwtAuth(bookingContext.request)).resolves.toEqual(
      principal,
    );
    await expect(requireJwtAuth(rentingContext.request)).resolves.toEqual(
      principal,
    );
  });

  it("accepts PAT bearer auth on booking dashboard read routes", async () => {
    const principal = createPatPrincipal({
      scopes: ["mcp:read"],
    });
    const renterDashboardContext = createContext({
      method: "GET",
      url: "https://example.test/booking-requests/me/dashboard",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(
        () => principal,
      ),
    });
    const ownerDashboardContext = createContext({
      method: "GET",
      url: "https://example.test/booking-requests/owner/dashboard",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(
        () => principal,
      ),
    });

    await expect(
      requireJwtAuth(renterDashboardContext.request),
    ).resolves.toEqual(principal);
    await expect(
      requireJwtAuth(ownerDashboardContext.request),
    ).resolves.toEqual(principal);
  });

  it("accepts PAT bearer auth on booking write routes with mcp:write scope", async () => {
    const principal = createPatPrincipal({
      scopes: ["mcp:read", "mcp:write"],
    });
    const context = createContext({
      method: "POST",
      url: "https://example.test/booking-requests/booking_1/approve",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(
        () => principal,
      ),
    });

    const result = await requireJwtAuth(context.request);

    expect(result).toEqual(principal);
  });

  it("rejects PAT bearer auth when the token lacks the required scope", async () => {
    const context = createContext({
      url: "https://example.test/profile/me",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(() =>
        createPatPrincipal({
          scopes: [],
        }),
      ),
    });

    await expect(requireJwtAuth(context.request)).rejects.toMatchObject<
      Partial<ForbiddenError>
    >({
      message: "Personal access token does not include the required scope.",
    });
  });

  it("rejects PAT bearer auth on write-allowlisted posting routes when the token lacks mcp:write", async () => {
    const context = createContext({
      method: "POST",
      url: "https://example.test/postings/post_1/publish",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(() =>
        createPatPrincipal({
          scopes: ["mcp:read"],
        }),
      ),
    });

    await expect(requireJwtAuth(context.request)).rejects.toMatchObject<
      Partial<ForbiddenError>
    >({
      message: "Personal access token does not include the required scope.",
    });
  });

  it("rejects PAT bearer auth on booking write routes when the token lacks mcp:write", async () => {
    const context = createContext({
      method: "POST",
      url: "https://example.test/booking-requests/booking_1/approve",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(() =>
        createPatPrincipal({
          scopes: ["mcp:read"],
        }),
      ),
    });

    await expect(requireJwtAuth(context.request)).rejects.toMatchObject<
      Partial<ForbiddenError>
    >({
      message: "Personal access token does not include the required scope.",
    });
  });

  it("rejects PAT bearer auth on payment session routes even with mcp:write", async () => {
    const context = createContext({
      method: "POST",
      url: "https://example.test/booking-requests/booking_1/payment-session",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(() =>
        createPatPrincipal({
          scopes: ["mcp:read", "mcp:write"],
        }),
      ),
    });

    await expect(requireJwtAuth(context.request)).rejects.toMatchObject<
      Partial<ForbiddenError>
    >({
      message: "Personal access tokens cannot access this endpoint.",
    });
  });

  it("requireSessionAuth rejects PAT principals even on allowlisted routes", async () => {
    const context = createContext({
      url: "https://example.test/profile/me",
      authorization:
        "Bearer rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      personalAccessTokenService: new FakePersonalAccessTokenService(() =>
        createPatPrincipal(),
      ),
    });

    await expect(requireSessionAuth(context.request)).rejects.toMatchObject<
      Partial<ForbiddenError>
    >({
      message: "This endpoint requires a signed-in user session.",
    });
  });

  it("postings controller getById preserves optional auth and tracks public views anonymously", async () => {
    let receivedViewerId: string | undefined;
    const trackPublicView = jest.fn(
      async (
        posting: { id: string; organizationId: string },
        client: ClientRequestContext,
        viewerId?: string,
      ) => {
        expect(posting.id).toBe("posting-123");
        expect(client.device.id).toBe("device-1");
        expect(viewerId).toBeUndefined();
      },
    );
    const controller = new PostingsController(
      {
        getById: async (postingId: string, viewerId?: string) => {
          receivedViewerId = viewerId;
          return {
            id: postingId,
            organizationId: "org-1",
          };
        },
      } as any,
      {} as any,
      {
        trackPublicView,
      } as any,
      {} as any,
      {} as any,
      {
        publishPostingView: async () => undefined,
      } as any,
      {} as any,
    );
    const context = createContext({
      url: "https://example.test/postings/posting-123",
      params: {
        id: "posting-123",
      },
    });

    const response = await invoke(controller.getById, context);

    expect(receivedViewerId).toBeUndefined();
    expect(context.get("auth")).toBeUndefined();
    expect(trackPublicView).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { id: "posting-123", organizationId: "org-1" },
      error: null,
      message: "Request completed successfully.",
      meta: { requestId: "unknown" },
    });
  });
});
