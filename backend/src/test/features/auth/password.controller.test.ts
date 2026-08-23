import type { CaptchaService } from "@/features/auth/captcha/captcha.service";
import type { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import type { PasswordService } from "@/features/auth/password/password.service";
import { PasswordController } from "@/features/auth/password/password.controller";
import {
  createClaims,
  createContext,
  createSessionResult,
  invoke,
  type AuthTestContext,
} from "../../support/auth-controller-harness";

const mockRequireRecentMfaVerification = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: jest.fn(),
  getOptionalJwtAuth: jest.fn(),
}));

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecentMfaVerification(...args),
}));

function createController() {
  const passwordService = {
    forgotPassword: jest.fn(async () => ({ accepted: true })),
    resendForgotPassword: jest.fn(async () => ({ accepted: true })),
    resetPassword: jest.fn(async () => createSessionResult()),
    changePassword: jest.fn(async () => createSessionResult()),
    setPassword: jest.fn(async () => createSessionResult()),
  };
  const captchaService = { verify: jest.fn(async () => ({ success: true })) };
  const mfaVerificationService = {} as MfaVerificationService;

  return {
    passwordService,
    captchaService,
    controller: new PasswordController(
      passwordService as unknown as PasswordService,
      captchaService as unknown as CaptchaService,
      mfaVerificationService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireRecentMfaVerification.mockResolvedValue(undefined);
});

describe("PasswordController recovery handlers", () => {
  it("verifies the captcha, then maps the forgot-password body", async () => {
    const { controller, passwordService, captchaService } = createController();

    const response = await invoke(
      controller.forgotPassword,
      createContext({
        body: { username: "Owner-One", captchaToken: "forgot-captcha" },
      }),
    );

    expect(captchaService.verify).toHaveBeenCalledWith(
      expect.objectContaining({ token: "forgot-captcha" }),
    );
    expect(passwordService.forgotPassword).toHaveBeenCalledWith({
      client: expect.any(Object),
      username: "owner-one",
      deviceId: "device-1",
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      message: "Password reset instructions have been accepted.",
    });
  });

  it("routes a resend to the resend service method", async () => {
    const { controller, passwordService } = createController();

    const response = await invoke(
      controller.resendForgotPassword,
      createContext({
        body: { username: "owner-one", captchaToken: "resend-captcha" },
      }),
    );

    expect(passwordService.resendForgotPassword).toHaveBeenCalled();
    expect(passwordService.forgotPassword).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      message: "Password reset instructions have been re-sent.",
    });
  });

  it("does not reach the service when the captcha fails", async () => {
    const { controller, passwordService, captchaService } = createController();
    captchaService.verify.mockResolvedValue({ success: false } as never);

    await expect(
      invoke(
        controller.forgotPassword,
        createContext({
          body: { username: "owner-one", captchaToken: "bad" },
        }),
      ),
    ).rejects.toThrow("Captcha verification failed.");
    expect(passwordService.forgotPassword).not.toHaveBeenCalled();
  });

  it("resets the password and returns a fresh session without a captcha", async () => {
    const { controller, passwordService, captchaService } = createController();

    const response = await invoke(
      controller.resetPassword,
      createContext({
        body: {
          username: "owner-one",
          code: "123456",
          newPassword: "ResetPassword1!",
          deviceId: "reset-device",
        },
      }),
    );

    // The emailed code is the proof here, so no captcha is required.
    expect(captchaService.verify).not.toHaveBeenCalled();
    expect(passwordService.resetPassword).toHaveBeenCalledWith({
      client: expect.any(Object),
      username: "owner-one",
      code: "123456",
      newPassword: "ResetPassword1!",
      deviceId: "reset-device",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Password reset successfully.",
    });
  });

  it("rejects a weak new password before reaching the service", async () => {
    const { controller, passwordService } = createController();

    await expect(
      invoke(
        controller.resetPassword,
        createContext({
          body: { username: "owner-one", code: "123456", newPassword: "weak" },
        }),
      ),
    ).rejects.toThrow();
    expect(passwordService.resetPassword).not.toHaveBeenCalled();
  });
});

describe("PasswordController.changePassword", () => {
  it("steps up first, then prefers the session device id", async () => {
    const auth = createClaims({ sub: "user-9", deviceId: "auth-device" });
    mockRequireRecentMfaVerification.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, passwordService } = createController();

    const response = await invoke(
      controller.changePassword,
      createContext({
        body: {
          currentPassword: "CurrentPassword1!",
          newPassword: "NextPassword1!",
        },
      }),
    );

    expect(mockRequireRecentMfaVerification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "mfa-management",
    );
    expect(passwordService.changePassword).toHaveBeenCalledWith({
      userId: "user-9",
      client: expect.any(Object),
      currentPassword: "CurrentPassword1!",
      newPassword: "NextPassword1!",
      deviceId: "auth-device",
    });
    await expect(response.json()).resolves.toMatchObject({
      message: "Password changed successfully.",
    });
  });

  it("does not change anything when the step-up fails", async () => {
    mockRequireRecentMfaVerification.mockRejectedValue(
      new Error("step-up required"),
    );
    const { controller, passwordService } = createController();

    await expect(
      invoke(
        controller.changePassword,
        createContext({
          body: {
            currentPassword: "CurrentPassword1!",
            newPassword: "NextPassword1!",
          },
        }),
      ),
    ).rejects.toThrow("step-up required");
    expect(passwordService.changePassword).not.toHaveBeenCalled();
  });
});

describe("PasswordController.setPassword", () => {
  it("steps up first and sends no current password", async () => {
    const auth = createClaims({ sub: "user-9", deviceId: "auth-device" });
    mockRequireRecentMfaVerification.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, passwordService } = createController();

    const response = await invoke(
      controller.setPassword,
      createContext({ body: { newPassword: "FirstPassword1!" } }),
    );

    expect(passwordService.setPassword).toHaveBeenCalledWith({
      userId: "user-9",
      client: expect.any(Object),
      newPassword: "FirstPassword1!",
      deviceId: "auth-device",
    });
    await expect(response.json()).resolves.toMatchObject({
      message: "Password set successfully.",
    });
  });

  it("requires a recent MFA verification", async () => {
    mockRequireRecentMfaVerification.mockRejectedValue(
      new Error("step-up required"),
    );
    const { controller, passwordService } = createController();

    await expect(
      invoke(
        controller.setPassword,
        createContext({ body: { newPassword: "FirstPassword1!" } }),
      ),
    ).rejects.toThrow("step-up required");
    expect(passwordService.setPassword).not.toHaveBeenCalled();
  });
});
