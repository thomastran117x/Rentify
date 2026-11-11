import { createTestContext, invoke } from "../../../support/mock-http";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { PasskeyController } from "@/features/auth/mfa/passkey/passkey.controller";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 465201);
const PASSKEY_ID = testUuid(9000, 465202);

const mockRequireRecent = jest.fn();

jest.mock("@/features/auth/mfa/verification/mfa-verification.guard", () => ({
  requireRecentMfaVerification: (...args: unknown[]) =>
    mockRequireRecent(...args),
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

const ACTOR = {
  userId: USER_ID,
  sessionId: "session-1",
  context: {
    ipAddress: "127.0.0.1",
    deviceId: "device-1",
    userAgent: "test-agent",
    requestId: "request-1",
  },
};

const SUMMARY = {
  id: PASSKEY_ID,
  name: "Laptop",
  createdAt: "2026-11-10T09:00:00.000Z",
  lastUsedAt: null,
  backedUp: false,
  deviceType: "single_device",
  transports: ["internal"],
};

const CREDENTIAL = {
  id: "Y3JlZA",
  rawId: "Y3JlZA",
  type: "public-key",
  clientExtensionResults: {},
  response: { clientDataJSON: "Y2Q", attestationObject: "YW8" },
};

function createContext(
  options: { body?: unknown; params?: Record<string, string> } = {},
) {
  return createTestContext({
    url: "https://example.test/auth/mfa/passkeys",
    body: options.body,
    params: options.params,
    state: {
      client: CLIENT,
      requestId: "request-1",
      container: { resolve: () => ({ inspectRequest: () => [] }) },
    },
  } as never);
}

function createController() {
  const service = {
    beginRegistration: jest.fn(async () => ({ options: { challenge: "c" } })),
    finishRegistration: jest.fn(async () => ({ passkey: SUMMARY })),
    list: jest.fn(async () => ({ passkeys: [SUMMARY] })),
    rename: jest.fn(async () => ({ ...SUMMARY, name: "Desk key" })),
    remove: jest.fn(async () => undefined),
  };
  const verification = {};

  return {
    service,
    verification,
    controller: new PasskeyController(service as never, verification as never),
  };
}

describe("PasskeyController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireRecent.mockResolvedValue(AUTH);
  });

  it("needs a management step-up for every route", async () => {
    mockRequireRecent.mockRejectedValue(new Error("step-up required"));
    const { controller, service, verification } = createController();

    for (const handler of [
      controller.beginRegistration,
      controller.finishRegistration,
      controller.list,
      controller.rename,
      controller.remove,
    ]) {
      await expect(
        invoke(handler, createContext({ params: { id: PASSKEY_ID } })),
      ).rejects.toThrow("step-up required");
    }

    expect(mockRequireRecent).toHaveBeenCalledWith(
      expect.anything(),
      verification,
      "mfa-management",
    );
    expect(
      Object.values(service).every((fn) => fn.mock.calls.length === 0),
    ).toBe(true);
  });

  it("refuses a principal without a session", async () => {
    mockRequireRecent.mockResolvedValue({ ...AUTH, sessionId: undefined });
    const { controller } = createController();

    await expect(invoke(controller.list, createContext())).rejects.toThrow(
      "Session is no longer valid.",
    );
  });

  it("starts a registration without caching the options", async () => {
    const { controller, service } = createController();

    const response = await invoke(
      controller.beginRegistration,
      createContext(),
    );

    expect(service.beginRegistration).toHaveBeenCalledWith(ACTOR);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      data: { options: { challenge: "c" } },
    });
  });

  it("finishes a registration with 201", async () => {
    const { controller, service } = createController();

    const response = await invoke(
      controller.finishRegistration,
      createContext({ body: { credential: CREDENTIAL, name: " Laptop " } }),
    );

    expect(service.finishRegistration).toHaveBeenCalledWith({
      ...ACTOR,
      credential: CREDENTIAL,
      name: "Laptop",
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      message: "Passkey added.",
      data: { passkey: SUMMARY },
    });
  });

  it("refuses a credential that is not base64url", async () => {
    const { controller, service } = createController();

    await expect(
      invoke(
        controller.finishRegistration,
        createContext({
          body: { credential: { ...CREDENTIAL, rawId: "not base64!" } },
        }),
      ),
    ).rejects.toThrow("Request body validation failed.");
    expect(service.finishRegistration).not.toHaveBeenCalled();
  });

  it("lists the passkeys", async () => {
    const { controller, service } = createController();

    const response = await invoke(controller.list, createContext());

    expect(service.list).toHaveBeenCalledWith(USER_ID);
    await expect(response.json()).resolves.toMatchObject({
      data: { passkeys: [SUMMARY] },
    });
  });

  it("renames a passkey by id", async () => {
    const { controller, service } = createController();

    const response = await invoke(
      controller.rename,
      createContext({ body: { name: "Desk key" }, params: { id: PASSKEY_ID } }),
    );

    expect(service.rename).toHaveBeenCalledWith({
      ...ACTOR,
      id: PASSKEY_ID,
      name: "Desk key",
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { passkey: { name: "Desk key" } },
    });
  });

  it("refuses a name with a line break", async () => {
    const { controller, service } = createController();

    await expect(
      invoke(
        controller.rename,
        createContext({
          body: { name: "Desk\nkey" },
          params: { id: PASSKEY_ID },
        }),
      ),
    ).rejects.toThrow("Request body validation failed.");
    expect(service.rename).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a UUID", async () => {
    const { controller, service } = createController();

    await expect(
      invoke(controller.remove, createContext({ params: { id: "nope" } })),
    ).rejects.toThrow("Route parameter validation failed.");
    expect(service.remove).not.toHaveBeenCalled();
  });

  it("removes a passkey with 204", async () => {
    const { controller, service } = createController();

    const response = await invoke(
      controller.remove,
      createContext({ params: { id: PASSKEY_ID } }),
    );

    expect(service.remove).toHaveBeenCalledWith({
      ...ACTOR,
      auth: AUTH,
      id: PASSKEY_ID,
    });
    expect(response.status).toBe(204);
  });
});
