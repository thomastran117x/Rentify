import type { CaptchaService } from "@/features/auth/captcha/captcha.service";
import type { UsernameService } from "@/features/auth/username/username.service";
import { UsernameController } from "@/features/auth/username/username.controller";
import {
  createClaims,
  createContext,
  invoke,
} from "../../support/auth-controller-harness";
import { testUuid } from "../../support/uuid";

const USER_7_ID = testUuid(9000, 994263);

const mockGetOptionalJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: jest.fn(),
  getOptionalJwtAuth: (...args: unknown[]) => mockGetOptionalJwtAuth(...args),
}));

function createController() {
  const usernameService = {
    resolveUsernameAvailabilityHint: jest.fn(async () => ({
      username: "casey-doe",
      available: true,
      reason: null,
    })),
    forgotUsername: jest.fn(async () => ({ accepted: true })),
  };
  const captchaService = {
    verify: jest.fn(async () => ({ success: true })),
  };

  return {
    usernameService,
    captchaService,
    controller: new UsernameController(
      usernameService as unknown as UsernameService,
      captchaService as unknown as CaptchaService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOptionalJwtAuth.mockResolvedValue(undefined);
});

describe("UsernameController.checkUsernameAvailability", () => {
  it("normalizes the query and answers for an anonymous caller", async () => {
    const { controller, usernameService } = createController();

    const response = await invoke(
      controller.checkUsernameAvailability,
      createContext({
        url: "https://example.test/auth/username/available?username=Casey-Doe",
      }),
    );

    expect(
      usernameService.resolveUsernameAvailabilityHint,
    ).toHaveBeenCalledWith("casey-doe", undefined);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { username: "casey-doe", available: true },
    });
  });

  it("passes the signed-in caller's id so their own name reads as free", async () => {
    mockGetOptionalJwtAuth.mockResolvedValue(createClaims({ sub: USER_7_ID }));
    const { controller, usernameService } = createController();

    await invoke(
      controller.checkUsernameAvailability,
      createContext({
        url: "https://example.test/auth/username/available?username=casey-doe",
      }),
    );

    expect(
      usernameService.resolveUsernameAvailabilityHint,
    ).toHaveBeenCalledWith("casey-doe", USER_7_ID);
  });

  it("rejects a request with no username", async () => {
    const { controller, usernameService } = createController();

    await expect(
      invoke(
        controller.checkUsernameAvailability,
        createContext({ url: "https://example.test/auth/username/available" }),
      ),
    ).rejects.toMatchObject({ name: "RequestValidationError" });
    expect(
      usernameService.resolveUsernameAvailabilityHint,
    ).not.toHaveBeenCalled();
  });

  it("does not require a captcha", async () => {
    const { controller, captchaService } = createController();

    await invoke(
      controller.checkUsernameAvailability,
      createContext({
        url: "https://example.test/auth/username/available?username=casey-doe",
      }),
    );

    expect(captchaService.verify).not.toHaveBeenCalled();
  });
});

describe("UsernameController.forgotUsername", () => {
  it("verifies the captcha before mapping the body", async () => {
    const { controller, usernameService, captchaService } = createController();

    const response = await invoke(
      controller.forgotUsername,
      createContext({
        body: { email: "User@Example.com", captchaToken: "captcha-ok" },
      }),
    );

    expect(captchaService.verify).toHaveBeenCalledWith(
      expect.objectContaining({ token: "captcha-ok" }),
    );
    expect(usernameService.forgotUsername).toHaveBeenCalledWith(
      expect.objectContaining({ email: "user@example.com" }),
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      message: "Username reminder instructions have been accepted.",
    });
  });

  it("does not reach the service when the captcha fails", async () => {
    const { controller, usernameService, captchaService } = createController();
    captchaService.verify.mockResolvedValue({ success: false } as never);

    await expect(
      invoke(
        controller.forgotUsername,
        createContext({
          body: { email: "user@example.com", captchaToken: "captcha-bad" },
        }),
      ),
    ).rejects.toThrow("Captcha verification failed.");
    expect(usernameService.forgotUsername).not.toHaveBeenCalled();
  });

  it("rejects a body with no captcha token", async () => {
    const { controller, usernameService } = createController();

    await expect(
      invoke(
        controller.forgotUsername,
        createContext({ body: { email: "user@example.com" } }),
      ),
    ).rejects.toThrow();
    expect(usernameService.forgotUsername).not.toHaveBeenCalled();
  });
});
