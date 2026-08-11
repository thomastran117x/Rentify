import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import BadRequestError from "@/errors/http/bad-request.error";
import { AuthController } from "@/features/auth/auth.controller";
import type {
  AuthSessionResult,
  AuthUserProfile,
} from "@/features/auth/auth.model";
import { containerTokens } from "@/configuration/container/tokens";
import type { JwtClaims } from "@/features/auth/token/token.service";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import { RequestValidationError } from "@/configuration/validation/request";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";
import { createMockRequest, createMockResponse } from "../../support/mock-http";

const mockRequireJwtAuth = jest.fn();
const mockRequireRecentMfaVerification = jest.fn();
const mockGetCookie = jest.fn();
const mockSetCookie = jest.fn();
const mockDeleteCookie = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecentMfaVerification(...args),
}));

// Only the cookie helpers are stubbed; the rest of the module (getQuery,
// getRequestUrl) is what the controller uses to read the request.
jest.mock("@/configuration/http/request", () => ({
  ...jest.requireActual("@/configuration/http/request"),
  readCookie: (...args: unknown[]) => mockGetCookie(...args),
  writeCookie: (...args: unknown[]) => mockSetCookie(...args),
  clearCookie: (...args: unknown[]) => mockDeleteCookie(...args),
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

function createClaims(overrides: Partial<JwtClaims> = {}): JwtAuthPrincipal {
  return {
    sub: "user-1",
    username: "test-user",
    role: "user",
    deviceId: "token-device-1",
    tokenVersion: 2,
    iat: 1,
    exp: 9_999_999_999,
    authMethod: "jwt",
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

function createContext(options?: {
  body?: unknown;
  client?: ClientRequestContext;
  auth?: JwtClaims;
  headers?: Record<string, string | undefined>;
  params?: Record<string, string>;
  url?: string;
}) {
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

  const body = options?.body ?? {};
  const serialised = typeof body === "string" ? body : JSON.stringify(body);

  const request = createMockRequest({
    params: options?.params,
    url: options?.url ?? "https://example.test/auth",
    body,
    rawBody: serialised,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(serialised)),
      ...options?.headers,
    },
    state: {
      container,
      client: options?.client ?? createClient(),
      requestId:
        options?.headers?.["x-request-id"] ??
        options?.headers?.["X-Request-Id"] ??
        "request-test",
      ...(options?.auth ? { auth: options.auth } : {}),
    },
  });
  const recorder = createMockResponse();
  (recorder.response as { req?: typeof request }).req = request;

  return {
    request,
    response: recorder.response,
    recorder,
    get: (name: string) =>
      (request as unknown as Record<string, unknown>)[name],
  };
}

type TestContext = ReturnType<typeof createContext>;

/**
 * Calls a native handler and reports what it wrote, so the assertions below can
 * keep reading `status` and `json()` the way they did when handlers returned a
 * Response.
 */
async function invoke(
  handler: (
    request: TestContext["request"],
    response: TestContext["response"],
  ) => Promise<void>,
  context: TestContext,
) {
  await handler(context.request, context.response);

  return {
    status: context.recorder.status(),
    // Typed loosely like Response.json(), so callers can read into the payload.
    json: async (): Promise<any> => context.recorder.json(),
  };
}

function createController(overrides?: {
  localAuthenticate?: (input: unknown) => Promise<AuthSessionResult>;
  localSignup?: (input: unknown) => Promise<unknown>;
  forgotPassword?: (input: unknown) => Promise<unknown>;
  forgotUsername?: (input: unknown) => Promise<unknown>;
  resendForgotPassword?: (input: unknown) => Promise<unknown>;
  resetPassword?: (input: unknown) => Promise<AuthSessionResult>;
  verifyEmail?: (input: unknown) => Promise<AuthSessionResult>;
  resendVerificationEmail?: (input: unknown) => Promise<unknown>;
  unlockLocalLogin?: (input: unknown) => Promise<unknown>;
  resendUnlockLocalLogin?: (input: unknown) => Promise<unknown>;
  changePassword?: (input: unknown) => Promise<AuthSessionResult>;
  googleAuthenticate?: (input: unknown) => Promise<AuthSessionResult>;
  microsoftAuthenticate?: (input: unknown) => Promise<AuthSessionResult>;
  appleAuthenticate?: (input: unknown) => Promise<AuthSessionResult>;
  linkOAuthProvider?: (input: unknown) => Promise<unknown>;
  linkedOAuthProviders?: (input: unknown) => Promise<unknown>;
  unlinkOAuthProvider?: (input: unknown) => Promise<unknown>;
  refresh?: (input: unknown) => Promise<AuthSessionResult>;
  logout?: (input: unknown) => Promise<unknown>;
  localVerify?: (input: unknown) => Promise<unknown>;
  deviceVerify?: (input: unknown) => Promise<unknown>;
  devices?: (input: unknown) => Promise<unknown>;
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
          username: "test-user",
          alreadyPending: false,
        })),
    ),
    forgotPassword: jest.fn(
      overrides?.forgotPassword ??
        (async () => ({
          accepted: true,
        })),
    ),
    forgotUsername: jest.fn(
      overrides?.forgotUsername ??
        (async () => ({
          accepted: true,
        })),
    ),
    resendForgotPassword: jest.fn(
      overrides?.resendForgotPassword ??
        (async () => ({
          accepted: true,
        })),
    ),
    resetPassword: jest.fn(
      overrides?.resetPassword ??
        (async () =>
          createSessionResult({
            accessToken: "reset-access-token",
            refreshToken: "reset-refresh-token",
          })),
    ),
    verifyEmail: jest.fn(
      overrides?.verifyEmail ??
        (async () =>
          createSessionResult({
            accessToken: "verified-access-token",
            refreshToken: "verified-refresh-token",
          })),
    ),
    resendVerificationEmail: jest.fn(
      overrides?.resendVerificationEmail ??
        (async () => ({
          accepted: true,
        })),
    ),
    unlockLocalLogin: jest.fn(
      overrides?.unlockLocalLogin ??
        (async () => ({
          unlocked: true,
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
    appleAuthenticate: jest.fn(
      overrides?.appleAuthenticate ??
        (async () =>
          createSessionResult({
            accessToken: "apple-access-token",
            refreshToken: "apple-refresh-token",
          })),
    ),
    linkOAuthProvider: jest.fn(
      overrides?.linkOAuthProvider ??
        (async () => ({
          linked: true,
        })),
    ),
    linkedOAuthProviders: jest.fn(
      overrides?.linkedOAuthProviders ??
        (async () => ({
          providers: ["google"],
        })),
    ),
    unlinkOAuthProvider: jest.fn(
      overrides?.unlinkOAuthProvider ??
        (async () => ({
          unlinked: true,
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
    deviceVerify: jest.fn(
      overrides?.deviceVerify ??
        (async () => ({
          verified: true,
        })),
    ),
    devices: jest.fn(
      overrides?.devices ??
        (async () => ({
          devices: [],
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
  const mfaVerificationService = {
    assertRecentVerification: jest.fn(async () => {}),
  };

  return {
    controller: new AuthController(
      authService as any,
      captchaService as any,
      tokenService as any,
      mfaVerificationService as any,
    ),
    authService,
    captchaService,
  };
}

describe("AuthController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockRequireRecentMfaVerification.mockReset();
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
        username: "TEST-USER",
        password: "Password1!",
        captchaToken: "captcha-token",
        rememberMe: true,
      },
      headers: {
        "x-request-id": "request-123",
        origin: "http://localhost:3040",
      },
    });

    const response = await invoke(controller.localAuthenticate, context);

    expect(captchaService.verify).toHaveBeenCalledWith({
      token: "captcha-token",
      remoteIp: "127.0.0.1",
      idempotencyKey: "request-123",
    });
    expect(authService.localAuthenticate).toHaveBeenCalledWith({
      username: "test-user",
      password: "Password1!",
      rememberMe: true,
      client: context.get("client"),
      deviceId: "device-1",
    });
    expect(mockSetCookie).toHaveBeenCalledWith(
      context.response,
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
      context.response,
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
          organizationMembershipCount: 0,
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
        username: "test-user",
        password: "Password1!",
        captchaToken: "captcha-token",
      },
    });

    const response = await invoke(controller.localAuthenticate, context);

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
          organizationMembershipCount: 0,
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
        username: "test-user",
        password: "Password1!",
        captchaToken: "captcha-token",
      },
    });

    const response = await invoke(controller.localAuthenticate, context);

    expect(mockSetCookie).toHaveBeenCalledWith(
      context.response,
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
        user: {
          organizationMembershipCount: 0,
        },
      },
      error: null,
      message: "Authenticated successfully.",
    });
    expect(body.data).not.toHaveProperty("refreshToken");
  });

  it("includes organization context in auth responses when available", async () => {
    const { controller } = createController({
      localAuthenticate: async () =>
        createSessionResult({
          user: createAuthUser({
            role: "owner",
            organizationMembershipCount: 2,
            activeOrganization: {
              id: "org-1",
              name: "Northwind",
              role: "primary_manager",
            },
          }),
        }),
    });
    const context = createContext({
      body: {
        username: "test-user",
        password: "Password1!",
        captchaToken: "captcha-token",
      },
    });

    const response = await invoke(controller.localAuthenticate, context);

    await expect(response.json()).resolves.toMatchObject({
      data: {
        user: {
          role: "owner",
          organizationMembershipCount: 2,
          activeOrganization: {
            id: "org-1",
            name: "Northwind",
            role: "primary_manager",
          },
        },
      },
    });
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
        username: "test-user",
        password: "StrongPassword1!",
        email: "user@example.com",
        captchaToken: "captcha-token",
      },
    });

    await expect(invoke(controller.localSignup, context)).rejects.toMatchObject<
      Partial<BadRequestError>
    >({
      message: "Captcha verification failed.",
      details: {
        errors: ["turnstile-timeout"],
        failOpen: true,
      },
    });
  });

  it("covers signup and recovery flows with their expected service inputs", async () => {
    const { controller, authService } = createController();

    const signupResponse = await invoke(
      controller.localSignup,
      createContext({
        body: {
          email: "USER@example.com",
          username: "TEST-USER",
          password: "StrongPassword1!",
          captchaToken: "signup-captcha",
          firstName: "Test",
          lastName: "User",
          deviceId: "signup-device",
        },
        headers: {
          "x-request-id": "signup-request",
        },
      }),
    );
    const forgotResponse = await invoke(
      controller.forgotPassword,
      createContext({
        body: {
          username: "OWNER-ONE",
          captchaToken: "forgot-captcha",
        },
      }),
    );
    const resendForgotResponse = await invoke(
      controller.resendForgotPassword,
      createContext({
        body: {
          username: "OWNER-ONE",
          captchaToken: "resend-forgot-captcha",
        },
      }),
    );
    const resetResponse = await invoke(
      controller.resetPassword,
      createContext({
        body: {
          username: "OWNER-ONE",
          code: "123456",
          newPassword: "ResetPassword1!",
          deviceId: "reset-device",
        },
      }),
    );
    const verifyResponse = await invoke(
      controller.verifyEmail,
      createContext({
        body: {
          email: "USER@example.com",
          code: "123456",
          deviceId: "verify-device",
        },
      }),
    );
    const resendVerifyResponse = await invoke(
      controller.resendVerificationEmail,
      createContext({
        body: {
          email: "USER@example.com",
          captchaToken: "verify-captcha",
        },
      }),
    );
    const unlockResponse = await invoke(
      controller.unlockLocalLogin,
      createContext({
        body: {
          email: "USER@example.com",
          code: "654321",
        },
      }),
    );
    const resendUnlockResponse = await invoke(
      controller.resendUnlockLocalLogin,
      createContext({
        body: {
          email: "USER@example.com",
          captchaToken: "unlock-captcha",
        },
      }),
    );

    expect(authService.localSignup).toHaveBeenCalledWith({
      client: expect.any(Object),
      username: "test-user",
      email: "user@example.com",
      password: "StrongPassword1!",
      firstName: "Test",
      lastName: "User",
      deviceId: "signup-device",
    });
    expect(authService.forgotPassword).toHaveBeenCalledWith({
      client: expect.any(Object),
      username: "owner-one",
      deviceId: "device-1",
    });
    expect(authService.resendForgotPassword).toHaveBeenCalledWith({
      client: expect.any(Object),
      username: "owner-one",
      deviceId: "device-1",
    });
    expect(authService.resetPassword).toHaveBeenCalledWith({
      client: expect.any(Object),
      username: "owner-one",
      code: "123456",
      newPassword: "ResetPassword1!",
      deviceId: "reset-device",
    });
    expect(authService.verifyEmail).toHaveBeenCalledWith({
      client: expect.any(Object),
      email: "user@example.com",
      code: "123456",
      deviceId: "verify-device",
    });
    expect(authService.resendVerificationEmail).toHaveBeenCalledWith({
      client: expect.any(Object),
      email: "user@example.com",
      deviceId: "device-1",
    });
    expect(authService.unlockLocalLogin).toHaveBeenCalledWith({
      email: "user@example.com",
      code: "654321",
    });
    expect(authService.resendUnlockLocalLogin).toHaveBeenCalledWith({
      client: expect.any(Object),
      email: "user@example.com",
      deviceId: "device-1",
    });
    expect(signupResponse.status).toBe(202);
    expect(forgotResponse.status).toBe(202);
    expect(resendForgotResponse.status).toBe(202);
    expect(resetResponse.status).toBe(200);
    expect(verifyResponse.status).toBe(200);
    expect(resendVerifyResponse.status).toBe(202);
    expect(unlockResponse.status).toBe(200);
    expect(resendUnlockResponse.status).toBe(202);
  });

  it("public resend actions verify captcha before calling the auth service", async () => {
    const { controller, authService, captchaService } = createController();

    await invoke(
      controller.resendForgotPassword,
      createContext({
        body: {
          username: "owner-one",
          captchaToken: "resend-forgot-captcha",
        },
        headers: {
          "x-request-id": "req-forgot",
        },
      }),
    );
    await invoke(
      controller.resendVerificationEmail,
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
    await invoke(
      controller.resendUnlockLocalLogin,
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

  it("forgotUsername verifies captcha, lowercases the email, and accepts the request", async () => {
    const { controller, authService, captchaService } = createController();

    const response = await invoke(
      controller.forgotUsername,
      createContext({
        body: {
          email: "OWNER1@rentify.local",
          captchaToken: "forgot-username-captcha",
        },
        headers: {
          "x-request-id": "req-forgot-username",
        },
      }),
    );

    expect(captchaService.verify).toHaveBeenCalledTimes(1);
    expect(authService.forgotUsername).toHaveBeenCalledWith({
      client: expect.any(Object),
      email: "owner1@rentify.local",
      deviceId: "device-1",
    });
    expect(response.status).toBe(202);
  });

  it("localSignup rejects html in profile fields before calling the auth service", async () => {
    const { controller, authService, captchaService } = createController();
    const context = createContext({
      body: {
        email: "user@example.com",
        username: "test-user",
        password: "StrongPassword1!",
        captchaToken: "captcha-token",
        firstName: "<script>alert('xss')</script>",
      },
    });

    await expect(invoke(controller.localSignup, context)).rejects.toMatchObject<
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
        username: "test-user",
        password: "<script>Password1!</script>",
        captchaToken: "captcha-token",
      },
    });

    await expect(
      invoke(controller.localAuthenticate, context),
    ).rejects.toMatchObject<Partial<RequestValidationError>>({
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
    mockRequireRecentMfaVerification.mockImplementation(
      async (request: TestContext["request"]) => {
        request.auth = auth;
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

    const response = await invoke(controller.changePassword, context);

    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      context.request,
      expect.any(Object),
      "mfa-management",
    );
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

    const response = await invoke(controller.refresh, context);

    expect(mockGetCookie).toHaveBeenCalledWith(
      context.request,
      "refresh_token",
    );
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
      async (request: TestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    mockGetCookie.mockReturnValue("refresh-cookie-token");
    const { controller, authService } = createController();
    const context = createContext();

    const response = await invoke(controller.logout, context);

    expect(authService.logout).toHaveBeenCalledWith({
      auth,
      client: context.get("client"),
      refreshToken: "refresh-cookie-token",
    });
    expect(mockDeleteCookie).toHaveBeenCalledWith(
      context.response,
      "refresh_token",
      {
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    );
    expect(mockDeleteCookie).toHaveBeenCalledWith(
      context.response,
      "csrf_token",
      {
        path: "/",
        secure: false,
        sameSite: "Lax",
      },
    );
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
      async (request: TestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, authService } = createController();
    const context = createContext();

    await invoke(controller.localVerify, context);

    expect(authService.localVerify).toHaveBeenCalledWith({
      auth,
      client: context.get("client"),
    });
  });

  it("removeKnownDevice authenticates first and maps the route input to the authenticated user id", async () => {
    const auth = createClaims({
      sub: "user-12",
    });
    mockRequireRecentMfaVerification.mockImplementation(
      async (request: TestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, authService } = createController();
    const context = createContext({
      body: {
        deviceId: "device-99",
      },
    });

    const response = await invoke(controller.removeKnownDevice, context);

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

  it("covers oauth authentication, linking, provider listing, and unlinking", async () => {
    const auth = createClaims({
      sub: "user-15",
    });
    mockRequireJwtAuth.mockImplementation(
      async (request: TestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, authService } = createController();
    const oauthBody = {
      code: "oauth-code",
      codeVerifier: "oauth-verifier",
      nonce: "oauth-nonce",
      rememberMe: true,
      deviceId: "oauth-device",
      firstName: "OAuth",
      lastName: "User",
    };

    const googleResponse = await invoke(
      controller.googleAuthenticate,
      createContext({
        body: oauthBody,
      }),
    );
    const microsoftResponse = await invoke(
      controller.microsoftAuthenticate,
      createContext({
        body: oauthBody,
      }),
    );
    const appleResponse = await invoke(
      controller.appleAuthenticate,
      createContext({
        body: {
          idToken: "id-token",
          nonce: "apple-nonce",
        },
      }),
    );
    const linkResponse = await invoke(
      controller.linkOAuthProvider,
      createContext({
        auth,
        params: {
          provider: "google",
        },
        body: oauthBody,
      }),
    );
    const listResponse = await invoke(
      controller.linkedOAuthProviders,
      createContext({
        auth,
      }),
    );
    const unlinkResponse = await invoke(
      controller.unlinkOAuthProvider,
      createContext({
        auth,
        params: {
          provider: "microsoft",
        },
      }),
    );

    expect(authService.googleAuthenticate).toHaveBeenCalledWith({
      code: "oauth-code",
      codeVerifier: "oauth-verifier",
      idToken: undefined,
      nonce: "oauth-nonce",
      rememberMe: true,
      client: expect.any(Object),
      firstName: "OAuth",
      lastName: "User",
      deviceId: "oauth-device",
    });
    expect(authService.microsoftAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: "oauth-nonce",
        code: "oauth-code",
      }),
    );
    expect(authService.appleAuthenticate).toHaveBeenCalledWith({
      code: undefined,
      codeVerifier: undefined,
      idToken: "id-token",
      nonce: "apple-nonce",
      rememberMe: undefined,
      client: expect.any(Object),
      firstName: undefined,
      lastName: undefined,
      deviceId: "device-1",
    });
    expect(authService.linkOAuthProvider).toHaveBeenCalledWith({
      code: "oauth-code",
      codeVerifier: "oauth-verifier",
      idToken: undefined,
      nonce: "oauth-nonce",
      rememberMe: true,
      client: expect.any(Object),
      firstName: "OAuth",
      lastName: "User",
      deviceId: "oauth-device",
      provider: "google",
      userId: "user-15",
    });
    expect(authService.linkedOAuthProviders).toHaveBeenCalledWith({
      userId: "user-15",
    });
    expect(authService.unlinkOAuthProvider).toHaveBeenCalledWith({
      provider: "microsoft",
      userId: "user-15",
    });
    expect(googleResponse.status).toBe(200);
    expect(microsoftResponse.status).toBe(200);
    expect(appleResponse.status).toBe(200);
    expect(linkResponse.status).toBe(200);
    expect(listResponse.status).toBe(200);
    expect(unlinkResponse.status).toBe(200);
  });

  it("forwards the isNewUser flag from a first-time OAuth sign-in into the response body", async () => {
    const { controller } = createController({
      googleAuthenticate: async () =>
        createSessionResult({
          accessToken: "google-access-token",
          isNewUser: true,
        }),
    });

    const response = await invoke(
      controller.googleAuthenticate,
      createContext({
        body: {
          code: "oauth-code",
          codeVerifier: "oauth-verifier",
          nonce: "oauth-nonce",
        },
      }),
    );

    const body = await response.json();
    expect(body.data.isNewUser).toBe(true);
  });

  it("omits isNewUser from the response body for returning OAuth sign-ins", async () => {
    const { controller } = createController({
      googleAuthenticate: async () =>
        createSessionResult({
          accessToken: "google-access-token",
        }),
    });

    const response = await invoke(
      controller.googleAuthenticate,
      createContext({
        body: {
          code: "oauth-code",
          codeVerifier: "oauth-verifier",
          nonce: "oauth-nonce",
        },
      }),
    );

    const body = await response.json();
    expect(body.data).not.toHaveProperty("isNewUser");
  });

  it("validates oauth provider route params before calling the service", async () => {
    const auth = createClaims();
    mockRequireJwtAuth.mockImplementation(
      async (request: TestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, authService } = createController();

    await expect(
      invoke(
        controller.unlinkOAuthProvider,
        createContext({
          auth,
          params: {
            provider: "invalid-provider",
          },
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "RequestValidationError",
        message: "Route parameter validation failed.",
      }),
    );

    expect(authService.unlinkOAuthProvider).not.toHaveBeenCalled();
  });

  it("covers device verification and known-device listing routes", async () => {
    const auth = createClaims({
      sub: "user-44",
      deviceId: "trusted-device-44",
    });
    mockRequireJwtAuth.mockImplementation(
      async (request: TestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    mockRequireRecentMfaVerification.mockResolvedValue(undefined);
    const { controller, authService } = createController();

    const verifyResponse = await invoke(
      controller.deviceVerify,
      createContext({
        auth,
      }),
    );
    const devicesResponse = await invoke(
      controller.devices,
      createContext({
        auth,
      }),
    );

    expect(authService.deviceVerify).toHaveBeenCalledWith({
      auth,
      client: expect.any(Object),
    });
    expect(authService.devices).toHaveBeenCalledWith({
      auth,
      client: expect.any(Object),
    });
    expect(verifyResponse.status).toBe(200);
    expect(devicesResponse.status).toBe(200);
  });
});
