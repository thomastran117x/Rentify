import { createTestContext, invoke } from "../../../support/mock-http";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { MfaRecoveryCodeController } from "@/features/auth/mfa/recovery/mfa-recovery-code.controller";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 464101);

const mockRequireSessionAuth = jest.fn();
const mockRequireAnyScope = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
}));

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerificationForAnyScope: (...args: unknown[]) =>
    mockRequireAnyScope(...args),
}));

const AUTH = {
  authMethod: "jwt",
  sub: USER_ID,
  email: "user@example.com",
  role: "user",
  deviceId: "device-1",
  tokenVersion: 0,
  sessionId: "session-1",
  iat: 1,
  exp: 9_999_999_999,
} as JwtAuthPrincipal;

const CLIENT: ClientRequestContext = {
  ip: "127.0.0.1",
  source: "frontend-browser",
  device: {
    id: "device-1",
    type: "desktop",
    isMobile: false,
    userAgent: "test-agent",
    platform: "test-os",
  },
};

function createContext() {
  return createTestContext({
    url: "https://example.test/auth/mfa/recovery-codes",
    state: {
      client: CLIENT,
      requestId: "request-1",
      container: { resolve: () => ({ inspectRequest: () => [] }) },
    },
  } as never);
}

function createController() {
  const service = {
    getStatus: jest.fn(async () => ({ remaining: 3, createdAt: null })),
    regenerate: jest.fn(async () => ({
      codes: ["ABCDE-FGH23"],
      remaining: 10,
      createdAt: "2026-11-07T12:00:00.000Z",
    })),
  };
  const verification = {};

  return {
    service,
    verification,
    controller: new MfaRecoveryCodeController(
      service as never,
      verification as never,
    ),
  };
}

describe("MfaRecoveryCodeController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireSessionAuth.mockResolvedValue(AUTH);
    mockRequireAnyScope.mockResolvedValue(AUTH);
  });

  it("returns the signed-in user's status", async () => {
    const { controller, service } = createController();

    const response = await invoke(controller.getStatus, createContext());

    expect(service.getStatus).toHaveBeenCalledWith(USER_ID);
    await expect(response.json()).resolves.toMatchObject({
      data: { remaining: 3, createdAt: null },
    });
  });

  it("accepts the sign-in's proof as well as a management step-up", async () => {
    const { controller, verification } = createController();

    await invoke(controller.regenerate, createContext());

    expect(mockRequireAnyScope).toHaveBeenCalledWith(
      expect.anything(),
      verification,
      ["device-login", "mfa-management"],
    );
  });

  it("regenerates with the audit context, and marks the codes uncacheable", async () => {
    const { controller, service } = createController();

    const response = await invoke(controller.regenerate, createContext());

    expect(service.regenerate).toHaveBeenCalledWith({
      userId: USER_ID,
      sessionId: "session-1",
      context: {
        ipAddress: "127.0.0.1",
        deviceId: "device-1",
        userAgent: "test-agent",
        requestId: "request-1",
      },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      data: { codes: ["ABCDE-FGH23"], remaining: 10 },
    });
  });

  it("generates nothing without a proof", async () => {
    mockRequireAnyScope.mockRejectedValue(new Error("step-up required"));
    const { controller, service } = createController();

    await expect(
      invoke(controller.regenerate, createContext()),
    ).rejects.toThrow("step-up required");

    expect(service.regenerate).not.toHaveBeenCalled();
  });
});
