import { SelfLockController } from "@/features/auth/self-lock/self-lock.controller";
import type { SelfLockService } from "@/features/auth/self-lock/self-lock.service";
import { MFA_MANAGEMENT_SCOPE } from "@/features/auth/mfa/verification/mfa-verification.model";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import { MfaVerificationRequiredError } from "@/errors/http/mfa-verification-required.error";
import { RequestValidationError } from "@/configuration/validation/request";
import {
  createClaims,
  createContext,
  invoke,
} from "../../../support/auth-controller-harness";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 378301);
const AUDIT_CONTEXT = {
  ipAddress: "127.0.0.1",
  userAgent: "test-agent",
  deviceId: "device-1",
  requestId: "request-test",
};

const mockRequireRecentMfaVerification = jest.fn();

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecentMfaVerification(...args),
}));

function createController() {
  const selfLockService = {
    lockWithToken: jest.fn(async () => ({ locked: true })),
    lockFromSession: jest.fn(async () => ({ locked: true })),
  };
  const mfaVerificationService = {} as MfaVerificationService;

  return {
    selfLockService,
    mfaVerificationService,
    controller: new SelfLockController(
      selfLockService as unknown as SelfLockService,
      mfaVerificationService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireRecentMfaVerification.mockResolvedValue(
    createClaims({ sub: USER_ID, sessionId: "session-1" }),
  );
});

describe("SelfLockController.lockWithToken", () => {
  it("passes the trimmed token and the request context", async () => {
    const { controller, selfLockService } = createController();

    const response = await invoke(
      controller.lockWithToken,
      createContext({ body: { token: "  token-1  " } }),
    );

    expect(response.status).toBe(200);
    expect(selfLockService.lockWithToken).toHaveBeenCalledWith(
      "token-1",
      AUDIT_CONTEXT,
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      message: "Your account is locked. Reset your password to get back in.",
      data: { locked: true },
    });
    expect(mockRequireRecentMfaVerification).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing token", {}],
    ["an empty token", { token: "   " }],
    ["an over-long token", { token: "a".repeat(257) }],
    ["an unknown field", { token: "token-1", userId: USER_ID }],
  ])("rejects %s", async (_label, body) => {
    const { controller, selfLockService } = createController();

    await expect(
      invoke(controller.lockWithToken, createContext({ body })),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(selfLockService.lockWithToken).not.toHaveBeenCalled();
  });
});

describe("SelfLockController.lockCurrentSession", () => {
  it("locks the verified caller and clears the browser's session cookies", async () => {
    const { controller, selfLockService, mfaVerificationService } =
      createController();

    const context = createContext();
    const response = await invoke(controller.lockCurrentSession, context);

    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      expect.anything(),
      mfaVerificationService,
      MFA_MANAGEMENT_SCOPE,
    );
    expect(selfLockService.lockFromSession).toHaveBeenCalledWith(
      USER_ID,
      AUDIT_CONTEXT,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { locked: true },
    });
    const cookies = String(context.recorder.headers()["set-cookie"]);
    expect(cookies).toContain("refresh_token=");
    expect(cookies).toContain("csrf_token=");
  });

  it("locks nothing without a recent step-up", async () => {
    const { controller, selfLockService } = createController();
    mockRequireRecentMfaVerification.mockRejectedValueOnce(
      new MfaVerificationRequiredError({ scope: MFA_MANAGEMENT_SCOPE }),
    );

    await expect(
      invoke(controller.lockCurrentSession, createContext()),
    ).rejects.toBeInstanceOf(MfaVerificationRequiredError);
    expect(selfLockService.lockFromSession).not.toHaveBeenCalled();
  });
});
