import type { CaptchaService } from "@/features/auth/captcha/captcha.service";
import type { LoginLockoutService } from "@/features/auth/lockout/login-lockout.service";
import { LoginLockoutController } from "@/features/auth/lockout/login-lockout.controller";
import { createContext, invoke } from "../../support/auth-controller-harness";

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: jest.fn(),
  getOptionalJwtAuth: jest.fn(),
}));

function createController() {
  const loginLockoutService = {
    unlockLocalLogin: jest.fn(async () => ({
      unlocked: true,
      email: "user@example.com",
    })),
    resendUnlockLocalLogin: jest.fn(async () => ({ accepted: true })),
  };
  const captchaService = {
    verify: jest.fn(async () => ({ success: true })),
  };

  return {
    loginLockoutService,
    captchaService,
    controller: new LoginLockoutController(
      loginLockoutService as unknown as LoginLockoutService,
      captchaService as unknown as CaptchaService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("LoginLockoutController.unlockLocalLogin", () => {
  it("lowercases the email and forwards the code", async () => {
    const { controller, loginLockoutService } = createController();

    const response = await invoke(
      controller.unlockLocalLogin,
      createContext({
        body: { email: "User@Example.com", code: "123456" },
      }),
    );

    expect(loginLockoutService.unlockLocalLogin).toHaveBeenCalledWith({
      email: "user@example.com",
      code: "123456",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "Local login unlocked successfully.",
    });
  });

  it("does not require a captcha, since the code is the proof", async () => {
    const { controller, captchaService } = createController();

    await invoke(
      controller.unlockLocalLogin,
      createContext({ body: { email: "user@example.com", code: "123456" } }),
    );

    expect(captchaService.verify).not.toHaveBeenCalled();
  });

  it("rejects a code that is not six digits", async () => {
    const { controller, loginLockoutService } = createController();

    await expect(
      invoke(
        controller.unlockLocalLogin,
        createContext({ body: { email: "user@example.com", code: "12" } }),
      ),
    ).rejects.toThrow();
    expect(loginLockoutService.unlockLocalLogin).not.toHaveBeenCalled();
  });
});

describe("LoginLockoutController.resendUnlockLocalLogin", () => {
  it("verifies the captcha, then accepts the request", async () => {
    const { controller, loginLockoutService, captchaService } =
      createController();

    const response = await invoke(
      controller.resendUnlockLocalLogin,
      createContext({
        body: { email: "User@Example.com", captchaToken: "captcha-ok" },
      }),
    );

    expect(captchaService.verify).toHaveBeenCalledWith(
      expect.objectContaining({ token: "captcha-ok" }),
    );
    expect(loginLockoutService.resendUnlockLocalLogin).toHaveBeenCalledWith(
      expect.objectContaining({ email: "user@example.com" }),
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      message: "Unlock email has been re-sent.",
    });
  });

  it("does not reach the service when the captcha fails", async () => {
    const { controller, loginLockoutService, captchaService } =
      createController();
    captchaService.verify.mockResolvedValue({ success: false } as never);

    await expect(
      invoke(
        controller.resendUnlockLocalLogin,
        createContext({
          body: { email: "user@example.com", captchaToken: "captcha-bad" },
        }),
      ),
    ).rejects.toThrow("Captcha verification failed.");
    expect(loginLockoutService.resendUnlockLocalLogin).not.toHaveBeenCalled();
  });
});
