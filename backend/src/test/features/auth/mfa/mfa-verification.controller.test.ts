import { createTestContext, invoke } from "../../../support/mock-http";
import type {
  AppBindings,
  ClientRequestContext,
} from "@/configuration/http/bindings";
import { RequestValidationError } from "@/configuration/validation/request";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { MfaVerificationController } from "@/features/auth/mfa/verification/mfa-verification.controller";

const mockRequireSessionAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
}));

function createAuth(
  overrides: Partial<JwtAuthPrincipal> = {},
): JwtAuthPrincipal {
  return {
    authMethod: "jwt",
    sub: "user-1",
    email: "user@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 0,
    sessionId: "session-1",
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createClient(
  overrides: Partial<ClientRequestContext> = {},
): ClientRequestContext {
  return {
    ip: "127.0.0.1",
    device: {
      id: "device-1",
      type: "desktop",
      isMobile: false,
      userAgent: "test-agent",
      platform: "test-os",
    },
    ...overrides,
  };
}

function createContext(options?: {
  body?: unknown;
  query?: Record<string, string | undefined>;
  client?: ClientRequestContext;
}) {
  const query = new URLSearchParams(
    Object.entries(options?.query ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ).toString();

  return createTestContext({
    body: options?.body,
    url: `https://example.test/auth/mfa/verify${query ? `?${query}` : ""}`,
    state: {
      client: options?.client ?? createClient(),
      requestId: "request-1",
      container: {
        resolve: () => ({
          inspectRequest: () => [],
        }),
      },
    },
  });
}

function createController() {
  const mfaVerificationService = {
    getOptions: jest.fn(async () => ({
      scope: "mfa-management" as const,
      verified: false,
      verifiedUntil: null,
      availableFactors: ["email", "totp"],
      recommendedFactor: "totp",
    })),
    issueChallenge: jest.fn(async () => ({
      scope: "mfa-management" as const,
      factor: "email" as const,
      challengeId: null,
      cooldownUntil: "2026-06-28T12:00:00.000Z",
    })),
    confirmChallenge: jest.fn(async () => ({
      verified: true as const,
      scope: "mfa-management" as const,
      factor: "totp" as const,
      verifiedUntil: "2026-06-28T12:15:00.000Z",
    })),
    previewCurrentEmailOtp: jest.fn(async () => ({
      scope: "mfa-management" as const,
      factor: "email" as const,
      code: "123456",
      expiresInSeconds: 300,
    })),
  };

  return {
    controller: new MfaVerificationController(mfaVerificationService as any),
    mfaVerificationService,
  };
}

describe("MfaVerificationController", () => {
  beforeEach(() => {
    mockRequireSessionAuth.mockReset();
  });

  it("loads options for the authenticated session and parsed scope", async () => {
    mockRequireSessionAuth.mockResolvedValue(createAuth());
    const { controller, mfaVerificationService } = createController();
    const context = createContext({
      query: {
        scope: "mfa-management",
      },
    });

    const response = await invoke(controller.getOptions, context);
    const payload = await response.json();

    expect(mfaVerificationService.getOptions).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
      scope: "mfa-management",
    });
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      scope: "mfa-management",
      recommendedFactor: "totp",
    });
  });

  it("issues a challenge with the request body and current client context", async () => {
    mockRequireSessionAuth.mockResolvedValue(createAuth({ sub: "user-2" }));
    const { controller, mfaVerificationService } = createController();
    const context = createContext({
      body: {
        scope: "mfa-management",
        factor: "email",
      },
    });

    const response = await invoke(controller.issueChallenge, context);

    expect(mfaVerificationService.issueChallenge).toHaveBeenCalledWith({
      userId: "user-2",
      sessionId: "session-1",
      scope: "mfa-management",
      factor: "email",
      client: context.get("client"),
    });
    expect(response.status).toBe(200);
  });

  it("confirms a challenge with the submitted code", async () => {
    mockRequireSessionAuth.mockResolvedValue(createAuth({ sub: "user-3" }));
    const { controller, mfaVerificationService } = createController();
    const context = createContext({
      body: {
        scope: "mfa-management",
        factor: "totp",
        code: " 123456 ",
      },
    });

    const response = await invoke(controller.confirmChallenge, context);
    const payload = await response.json();

    expect(mfaVerificationService.confirmChallenge).toHaveBeenCalledWith({
      userId: "user-3",
      sessionId: "session-1",
      scope: "mfa-management",
      factor: "totp",
      code: "123456",
      client: context.get("client"),
    });
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      verified: true,
      factor: "totp",
    });
  });

  it("previews the current email OTP for the authenticated session", async () => {
    mockRequireSessionAuth.mockResolvedValue(createAuth({ sub: "user-4" }));
    const { controller, mfaVerificationService } = createController();
    const context = createContext({
      query: {
        scope: "mfa-management",
      },
    });

    const response = await invoke(controller.previewCurrentEmailOtp, context);

    expect(mfaVerificationService.previewCurrentEmailOtp).toHaveBeenCalledWith({
      userId: "user-4",
      sessionId: "session-1",
      scope: "mfa-management",
    });
    expect(response.status).toBe(200);
  });

  it("wraps invalid scope queries in a request validation error", async () => {
    mockRequireSessionAuth.mockResolvedValue(createAuth());
    const { controller, mfaVerificationService } = createController();

    await expect(
      invoke(
        controller.getOptions,
        createContext({
          query: {
            scope: "not-a-scope",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(mfaVerificationService.getOptions).not.toHaveBeenCalled();
  });

  it("rejects requests when the authenticated session no longer has a session id", async () => {
    mockRequireSessionAuth.mockResolvedValue(
      createAuth({ sessionId: undefined }),
    );
    const { controller, mfaVerificationService } = createController();

    await expect(
      invoke(
        controller.getOptions,
        createContext({
          query: {
            scope: "mfa-management",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(mfaVerificationService.getOptions).not.toHaveBeenCalled();
  });
});
