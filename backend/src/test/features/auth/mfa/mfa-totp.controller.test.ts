import { createTestContext, invoke } from "../../../support/mock-http";
import type {
  AppBindings,
  ClientRequestContext,
} from "@/configuration/http/bindings";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { MfaTotpController } from "@/features/auth/mfa/totp/mfa-totp.controller";
import { testUuid } from "../../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);
const USER_2_ID = testUuid(9000, 994258);
const USER_3_ID = testUuid(9000, 994259);
const USER_4_ID = testUuid(9000, 994260);
const USER_9_ID = testUuid(9000, 994265);

const mockRequireSessionAuth = jest.fn();
const mockRequireRecentMfaVerification = jest.fn();
const mockLoggerInfo = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
}));

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecentMfaVerification(...args),
}));

jest.mock("@/configuration/logging", () => ({
  loggerFactory: {
    forClass: () => ({
      info: (...args: unknown[]) => mockLoggerInfo(...args),
    }),
    forComponent: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      critical: jest.fn(),
      child: jest.fn(),
    }),
  },
}));

function createAuth(
  overrides: Partial<JwtAuthPrincipal> = {},
): JwtAuthPrincipal {
  return {
    authMethod: "jwt",
    sub: USER_1_ID,
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
    source: "frontend-browser" as const,
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
  client?: ClientRequestContext;
}) {
  return createTestContext({
    body: options?.body,
    url: "https://example.test/auth/mfa/totp",
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
  const mfaTotpService = {
    isEnabled: jest.fn(async () => true),
    beginEnrollment: jest.fn(async () => ({
      secret: "totp-secret",
      uri: "otpauth://totp/test",
    })),
    confirmEnrollment: jest.fn(async () => undefined),
    disable: jest.fn(async () => undefined),
    cancelEnrollment: jest.fn(async () => undefined),
  };
  const mfaVerificationService = {};

  return {
    controller: new MfaTotpController(
      mfaTotpService as any,
      mfaVerificationService as any,
    ),
    mfaTotpService,
  };
}

describe("MfaTotpController", () => {
  beforeEach(() => {
    mockRequireSessionAuth.mockReset();
    mockRequireRecentMfaVerification.mockReset();
    mockLoggerInfo.mockReset();
  });

  it("returns whether TOTP is enabled for the authenticated user", async () => {
    mockRequireSessionAuth.mockResolvedValue(createAuth({ sub: USER_9_ID }));
    const { controller, mfaTotpService } = createController();

    const response = await invoke(controller.getStatus, createContext());
    const payload = await response.json();

    expect(mockRequireSessionAuth).toHaveBeenCalled();
    expect(mfaTotpService.isEnabled).toHaveBeenCalledWith(USER_9_ID);
    expect(response.status).toBe(200);
    expect(payload.data).toEqual({ enabled: true });
  });

  it("begins enrollment after recent verification, normalizes account names, and logs the change", async () => {
    mockRequireRecentMfaVerification.mockResolvedValue(
      createAuth({ sub: USER_2_ID, sessionId: "session-2" }),
    );
    const { controller, mfaTotpService } = createController();
    const context = createContext({
      body: {
        accountName: "  Team Account  ",
      },
    });

    const response = await invoke(controller.beginEnrollment, context);

    expect(mockRequireRecentMfaVerification).toHaveBeenCalled();
    expect(mfaTotpService.beginEnrollment).toHaveBeenCalledWith(
      USER_2_ID,
      "Team Account",
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      "TOTP enrollment started",
      expect.objectContaining({
        userId: USER_2_ID,
        sessionId: "session-2",
        scope: "mfa-management",
        factor: "totp",
        ip: "127.0.0.1",
        userAgent: "test-agent",
        result: "success",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("confirms enrollment and returns the success message", async () => {
    mockRequireRecentMfaVerification.mockResolvedValue(createAuth());
    const { controller, mfaTotpService } = createController();

    const response = await invoke(
      controller.confirmEnrollment,
      createContext({
        body: {
          code: " 123456 ",
        },
      }),
    );
    const payload = await response.json();

    expect(mfaTotpService.confirmEnrollment).toHaveBeenCalledWith(
      USER_1_ID,
      "123456",
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      "TOTP enrollment confirmed",
      expect.objectContaining({
        userId: USER_1_ID,
        factor: "totp",
      }),
    );
    expect(response.status).toBe(200);
    expect(payload.message).toBe("Authenticator app enabled.");
  });

  it("disables TOTP after recent verification and returns the disable message", async () => {
    mockRequireRecentMfaVerification.mockResolvedValue(
      createAuth({ sub: USER_3_ID, sessionId: "session-3" }),
    );
    const { controller, mfaTotpService } = createController();

    const response = await invoke(
      controller.disable,
      createContext({
        body: {},
      }),
    );
    const payload = await response.json();

    expect(mfaTotpService.disable).toHaveBeenCalledWith(USER_3_ID);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      "TOTP disabled",
      expect.objectContaining({
        sessionId: "session-3",
        factor: "totp",
      }),
    );
    expect(response.status).toBe(200);
    expect(payload.message).toBe("Authenticator app disabled.");
  });

  it("cancels pending enrollment after recent verification", async () => {
    mockRequireRecentMfaVerification.mockResolvedValue(
      createAuth({ sub: USER_4_ID, sessionId: "session-4" }),
    );
    const { controller, mfaTotpService } = createController();

    const response = await invoke(controller.cancelEnrollment, createContext());
    const payload = await response.json();

    expect(mfaTotpService.cancelEnrollment).toHaveBeenCalledWith(USER_4_ID);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      "Pending TOTP enrollment cancelled",
      expect.objectContaining({
        userId: USER_4_ID,
        sessionId: "session-4",
      }),
    );
    expect(response.status).toBe(200);
    expect(payload.data).toEqual({ cancelled: true });
  });
});
