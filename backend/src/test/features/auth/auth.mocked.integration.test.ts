import { Hono } from "hono";
import { mountRoutes } from "@/configuration/bootstrap/routes";
import {
  containerTokens,
  type ServiceContainer,
} from "@/configuration/bootstrap/container";
import { buildApiPath } from "@/configuration/http/api-path";
import type {
  AppBindings,
  ClientRequestContext,
} from "@/configuration/http/bindings";
import { clientContextMiddleware } from "@/configuration/middlewares/client-context.middleware";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { outputFormatMiddleware } from "@/configuration/middlewares/output-format.middleware";
import { AuthController } from "@/features/auth/auth.controller";
import type {
  AuthSessionResult,
  AuthUserProfile,
} from "@/features/auth/auth.model";
import type { JwtClaims } from "@/features/auth/token/token.service";
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
  overrides?: Partial<AuthSessionResult>,
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

function createJwtAuthPrincipal(overrides: Partial<JwtClaims> = {}) {
  return {
    ...createClaims(overrides),
    authMethod: "jwt" as const,
  };
}

class FakeRequestContainer implements ServiceContainer {
  private readonly contentSanitizationService =
    new ContentSanitizationService();

  constructor(
    private readonly authController: AuthController,
    private readonly tokenService: {
      verifyAccessToken(token: string): Promise<JwtClaims>;
    },
  ) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.authController) {
      return this.authController as TValue;
    }

    if (token === containerTokens.tokenService) {
      return this.tokenService as TValue;
    }

    if (token === containerTokens.contentSanitizationService) {
      return this.contentSanitizationService as TValue;
    }

    throw new Error("Unsupported test container token.");
  }

  createScope(): ServiceContainer {
    return this;
  }

  async dispose(): Promise<void> {}
}

function createApp(overrides?: {
  localAuthenticate?: (input: unknown) => Promise<AuthSessionResult>;
  localSignup?: (input: unknown) => Promise<unknown>;
  googleAuthenticate?: (input: unknown) => Promise<AuthSessionResult>;
  microsoftAuthenticate?: (input: unknown) => Promise<AuthSessionResult>;
  localVerify?: (input: unknown) => Promise<unknown>;
  logout?: (input: unknown) => Promise<unknown>;
  captchaVerify?: (
    input: unknown,
  ) => Promise<{ success: boolean; failOpen: boolean; errors: string[] }>;
  verifyAccessToken?: (token: string) => Promise<JwtClaims>;
}) {
  const authService = {
    localAuthenticate: jest.fn(
      overrides?.localAuthenticate ?? (async () => createSessionResult()),
    ),
    localSignup: jest.fn(
      overrides?.localSignup ??
        (async () => ({
          verificationRequired: true,
          username: "test-user",
          alreadyPending: false,
        })),
    ),
    googleAuthenticate: jest.fn(
      overrides?.googleAuthenticate ??
        (async () =>
          createSessionResult({
            accessToken: "google-access-token",
            refreshToken: "google-refresh-token",
          })),
    ),
    microsoftAuthenticate: jest.fn(
      overrides?.microsoftAuthenticate ??
        (async () =>
          createSessionResult({
            accessToken: "microsoft-access-token",
            refreshToken: "microsoft-refresh-token",
          })),
    ),
    localVerify: jest.fn(
      overrides?.localVerify ??
        (async (input: { auth: JwtClaims; client: ClientRequestContext }) => ({
          verified: true,
          auth: {
            userId: input.auth.sub,
            deviceId: input.auth.deviceId,
            role: input.auth.role,
          },
          client: input.client,
        })),
    ),
    logout: jest.fn(
      overrides?.logout ??
        (async (input: {
          auth: JwtClaims;
          refreshToken?: string;
          client: ClientRequestContext;
        }) => ({
          loggedOut: true,
          auth: {
            userId: input.auth.sub,
            deviceId: input.auth.deviceId,
          },
          refreshToken: input.refreshToken,
          client: input.client,
        })),
    ),
  };
  const captchaService = {
    verify: jest.fn(
      overrides?.captchaVerify ??
        (async () => ({
          success: true,
          failOpen: false,
          errors: [],
        })),
    ),
  };
  const tokenService = {
    verifyAccessToken: jest.fn(
      overrides?.verifyAccessToken ??
        (async (token: string) => {
          if (token === "good-token") {
            return createClaims();
          }

          throw new Error("Invalid access token signature.");
        }),
    ),
  };
  const controller = new AuthController(
    authService as any,
    captchaService as any,
    {} as any,
    {} as any,
  );
  const container = new FakeRequestContainer(controller, tokenService);
  const app = new Hono<AppBindings>();

  app.use("*", clientContextMiddleware);
  app.use("*", async (context, next) => {
    context.set("container", container);
    await next();
  });
  app.use("*", outputFormatMiddleware);
  app.onError(handleApplicationError);
  mountRoutes(app);

  return {
    app,
    authService,
    captchaService,
    tokenService,
  };
}

describe("Auth integration", () => {
  beforeEach(() => {
    process.env.TRUST_PROXY_HEADERS = "true";
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY_HEADERS;
  });

  it("POST /auth/local/login parses client headers, verifies captcha, and returns a desktop auth session with a refresh cookie", async () => {
    const { app, authService, captchaService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.10",
          "x-request-id": "req-123",
          "x-device-id": "header-device-1",
          origin: "http://localhost:3040",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          "sec-ch-ua-platform": '"macOS"',
        },
        body: JSON.stringify({
          username: "TEST-USER",
          password: "Password1!",
          captchaToken: "captcha-token",
          rememberMe: true,
        }),
      },
    );

    expect(captchaService.verify).toHaveBeenCalledWith({
      token: "captcha-token",
      remoteIp: "203.0.113.10",
      idempotencyKey: "req-123",
    });
    expect(authService.localAuthenticate).toHaveBeenCalledWith({
      username: "test-user",
      password: "Password1!",
      rememberMe: true,
      client: {
        ip: "203.0.113.10",
        device: {
          id: "header-device-1",
          type: "desktop",
          isMobile: false,
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          platform: "macOS",
        },
      },
      deviceId: "header-device-1",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "refresh_token=refresh-token-1",
    );
    expect(response.headers.get("set-cookie")).toContain("csrf_token=");
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        accessToken: "access-token-1",
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
        },
      },
      error: null,
      message: "Authenticated successfully.",
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("POST /auth/local/signup returns a structured 400 error when captcha verification fails", async () => {
    const { app } = createApp({
      captchaVerify: async () => ({
        success: false,
        failOpen: false,
        errors: ["invalid-input-response"],
      }),
    });

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/local/signup")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: "test-user",
          email: "user@example.com",
          password: "StrongPassword1!",
          captchaToken: "bad-captcha",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Captcha verification failed.",
      data: null,
      error: {
        code: "BAD_REQUEST",
        details: {
          errors: ["invalid-input-response"],
          failOpen: false,
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("POST /auth/local/verify returns 401 when the authorization header is missing", async () => {
    const { app } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/local/verify")}`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Authorization header is required.",
      data: null,
      error: {
        code: "UNAUTHORIZED",
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("POST /auth/local/verify authenticates through the shared JWT helper and passes auth plus client context to the service", async () => {
    const { app, authService, tokenService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/local/verify")}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer good-token",
          "x-forwarded-for": "198.51.100.5",
          "x-device-id": "header-device-2",
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
          "sec-ch-ua-mobile": "?1",
          "sec-ch-ua-platform": '"iOS"',
        },
      },
    );

    expect(tokenService.verifyAccessToken).toHaveBeenCalledWith("good-token");
    expect(authService.localVerify).toHaveBeenCalledWith({
      auth: createJwtAuthPrincipal(),
      client: {
        ip: "198.51.100.5",
        device: {
          id: "header-device-2",
          type: "mobile",
          isMobile: true,
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
          platform: "iOS",
        },
      },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        verified: true,
        auth: {
          userId: "user-1",
          deviceId: "device-1",
          role: "user",
        },
        client: {
          ip: "198.51.100.5",
          device: {
            id: "header-device-2",
            type: "mobile",
            isMobile: true,
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
            platform: "iOS",
          },
        },
      },
      error: null,
      message: "Request completed successfully.",
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("POST /auth/oauth/google maps the oauth request body and returns a desktop auth session", async () => {
    const { app, authService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/oauth/google")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.88",
          "x-device-id": "oauth-device-1",
          origin: "http://localhost:3040",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          "sec-ch-ua-platform": '"macOS"',
        },
        body: JSON.stringify({
          code: "google-code",
          codeVerifier: "google-verifier",
          nonce: "google-nonce",
          rememberMe: true,
          firstName: "Gina",
          lastName: "Google",
        }),
      },
    );

    expect(authService.googleAuthenticate).toHaveBeenCalledWith({
      code: "google-code",
      codeVerifier: "google-verifier",
      idToken: undefined,
      nonce: "google-nonce",
      rememberMe: true,
      client: {
        ip: "203.0.113.88",
        device: {
          id: "oauth-device-1",
          type: "desktop",
          isMobile: false,
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          platform: "macOS",
        },
      },
      firstName: "Gina",
      lastName: "Google",
      deviceId: "oauth-device-1",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "refresh_token=google-refresh-token",
    );
    expect(response.headers.get("set-cookie")).toContain("csrf_token=");
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        accessToken: "google-access-token",
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
        },
      },
      error: null,
      message: "Authenticated successfully.",
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("POST /auth/oauth/microsoft accepts id_token auth on mobile and returns the refresh token in the body", async () => {
    const { app, authService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/oauth/microsoft")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.44",
          "x-device-id": "mobile-oauth-device",
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
          "sec-ch-ua-mobile": "?1",
          "sec-ch-ua-platform": '"iOS"',
        },
        body: JSON.stringify({
          idToken: "microsoft-id-token",
          nonce: "microsoft-nonce",
          rememberMe: true,
        }),
      },
    );

    expect(authService.microsoftAuthenticate).toHaveBeenCalledWith({
      code: undefined,
      codeVerifier: undefined,
      idToken: "microsoft-id-token",
      nonce: "microsoft-nonce",
      rememberMe: true,
      client: {
        ip: "198.51.100.44",
        device: {
          id: "mobile-oauth-device",
          type: "mobile",
          isMobile: true,
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
          platform: "iOS",
        },
      },
      firstName: undefined,
      lastName: undefined,
      deviceId: "mobile-oauth-device",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        accessToken: "microsoft-access-token",
        refreshToken: "microsoft-refresh-token",
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
        },
      },
      error: null,
      message: "Authenticated successfully.",
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("POST /auth/logout authenticates via bearer token, reads the refresh cookie, and clears it in the response", async () => {
    const { app, authService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/logout")}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer good-token",
          cookie: "refresh_token=refresh-cookie-value",
          "x-forwarded-for": "203.0.113.77",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
      },
    );

    expect(authService.logout).toHaveBeenCalledWith({
      auth: createJwtAuthPrincipal(),
      client: {
        ip: "203.0.113.77",
        device: {
          id: undefined,
          type: "desktop",
          isMobile: false,
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          platform: undefined,
        },
      },
      refreshToken: "refresh-cookie-value",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("refresh_token=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        loggedOut: true,
        auth: {
          userId: "user-1",
          deviceId: "device-1",
        },
        refreshToken: "refresh-cookie-value",
        client: {
          ip: "203.0.113.77",
          device: {
            type: "desktop",
            isMobile: false,
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          },
        },
      },
      error: null,
      message: "Logged out successfully.",
      meta: {
        requestId: "unknown",
      },
    });
  });
});
