import BadRequestError from "@/errors/http/bad-request.error";
import { AuthController } from "@/features/auth/auth.controller";
import type {
  AuthSessionResult,
  AuthUserProfile,
} from "@/features/auth/auth.model";
import { containerTokens } from "@/configuration/container/tokens";
import type { JwtClaims } from "@/features/auth/token/token.service";
import type {
  AppBindings,
  ClientRequestContext,
} from "@/configuration/http/bindings";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import { RequestValidationError } from "@/configuration/validation/request";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import type { Context } from "hono";

const mockRequireJwtAuth = jest.fn();
const mockGetCookie = jest.fn();
const mockSetCookie = jest.fn();
const mockDeleteCookie = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

jest.mock("hono/cookie", () => ({
  getCookie: (...args: unknown[]) => mockGetCookie(...args),
  setCookie: (...args: unknown[]) => mockSetCookie(...args),
  deleteCookie: (...args: unknown[]) => mockDeleteCookie(...args),
}));

function createClient(
  overrides?: Partial<ClientRequestContext>,
): ClientRequestContext {
  return {
    ip: "127.0.0.1",
    device: {
      id: "device-1",
      type: "desktop",
      isMobile: false,
      userAgent: "test-agent",
      platform: "macOS",
    },
    ...overrides,
  };
}

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    email: "user@example.com",
    role: "user",
    deviceId: "token-device-1",
    tokenVersion: 2,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

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

function createContext(options?: {
  body?: unknown;
  client?: ClientRequestContext;
  auth?: JwtClaims;
  headers?: Record<string, string | undefined>;
}) {
  const variables = new Map<string, unknown>();
  const contentSanitizationService = new ContentSanitizationService();
  const container: ServiceContainer = {
    resolve<TValue>(token: unknown): TValue {
      if (token === containerTokens.contentSanitizationService) {
        return contentSanitizationService as TValue;
      }

      throw new Error(`Unexpected token: ${String(token)}`);
    },
    createScope(): ServiceContainer {
      return this;
    },
    async dispose(): Promise<void> {},
  };

  variables.set("container", container);
  variables.set("client", options?.client ?? createClient());
  variables.set(
    "requestId",
    options?.headers?.["x-request-id"] ??
      options?.headers?.["X-Request-Id"] ??
      "request-test",
  );

  if (options?.auth) {
    variables.set("auth", options.auth);
  }

  const context = {
    req: {
      json: async () => options?.body ?? {},
      header: (name: string) =>
        options?.headers?.[name.toLowerCase()] ?? options?.headers?.[name],
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

function createController(overrides?: {
  localAuthenticate?: (input: unknown) => Promise<AuthSessionResult>;
  localSignup?: (input: unknown) => Promise<unknown>;
  resendForgotPassword?: (input: unknown) => Promise<unknown>;
  resendVerificationEmail?: (input: unknown) => Promise<unknown>;
  resendUnlockLocalLogin?: (input: unknown) => Promise<unknown>;
  changePassword?: (input: unknown) => Promise<AuthSessionResult>;
  refresh?: (input: unknown) => Promise<AuthSessionResult>;
  logout?: (input: unknown) => Promise<unknown>;
  localVerify?: (input: unknown) => Promise<unknown>;
  removeKnownDevice?: (input: unknown) => Promise<unknown>;
  captchaVerify?: (
    input: unknown,
  ) => Promise<{ success: boolean; failOpen: boolean; errors: string[] }>;
}) {
  const authService = {
    localAuthenticate: jest.fn(
      overrides?.localAuthenticate ?? (async () => createSessionResult()),
    ),
    localSignup: jest.fn(
      overrides?.localSignup ??
        (async () => ({
          verificationRequired: true,
          email: "user@example.com",
          alreadyPending: false,
        })),
    ),
    resendForgotPassword: jest.fn(
      overrides?.resendForgotPassword ??
        (async () => ({
          accepted: true,
        })),
    ),
    resendVerificationEmail: jest.fn(
      overrides?.resendVerificationEmail ??
        (async () => ({
          accepted: true,
        })),
    ),
    resendUnlockLocalLogin: jest.fn(
      overrides?.resendUnlockLocalLogin ??
        (async () => ({
          accepted: true,
        })),
    ),
    changePassword: jest.fn(
      overrides?.changePassword ??
        (async () =>
          createSessionResult({
            accessToken: "changed-access-token",
            refreshToken: "changed-refresh-token",
          })),
    ),
    refresh: jest.fn(
      overrides?.refresh ??
        (async () =>
          createSessionResult({
            accessToken: "refreshed-access-token",
            refreshToken: "refreshed-refresh-token",
          })),
    ),
    logout: jest.fn(
      overrides?.logout ??
        (async () => ({
          loggedOut: true,
        })),
    ),
    localVerify: jest.fn(
      overrides?.localVerify ??
        (async () => ({
          verified: true,
        })),
    ),
    removeKnownDevice: jest.fn(
      overrides?.removeKnownDevice ??
        (async () => ({
          removed: true,
          deviceId: "device-2",
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
  const tokenService = {};

  return {
    controller: new AuthController(
      authService as never,
      captchaService as never,
      tokenService as never,
    ),
    authService,
    captchaService,
  };
}

describe("AuthController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockGetCookie.mockReset();
    mockSetCookie.mockReset();
    mockDeleteCookie.mockReset();
  });

  it("localAuthenticate verifies captcha, falls back to the client device id, and stores refresh tokens in cookies for desktop clients", async () => {
    const session = createSessionResult();
    const { controller, authService, captchaService } = createController({
      localAuthenticate: async () => session,
    });
    const context = createContext({
      body: {
        email: "USER@example.com",
        password: "Password1!",
        captchaToken: "captcha-token",
        rememberMe: true,
      },
      headers: {
        "x-request-id": "request-123",
        origin: "http://localhost:3040",
      },
    });

    const response = await controller.localAuthenticate(context);

    expect(captchaService.verify).toHaveBeenCalledWith({
      token: "captcha-token",
      remoteIp: "127.0.0.1",
      idempotencyKey: "request-123",
    });
    expect(authService.localAuthenticate).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "Password1!",
      rememberMe: true,
      client: context.get("client"),
      deviceId: "device-1",
    });
    expect(mockSetCookie).toHaveBeenCalledWith(
      context,
      "refresh_token",
      "refresh-token-1",
      {
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
        maxAge: 86_400,
      },
    );
    expect(mockSetCookie).toHaveBeenCalledWith(
      context,
      "csrf_token",
      expect.any(String),
      {
        path: "/",
        secure: false,
        sameSite: "Lax",
        maxAge: 86_400,
      },
    );
    expect(response.status).toBe(200);
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
        requestId: "request-123",
      },
    });
  });

  it("localAuthenticate returns the refresh token in the response body for non-browser clients", async () => {
    const { controller } = createController();
    const context = createContext({
      client: createClient({
        device: {
          id: "mobile-device",
          type: "mobile",
          isMobile: true,
          userAgent: "mobile-agent",
          platform: "iOS",
        },
      }),
      body: {
        email: "user@example.com",
        password: "Password1!",
        captchaToken: "captcha-token",
      },
    });

    const response = await controller.localAuthenticate(context);

    expect(mockSetCookie).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        accessToken: "access-token-1",
        refreshToken: "refresh-token-1",
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
        requestId: "request-test",
      },
    });
  });

  it("localAuthenticate stores refresh tokens in cookies for mobile browser clients", async () => {
    const { controller } = createController();
    const context = createContext({
      client: createClient({
        device: {
          id: "mobile-browser-device",
          type: "mobile",
          isMobile: true,
          userAgent: "mobile-agent",
          platform: "iOS",
        },
      }),
      headers: {
        origin: "http://localhost:3040",
      },
      body: {
        email: "user@example.com",
        password: "Password1!",
        captchaToken: "captcha-token",
      },
    });

    const response = await controller.localAuthenticate(context);

    expect(mockSetCookie).toHaveBeenCalledWith(
      context,
      "refresh_token",
      "refresh-token-1",
      {
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
        maxAge: 86_400,
      },
    );
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      data: {
        accessToken: "access-token-1",
      },
      error: null,
      message: "Authenticated successfully.",
    });
    expect(body.data).not.toHaveProperty("refreshToken");
  });

  it("localSignup rejects when captcha verification fails closed or fail-open", async () => {
    const { controller } = createController({
      captchaVerify: async () => ({
        success: true,
        failOpen: true,
        errors: ["turnstile-timeout"],
      }),
    });
    const context = createContext({
      body: {
        email: "user@example.com",
        password: "StrongPassword1!",
        captchaToken: "captcha-token",
      },
    });

    await expect(controller.localSignup(context)).rejects.toMatchObject<
      Partial<BadRequestError>
    >({
      message: "Captcha verification failed.",
      details: {
        errors: ["turnstile-timeout"],
        failOpen: true,
      },
    });
  });

  it("public resend actions verify captcha before calling the auth service", async () => {
    const { controller, authService, captchaService } = createController();

    await controller.resendForgotPassword(
      createContext({
        body: {
          email: "user@example.com",
          captchaToken: "resend-forgot-captcha",
        },
        headers: {
          "x-request-id": "req-forgot",
        },
      }),
    );
    await controller.resendVerificationEmail(
      createContext({
        body: {
          email: "user@example.com",
          captchaToken: "resend-verify-captcha",
        },
        headers: {
          "x-request-id": "req-verify",
        },
      }),
    );
    await controller.resendUnlockLocalLogin(
      createContext({
        body: {
          email: "user@example.com",
          captchaToken: "resend-unlock-captcha",
        },
        headers: {
          "x-request-id": "req-unlock",
        },
      }),
    );

    expect(captchaService.verify).toHaveBeenCalledTimes(3);
    expect(authService.resendForgotPassword).toHaveBeenCalledTimes(1);
    expect(authService.resendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(authService.resendUnlockLocalLogin).toHaveBeenCalledTimes(1);
  });

  it("localSignup rejects html in profile fields before calling the auth service", async () => {
    const { controller, authService, captchaService } = createController();
    const context = createContext({
      body: {
        email: "user@example.com",
        password: "StrongPassword1!",
        captchaToken: "captcha-token",
        firstName: "<script>alert('xss')</script>",
      },
    });

    await expect(controller.localSignup(context)).rejects.toMatchObject<
      Partial<RequestValidationError>
    >({
      details: [
        {
          path: "firstName",
          message: "Contains disallowed content.",
        },
      ],
    });
    expect(captchaService.verify).not.toHaveBeenCalled();
    expect(authService.localSignup).not.toHaveBeenCalled();
  });

  it("localAuthenticate rejects script-like passwords before verifying captcha", async () => {
    const { controller, authService, captchaService } = createController();
    const context = createContext({
      body: {
        email: "user@example.com",
        password: "<script>Password1!</script>",
        captchaToken: "captcha-token",
      },
    });

    await expect(controller.localAuthenticate(context)).rejects.toMatchObject<
      Partial<RequestValidationError>
    >({
      message: "Request body validation failed.",
      details: [
        {
          path: "password",
          message: "Input contains unsupported HTML or script content.",
        },
      ],
    });
    expect(captchaService.verify).not.toHaveBeenCalled();
    expect(authService.localAuthenticate).not.toHaveBeenCalled();
  });

  it("changePassword authenticates first and prefers the auth device id when building service input", async () => {
    const auth = createClaims({
      sub: "user-9",
      deviceId: "token-device-9",
    });
    mockRequireJwtAuth.mockImplementation(
      async (context: Context<AppBindings>) => {
        context.set("auth", auth);
        return auth;
      },
    );
    const { controller, authService } = createController();
    const context = createContext({
      client: createClient({
        device: {
          id: "client-device-3",
          type: "desktop",
          isMobile: false,
          userAgent: "desktop-agent",
          platform: "Windows",
        },
      }),
      body: {
        currentPassword: "OldPassword1!",
        newPassword: "NewPassword1!",
      },
    });

    const response = await controller.changePassword(context);

    expect(mockRequireJwtAuth).toHaveBeenCalledWith(context);
    expect(authService.changePassword).toHaveBeenCalledWith({
      userId: "user-9",
      client: context.get("client"),
      currentPassword: "OldPassword1!",
      newPassword: "NewPassword1!",
      deviceId: "token-device-9",
    });
    expect(response.status).toBe(200);
  });

  it("refresh falls back to the refresh_token cookie when the request body omits the token", async () => {
    mockGetCookie.mockReturnValue("cookie-refresh-token");
    const { controller, authService } = createController();
    const context = createContext({
      body: {},
    });

    const response = await controller.refresh(context);

    expect(mockGetCookie).toHaveBeenCalledWith(context, "refresh_token");
    expect(authService.refresh).toHaveBeenCalledWith({
      client: context.get("client"),
      refreshToken: "cookie-refresh-token",
    });
    expect(response.status).toBe(200);
  });

  it("logout authenticates, forwards the refresh token cookie, and clears the refresh cookie", async () => {
    const auth = createClaims({
      sub: "user-4",
      deviceId: "device-4",
    });
    mockRequireJwtAuth.mockImplementation(
      async (context: Context<AppBindings>) => {
        context.set("auth", auth);
        return auth;
      },
    );
    mockGetCookie.mockReturnValue("refresh-cookie-token");
    const { controller, authService } = createController();
    const context = createContext();

    const response = await controller.logout(context);

    expect(authService.logout).toHaveBeenCalledWith({
      auth,
      client: context.get("client"),
      refreshToken: "refresh-cookie-token",
    });
    expect(mockDeleteCookie).toHaveBeenCalledWith(context, "refresh_token", {
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });
    expect(mockDeleteCookie).toHaveBeenCalledWith(context, "csrf_token", {
      path: "/",
      secure: false,
      sameSite: "Lax",
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        loggedOut: true,
      },
      error: null,
      message: "Logged out successfully.",
      meta: {
        requestId: "request-test",
      },
    });
  });

  it("localVerify authenticates first and passes auth and client context through unchanged", async () => {
    const auth = createClaims({
      sub: "user-7",
      role: "owner",
    });
    mockRequireJwtAuth.mockImplementation(
      async (context: Context<AppBindings>) => {
        context.set("auth", auth);
        return auth;
      },
    );
    const { controller, authService } = createController();
    const context = createContext();

    await controller.localVerify(context);

    expect(authService.localVerify).toHaveBeenCalledWith({
      auth,
      client: context.get("client"),
    });
  });

  it("removeKnownDevice authenticates first and maps the route input to the authenticated user id", async () => {
    const auth = createClaims({
      sub: "user-12",
    });
    mockRequireJwtAuth.mockImplementation(
      async (context: Context<AppBindings>) => {
        context.set("auth", auth);
        return auth;
      },
    );
    const { controller, authService } = createController();
    const context = createContext({
      body: {
        deviceId: "device-99",
      },
    });

    const response = await controller.removeKnownDevice(context);

    expect(authService.removeKnownDevice).toHaveBeenCalledWith({
      userId: "user-12",
      deviceId: "device-99",
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        removed: true,
        deviceId: "device-2",
      },
      error: null,
      message: "Known device removed successfully.",
      meta: {
        requestId: "request-test",
      },
    });
  });
});
