import { Hono } from "hono";
import { mountRoutes } from "@/configuration/bootstrap/routes";
import {
  containerTokens,
  type ServiceContainer,
} from "@/configuration/bootstrap/container";
import { buildApiPath, getApiRoutePrefix } from "@/configuration/http/api-path";
import type { AppBindings } from "@/configuration/http/bindings";
import type { Logger, LoggerFactory } from "@/configuration/logging";
import { clientContextMiddleware } from "@/configuration/middlewares/client-context.middleware";
import { csrfMiddleware } from "@/configuration/middlewares/csrf.middleware";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { httpLoggingMiddleware } from "@/configuration/middlewares/http-logging.middleware";
import { idempotencyMiddleware } from "@/configuration/middlewares/idempotency.middleware";
import { outputFormatMiddleware } from "@/configuration/middlewares/output-format.middleware";
import {
  rateLimiterMiddleware,
  resetRateLimiterMemoryFallbackForTests,
} from "@/configuration/middlewares/rate-limiter.middleware";
import { requestBodyPolicyMiddleware } from "@/configuration/middlewares/request-body-policy.middleware";
import { requestIdMiddleware } from "@/configuration/middlewares/request-id.middleware";
import { requestLoggerMiddleware } from "@/configuration/middlewares/request-logger.middleware";
import { requestSanitizationMiddleware } from "@/configuration/middlewares/request-sanitization.middleware";
import { requestTimeoutMiddleware } from "@/configuration/middlewares/request-timeout.middleware";
import { securityHeadersMiddleware } from "@/configuration/middlewares/security-headers.middleware";
import { corsMiddleware } from "@/configuration/middlewares/cors.middleware";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { AuthController } from "@/features/auth/auth.controller";
import type {
  AuthSessionResult,
  AuthUserProfile,
} from "@/features/auth/auth.model";
import type { PersonalAccessTokenPrincipal } from "@/features/auth/auth.principal";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { PersonalAccessTokenController } from "@/features/auth/personal-access-token/personal-access-token.controller";
import { ProfileController } from "@/features/profile/profile.controller";
import { SearchController } from "@/features/search/search.controller";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";

function createAuthUser(
  overrides: Partial<AuthUserProfile> = {},
): AuthUserProfile {
  return {
    id: "user-1",
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    username: "test-user",
    phoneNumber: undefined,
    avatarUrl: undefined,
    isPrivate: false,
    recommendationPersonalizationEnabled: true,
    trustworthinessScore: 80,
    rentPostingsCount: 0,
    availableRentPostingsCount: 0,
    role: "user",
    emailVerified: true,
    organizationMembershipCount: 0,
    ...overrides,
  };
}

function createSessionResult(
  overrides: Partial<AuthSessionResult> = {},
): AuthSessionResult {
  return {
    accessToken: "access-token-1",
    refreshToken: "refresh-token-1",
    refreshTokenExpiresInSeconds: 86_400,
    device: {
      deviceId: "device-1",
      known: true,
      knownByIp: true,
    },
    user: createAuthUser(),
    ...overrides,
  };
}

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    email: "user@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 2,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createPatPrincipal(
  overrides: Partial<PersonalAccessTokenPrincipal> = {},
): PersonalAccessTokenPrincipal {
  return {
    sub: "owner-7",
    email: "owner@example.com",
    role: "owner",
    authMethod: "pat",
    scopes: ["mcp:read"],
    personalAccessTokenId: "pat-1",
    personalAccessTokenName: "Rentify MCP",
    ...overrides,
  };
}

class FakeRequestContainer implements ServiceContainer {
  private readonly contentSanitizationService =
    new ContentSanitizationService();

  constructor(private readonly registry: Map<unknown, unknown>) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.contentSanitizationService) {
      return this.contentSanitizationService as TValue;
    }

    if (!this.registry.has(token)) {
      throw new Error(`Unsupported test container token: ${String(token)}`);
    }

    return this.registry.get(token) as TValue;
  }

  createScope(): ServiceContainer {
    return this;
  }

  async dispose(): Promise<void> {}
}

function createNoopLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
    child: jest.fn(() => createNoopLogger()),
  };
}

function createSecurityApp(options?: {
  cacheEval?: jest.Mock;
  verifyAccessToken?: jest.Mock;
  authenticatePat?: jest.Mock;
  refresh?: jest.Mock;
}) {
  const loggerFactory: LoggerFactory = {
    forClass: jest.fn(() => createNoopLogger()),
    forComponent: jest.fn(() => createNoopLogger()),
    fromContext: jest.fn((base: Logger) => base),
  };

  const authService = {
    localAuthenticate: jest.fn(async () => createSessionResult()),
    localSignup: jest.fn(async () => ({
      verificationRequired: true,
    })),
    forgotPassword: jest.fn(async () => ({ accepted: true })),
    resendForgotPassword: jest.fn(async () => ({ accepted: true })),
    resetPassword: jest.fn(async () => ({ reset: true })),
    verifyEmail: jest.fn(async () => ({ verified: true })),
    resendVerificationEmail: jest.fn(async () => ({ accepted: true })),
    changePassword: jest.fn(async () => createSessionResult()),
    unlockLocalLogin: jest.fn(async () => ({ unlocked: true })),
    resendUnlockLocalLogin: jest.fn(async () => ({ accepted: true })),
    localVerify: jest.fn(async () => ({ verified: true })),
    googleAuthenticate: jest.fn(async () => createSessionResult()),
    microsoftAuthenticate: jest.fn(async () => createSessionResult()),
    appleAuthenticate: jest.fn(async () => createSessionResult()),
    linkOAuthProvider: jest.fn(async () => ({ linked: true })),
    linkedOAuthProviders: jest.fn(async () => ({ providers: [] })),
    unlinkOAuthProvider: jest.fn(async () => ({ unlinked: true })),
    refresh:
      options?.refresh ??
      jest.fn(async () =>
        createSessionResult({
          accessToken: "refreshed-access-token",
          refreshToken: "refreshed-refresh-token",
        }),
      ),
    logout: jest.fn(async () => ({ loggedOut: true })),
    deviceVerify: jest.fn(async () => ({ verified: true })),
    devices: jest.fn(async () => ({ devices: [] })),
    removeKnownDevice: jest.fn(async () => ({ removed: true })),
  };

  const captchaService = {
    verify: jest.fn(async () => ({
      success: true,
      failOpen: false,
      errors: [],
    })),
  };

  const tokenService = {
    verifyAccessToken:
      options?.verifyAccessToken ??
      jest.fn(async (token: string) => {
        if (token === "user-token") {
          return createClaims();
        }

        if (token === "owner-token") {
          return createClaims({
            sub: "owner-1",
            email: "owner@example.com",
            role: "owner",
          });
        }

        if (token === "admin-token") {
          return createClaims({
            sub: "admin-1",
            email: "admin@example.com",
            role: "admin",
          });
        }

        throw new UnauthorizedError("Invalid access token signature.");
      }),
  };

  const personalAccessTokenService = {
    authenticateToken:
      options?.authenticatePat ??
      jest.fn(async () =>
        createPatPrincipal({
          sub: "pat-owner-1",
        }),
      ),
    listForUser: jest.fn(async () => ({
      tokens: [],
    })),
    create: jest.fn(async () => ({
      id: "pat-1",
      name: "Rentify MCP",
      tokenPrefix: "rpat_1234567890abcdef123456_abcdef",
      scopes: ["mcp:read"],
      token:
        "rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      lastUsedAt: undefined,
      expiresAt: undefined,
      revokedAt: undefined,
    })),
    revoke: jest.fn(async () => ({
      revoked: true,
      tokenId: "pat-1",
    })),
  };

  const profileService = {
    list: jest.fn(async () => ({
      profiles: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    getByUserId: jest.fn(async (userId: string) => ({
      id: "profile-1",
      userId,
    })),
    update: jest.fn(async (input: { userId: string }) => ({
      id: "profile-1",
      userId: input.userId,
      updated: true,
    })),
  };

  const searchService = {
    startReindex: jest.fn(async () => ({
      id: "run-1",
      status: "pending",
    })),
    getReindexRun: jest.fn(async () => ({
      id: "run-1",
      status: "running",
    })),
    getStatus: jest.fn(async () => ({
      ok: true,
    })),
    replayDeadLetteredOutbox: jest.fn(async () => ({
      accepted: true,
    })),
    cleanupRetainedIndices: jest.fn(async () => ({
      accepted: true,
    })),
  };

  const cacheService = {
    eval: options?.cacheEval ?? jest.fn().mockResolvedValue([1, 9, 0]),
  };

  const registry = new Map<unknown, unknown>([
    [
      containerTokens.authController,
      new AuthController(
        authService as any,
        captchaService as any,
        {} as any,
        {} as any,
      ),
    ],
    [
      containerTokens.profileController,
      new ProfileController(profileService as any),
    ],
    [
      containerTokens.personalAccessTokenController,
      new PersonalAccessTokenController(personalAccessTokenService as any),
    ],
    [
      containerTokens.searchController,
      new SearchController(searchService as any),
    ],
    [containerTokens.loggerFactory, loggerFactory],
    [containerTokens.tokenService, tokenService],
    [containerTokens.personalAccessTokenService, personalAccessTokenService],
    [containerTokens.cacheService, cacheService],
  ]);

  const app = new Hono<AppBindings>();
  const api = app.basePath(getApiRoutePrefix());

  api.use("*", corsMiddleware);
  api.use("*", requestIdMiddleware);
  api.use("*", clientContextMiddleware);
  api.use("*", async (context, next) => {
    context.set("container", new FakeRequestContainer(registry));
    await next();
  });
  api.use("*", requestLoggerMiddleware);
  api.use("*", requestTimeoutMiddleware);
  api.use("*", requestBodyPolicyMiddleware);
  api.use("*", requestSanitizationMiddleware);
  api.use("/auth/*", csrfMiddleware);
  api.use("/auth/*", idempotencyMiddleware);
  api.use("/payments/*", idempotencyMiddleware);
  api.use("/booking-requests/:id/payment-session", idempotencyMiddleware);
  api.use("*", rateLimiterMiddleware);
  api.use("*", outputFormatMiddleware);
  api.use("*", securityHeadersMiddleware);
  api.use("*", httpLoggingMiddleware);
  app.onError(handleApplicationError);
  mountRoutes(app);

  return {
    app,
    authService,
    captchaService,
    tokenService,
    personalAccessTokenService,
    profileService,
    searchService,
    cacheService,
  };
}

function browserAuthHeaders(overrides: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    origin: "http://localhost:3040",
    "x-request-id": "req-security-1",
    ...overrides,
  };
}

describe("Security integration", () => {
  const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalCorsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS;
  const originalCsrfAllowedOrigins = process.env.CSRF_ALLOWED_ORIGINS;

  beforeEach(() => {
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.FRONTEND_URL = "http://localhost:3040";
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.CSRF_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetRateLimiterMemoryFallbackForTests();
  });

  afterAll(() => {
    if (originalTrustProxyHeaders === undefined) {
      delete process.env.TRUST_PROXY_HEADERS;
    } else {
      process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
    }

    if (originalFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = originalFrontendUrl;
    }

    if (originalCorsAllowedOrigins === undefined) {
      delete process.env.CORS_ALLOWED_ORIGINS;
    } else {
      process.env.CORS_ALLOWED_ORIGINS = originalCorsAllowedOrigins;
    }

    if (originalCsrfAllowedOrigins === undefined) {
      delete process.env.CSRF_ALLOWED_ORIGINS;
    } else {
      process.env.CSRF_ALLOWED_ORIGINS = originalCsrfAllowedOrigins;
    }
  });

  it("blocks cookie-backed refresh requests from untrusted browser origins before reaching the auth service", async () => {
    const { app, authService } = createSecurityApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/refresh")}`,
      {
        method: "POST",
        headers: {
          ...browserAuthHeaders({
            origin: "https://evil.example",
            cookie: "refresh_token=refresh-cookie; csrf_token=csrf-cookie",
            "x-csrf-token": "csrf-cookie",
          }),
        },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "CSRF validation failed.",
      data: null,
      error: {
        code: "FORBIDDEN",
      },
      meta: {
        requestId: "req-security-1",
      },
    });
    expect(authService.refresh).not.toHaveBeenCalled();
  });

  it("accepts trusted cookie-backed refresh requests and refreshes the browser session", async () => {
    const { app, authService } = createSecurityApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/refresh")}`,
      {
        method: "POST",
        headers: {
          ...browserAuthHeaders({
            cookie: "refresh_token=refresh-cookie; csrf_token=csrf-cookie",
            "x-csrf-token": "csrf-cookie",
            "x-forwarded-for": "198.51.100.77",
            "x-device-id": "browser-device-1",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            "sec-ch-ua-platform": '"macOS"',
          }),
        },
        body: JSON.stringify({}),
      },
    );

    expect(authService.refresh).toHaveBeenCalledWith({
      client: {
        ip: "198.51.100.77",
        device: {
          id: "browser-device-1",
          type: "desktop",
          isMobile: false,
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          platform: "macOS",
        },
      },
      refreshToken: "refresh-cookie",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "refresh_token=refreshed-refresh-token",
    );
    expect(response.headers.get("set-cookie")).toContain("csrf_token=");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        accessToken: "refreshed-access-token",
        device: {
          deviceId: "device-1",
          known: true,
          knownByIp: true,
        },
        user: {
          id: "user-1",
          email: "user@example.com",
          username: "test-user",
          role: "user",
          organizationMembershipCount: 0,
        },
      },
      error: null,
      message: "Session refreshed successfully.",
      meta: {
        requestId: "req-security-1",
      },
    });
  });

  it("rejects conflicting idempotency headers on auth routes before captcha or authentication runs", async () => {
    const { app, authService, captchaService } = createSecurityApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: {
          ...browserAuthHeaders({
            "idempotency-key": "login-req-1",
            "x-idempotency-key": "login-req-2",
          }),
        },
        body: JSON.stringify({
          email: "user@example.com",
          password: "Password1!",
          captchaToken: "captcha-token",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Conflicting idempotency key headers were provided.",
      data: null,
      error: {
        code: "BAD_REQUEST",
        details: {
          headers: ["idempotency-key", "x-idempotency-key"],
        },
      },
      meta: {
        requestId: "req-security-1",
      },
    });
    expect(captchaService.verify).not.toHaveBeenCalled();
    expect(authService.localAuthenticate).not.toHaveBeenCalled();
  });

  it("rate limits login requests before the auth service executes", async () => {
    const { app, authService, captchaService } = createSecurityApp({
      cacheEval: jest.fn().mockResolvedValue([0, 0, 9]),
    });

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: browserAuthHeaders(),
        body: JSON.stringify({
          email: "user@example.com",
          password: "Password1!",
          captchaToken: "captcha-token",
        }),
      },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("9");
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Too many requests. Please try again later.",
      data: null,
      error: {
        code: "TOO_MANY_REQUESTS",
        details: {
          backend: "redis",
          identityType: "ip",
          policy: "auth-sensitive",
          strategy: "sliding-window",
          retryAfterSeconds: 9,
        },
      },
      meta: {
        requestId: "req-security-1",
      },
    });
    expect(captchaService.verify).not.toHaveBeenCalled();
    expect(authService.localAuthenticate).not.toHaveBeenCalled();
  });

  it("rejects invalid bearer tokens on protected profile routes without calling the profile service", async () => {
    const { app, profileService, tokenService } = createSecurityApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/profile/me")}`,
      {
        headers: {
          authorization: "Bearer invalid-token",
          "x-request-id": "req-security-2",
        },
      },
    );

    expect(tokenService.verifyAccessToken).toHaveBeenCalledWith(
      "invalid-token",
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Invalid access token signature.",
      data: null,
      error: {
        code: "UNAUTHORIZED",
      },
      meta: {
        requestId: "req-security-2",
      },
    });
    expect(profileService.getByUserId).not.toHaveBeenCalled();
  });

  it("allows PAT access on explicitly allowlisted read routes", async () => {
    const { app, profileService, personalAccessTokenService } =
      createSecurityApp();
    const token =
      "rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456";

    const response = await app.request(
      `http://rent.test${buildApiPath("/profile/me")}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          "x-request-id": "req-security-3",
        },
      },
    );

    expect(personalAccessTokenService.authenticateToken).toHaveBeenCalledWith(
      token,
    );
    expect(profileService.getByUserId).toHaveBeenCalledWith("pat-owner-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        id: "profile-1",
        userId: "pat-owner-1",
      },
      error: null,
      message: "Request completed successfully.",
      meta: {
        requestId: "req-security-3",
      },
    });
  });

  it("rejects PAT access on non-allowlisted write routes before profile updates run", async () => {
    const { app, profileService } = createSecurityApp();
    const token =
      "rpat_1234567890abcdef123456_abcdef123456abcdef123456abcdef123456abcdef123456";

    const response = await app.request(
      `http://rent.test${buildApiPath("/profile/me")}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-request-id": "req-security-4",
        },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Personal access tokens cannot access this endpoint.",
      data: null,
      error: {
        code: "FORBIDDEN",
        details: {
          method: "PUT",
          pathname: "/profile/me",
          authMethod: "pat",
        },
      },
      meta: {
        requestId: "req-security-4",
      },
    });
    expect(profileService.update).not.toHaveBeenCalled();
  });

  it("rejects owner tokens on admin-only search operations before the search service runs", async () => {
    const { app, searchService } = createSecurityApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/admin/search/reindex")}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer owner-token",
          "x-request-id": "req-security-5",
        },
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "You do not have permission to perform this action.",
      data: null,
      error: {
        code: "FORBIDDEN",
        details: {
          requiredRole: "admin",
          role: "owner",
        },
      },
      meta: {
        requestId: "req-security-5",
      },
    });
    expect(searchService.startReindex).not.toHaveBeenCalled();
  });
});
