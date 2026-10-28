import { RequestValidationError } from "@/configuration/validation/request";
import { LoginMfaController } from "@/features/auth/mfa/login/login-mfa.controller";
import type { LoginMfaService } from "@/features/auth/mfa/login/login-mfa.service";
import {
  createContext,
  createSessionResult,
  invoke,
} from "../../../support/auth-controller-harness";

const mockSetCookie = jest.fn();

jest.mock("@/configuration/http/request", () => ({
  ...jest.requireActual("@/configuration/http/request"),
  writeCookie: (...args: unknown[]) => mockSetCookie(...args),
}));

function createController() {
  const loginMfaService = {
    completeLoginMfa: jest.fn(async () => createSessionResult()),
  };

  return {
    loginMfaService,
    controller: new LoginMfaController(
      loginMfaService as unknown as LoginMfaService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("LoginMfaController.completeLoginMfa", () => {
  it("maps the body, falling back to the client device, and writes the session", async () => {
    const { controller, loginMfaService } = createController();
    const context = createContext({
      body: {
        mfaChallengeToken: " challenge-token ",
        factor: "totp",
        code: " 123456 ",
      },
      headers: { origin: "http://localhost:3040" },
    });

    const response = await invoke(controller.completeLoginMfa, context);

    expect(loginMfaService.completeLoginMfa).toHaveBeenCalledWith({
      client: context.get("client"),
      mfaChallengeToken: "challenge-token",
      factor: "totp",
      code: "123456",
      deviceId: "device-1",
      audit: expect.objectContaining({ deviceId: "device-1" }),
    });
    expect(response.status).toBe(200);
    expect(mockSetCookie).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      message: "Authenticated successfully.",
      data: { accessToken: "access-token-1" },
    });
  });

  it("prefers the device id in the body", async () => {
    const { controller, loginMfaService } = createController();

    await invoke(
      controller.completeLoginMfa,
      createContext({
        body: {
          mfaChallengeToken: "challenge-token",
          factor: "totp",
          code: "123456",
          deviceId: "browser-device",
        },
      }),
    );

    expect(loginMfaService.completeLoginMfa).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "browser-device" }),
    );
  });

  it.each([
    [
      "an unsupported factor",
      { mfaChallengeToken: "challenge-token", factor: "sms", code: "123456" },
    ],
    [
      "a missing code",
      { mfaChallengeToken: "challenge-token", factor: "totp", code: "  " },
    ],
    ["a missing token", { mfaChallengeToken: "", factor: "totp", code: "1" }],
  ])("rejects %s before calling the service", async (_case, body) => {
    const { controller, loginMfaService } = createController();

    await expect(
      invoke(controller.completeLoginMfa, createContext({ body })),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(loginMfaService.completeLoginMfa).not.toHaveBeenCalled();
  });
});
