import { RequestValidationError } from "@/configuration/validation/request";
import { PasskeyLoginController } from "@/features/auth/passkey-login/passkey-login.controller";
import type { PasskeyLoginService } from "@/features/auth/passkey-login/passkey-login.service";
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

const CREDENTIAL = {
  id: "Y3JlZA",
  rawId: "Y3JlZA",
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: "Y2Q",
    authenticatorData: "YWQ",
    signature: "c2ln",
    userHandle: "dXNlcg",
  },
};

function createController() {
  const passkeyLoginService = {
    beginOptions: jest.fn(async () => ({ options: { challenge: "c" } })),
    authenticate: jest.fn(async () => createSessionResult()),
  };

  return {
    passkeyLoginService,
    controller: new PasskeyLoginController(
      passkeyLoginService as unknown as PasskeyLoginService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PasskeyLoginController.beginOptions", () => {
  it.each([
    ["an empty body", {}],
    ["no body", undefined],
  ])("returns uncached options for %s", async (_case, body) => {
    const { controller, passkeyLoginService } = createController();
    const context = createContext(body === undefined ? {} : { body });

    const response = await invoke(controller.beginOptions, context);

    expect(passkeyLoginService.beginOptions).toHaveBeenCalledTimes(1);
    expect(context.recorder.headers()["cache-control"]).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      data: { options: { challenge: "c" } },
    });
  });

  it("refuses a body naming anyone", async () => {
    const { controller, passkeyLoginService } = createController();

    await expect(
      invoke(
        controller.beginOptions,
        createContext({ body: { username: "casey" } }),
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(passkeyLoginService.beginOptions).not.toHaveBeenCalled();
  });
});

describe("PasskeyLoginController.verify", () => {
  it("maps the assertion, falling back to the client device, and writes the session", async () => {
    const { controller, passkeyLoginService } = createController();
    const context = createContext({
      body: { credential: CREDENTIAL, rememberMe: true },
      headers: { origin: "http://localhost:3040" },
    });

    const response = await invoke(controller.verify, context);

    expect(passkeyLoginService.authenticate).toHaveBeenCalledWith({
      credential: CREDENTIAL,
      rememberMe: true,
      deviceId: "device-1",
      client: context.get("client"),
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
    const { controller, passkeyLoginService } = createController();

    await invoke(
      controller.verify,
      createContext({
        body: { credential: CREDENTIAL, deviceId: "browser-device" },
      }),
    );

    expect(passkeyLoginService.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "browser-device" }),
    );
  });

  it.each([
    ["a missing credential", {}],
    [
      "a credential that is not a public key",
      { credential: { ...CREDENTIAL, type: "password" } },
    ],
    [
      "a signature that is not base64url",
      {
        credential: {
          ...CREDENTIAL,
          response: { ...CREDENTIAL.response, signature: "not base64!" },
        },
      },
    ],
  ])("rejects %s before calling the service", async (_case, body) => {
    const { controller, passkeyLoginService } = createController();

    await expect(
      invoke(controller.verify, createContext({ body })),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(passkeyLoginService.authenticate).not.toHaveBeenCalled();
  });
});
