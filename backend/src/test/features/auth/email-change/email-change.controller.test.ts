import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import type { EmailChangeService } from "@/features/auth/email-change/email-change.service";
import { EmailChangeController } from "@/features/auth/email-change/email-change.controller";
import {
  createClaims,
  createContext,
  createSessionResult,
  invoke,
} from "../../../support/auth-controller-harness";

const mockRequireRecentMfaVerification = jest.fn();
const mockRequireSessionAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: jest.fn(),
  getOptionalJwtAuth: jest.fn(),
  requireSessionAuth: (...args: unknown[]) => mockRequireSessionAuth(...args),
}));

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecentMfaVerification(...args),
}));

function createController() {
  const emailChangeRevertService = {
    revert: jest.fn(async () => ({
      reverted: true,
      nextStep: "reset_password",
    })),
  };
  const emailChangeService = {
    requestChange: jest.fn(async () => ({
      newEmail: "o***@rentify.local",
      expiresInSeconds: 600,
      resendAvailableInSeconds: 60,
    })),
    resendCode: jest.fn(async () => ({
      newEmail: "o***@rentify.local",
      expiresInSeconds: 600,
      resendAvailableInSeconds: 60,
    })),
    confirmChange: jest.fn(async () => createSessionResult()),
    readPending: jest.fn(async () => ({ pending: false })),
    cancelChange: jest.fn(async () => undefined),
    previewPendingCode: jest.fn(async () => ({
      code: "123456",
      expiresInSeconds: 540,
    })),
  };

  return {
    emailChangeService,
    emailChangeRevertService,
    controller: new EmailChangeController(
      emailChangeService as unknown as EmailChangeService,
      {} as MfaVerificationService,
      emailChangeRevertService as never,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireRecentMfaVerification.mockResolvedValue(createClaims());
  mockRequireSessionAuth.mockResolvedValue(createClaims());
});

describe("EmailChangeController.revertEmailChange", () => {
  it("is public: the emailed token is the only credential", async () => {
    const { controller, emailChangeRevertService } = createController();

    const response = await invoke(
      controller.revertEmailChange,
      createContext({ body: { token: "  revert-token  " } }),
    );

    expect(mockRequireSessionAuth).not.toHaveBeenCalled();
    expect(mockRequireRecentMfaVerification).not.toHaveBeenCalled();
    expect(emailChangeRevertService.revert).toHaveBeenCalledWith(
      "revert-token",
      expect.any(Object),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { reverted: true, nextStep: "reset_password" },
    });
  });

  it.each([
    ["a missing token", {}],
    ["a blank token", { token: "   " }],
    ["an oversized token", { token: "x".repeat(257) }],
    ["an unexpected field", { token: "revert-token", extra: true }],
  ])("rejects %s", async (_label, body) => {
    const { controller, emailChangeRevertService } = createController();

    await expect(
      invoke(controller.revertEmailChange, createContext({ body })),
    ).rejects.toThrow();
    expect(emailChangeRevertService.revert).not.toHaveBeenCalled();
  });
});

describe("EmailChangeController.requestEmailChange", () => {
  it("demands a recent step-up for the mfa-management scope", async () => {
    const { controller } = createController();

    await invoke(
      controller.requestEmailChange,
      createContext({ body: { email: "Owner-One-New@Rentify.local" } }),
    );

    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "mfa-management",
    );
  });

  it("lower-cases the address and accepts the request", async () => {
    const { controller, emailChangeService } = createController();

    const response = await invoke(
      controller.requestEmailChange,
      createContext({ body: { email: "Owner-One-New@Rentify.local" } }),
    );

    expect(emailChangeService.requestChange).toHaveBeenCalledWith(
      expect.objectContaining({ newEmail: "owner-one-new@rentify.local" }),
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      message: "Verification code sent to the new email address.",
    });
  });

  it("does not reach the service when the step-up is missing", async () => {
    const { controller, emailChangeService } = createController();
    mockRequireRecentMfaVerification.mockRejectedValue(
      new Error("Recent MFA verification is required."),
    );

    await expect(
      invoke(
        controller.requestEmailChange,
        createContext({ body: { email: "owner-one-new@rentify.local" } }),
      ),
    ).rejects.toThrow("Recent MFA verification is required.");
    expect(emailChangeService.requestChange).not.toHaveBeenCalled();
  });

  it("rejects a malformed address before the service sees it", async () => {
    const { controller, emailChangeService } = createController();

    await expect(
      invoke(
        controller.requestEmailChange,
        createContext({ body: { email: "not-an-address" } }),
      ),
    ).rejects.toThrow();
    expect(emailChangeService.requestChange).not.toHaveBeenCalled();
  });
});

describe("EmailChangeController.confirmEmailChange", () => {
  /**
   * The write invalidates the caller's own MFA proof, so requiring one here
   * would only strand users holding a valid code. Asserted rather than assumed
   * so a future refactor cannot quietly reintroduce the gate.
   */
  it("takes session auth alone, not a step-up", async () => {
    const { controller } = createController();

    await invoke(
      controller.confirmEmailChange,
      createContext({ body: { code: "123456" } }),
    );

    expect(mockRequireSessionAuth).toHaveBeenCalled();
    expect(mockRequireRecentMfaVerification).not.toHaveBeenCalled();
  });

  it("returns a refreshed session carrying the new address", async () => {
    const { controller, emailChangeService } = createController();

    const response = await invoke(
      controller.confirmEmailChange,
      createContext({ body: { code: "123456" } }),
    );

    expect(emailChangeService.confirmChange).toHaveBeenCalledWith(
      expect.objectContaining({ code: "123456" }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Email address changed successfully.",
      data: { accessToken: "access-token-1" },
    });
  });

  it("rejects a code that is not six digits", async () => {
    const { controller, emailChangeService } = createController();

    await expect(
      invoke(
        controller.confirmEmailChange,
        createContext({ body: { code: "12345" } }),
      ),
    ).rejects.toThrow();
    expect(emailChangeService.confirmChange).not.toHaveBeenCalled();
  });
});

describe("EmailChangeController pending-state handlers", () => {
  it("re-sends without demanding a step-up", async () => {
    const { controller, emailChangeService } = createController();

    const response = await invoke(
      controller.resendEmailChangeCode,
      createContext(),
    );

    expect(emailChangeService.resendCode).toHaveBeenCalled();
    expect(mockRequireRecentMfaVerification).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
  });

  it("reports the pending state", async () => {
    const { controller, emailChangeService } = createController();
    emailChangeService.readPending.mockResolvedValue({
      pending: true,
      newEmail: "o***@rentify.local",
      expiresInSeconds: 540,
    } as never);

    const response = await invoke(
      controller.getPendingEmailChange,
      createContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { pending: true, newEmail: "o***@rentify.local" },
    });
  });

  it("cancels with no content", async () => {
    const { controller, emailChangeService } = createController();

    const response = await invoke(
      controller.cancelEmailChange,
      createContext(),
    );

    expect(emailChangeService.cancelChange).toHaveBeenCalled();
    expect(response.status).toBe(204);
  });

  it("previews the pending code", async () => {
    const { controller } = createController();

    const response = await invoke(
      controller.previewPendingEmailChangeOtp,
      createContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { code: "123456" },
    });
  });

  it("has nothing to preview when no change is in flight", async () => {
    const { controller, emailChangeService } = createController();
    emailChangeService.previewPendingCode.mockResolvedValue(null as never);

    await expect(
      invoke(controller.previewPendingEmailChangeOtp, createContext()),
    ).rejects.toThrow("No email change code is available.");
  });
});
