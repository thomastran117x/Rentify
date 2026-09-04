import type { AuthSessionService } from "@/features/auth/session/session.service";
import { AuthSessionController } from "@/features/auth/session/session.controller";
import {
  createClaims,
  createContext,
  createSessionResult,
  invoke,
  type AuthTestContext,
} from "../../support/auth-controller-harness";
import { testUuid } from "../../support/uuid";

const USER_3_ID = testUuid(9000, 994259);

const mockRequireJwtAuth = jest.fn();
const mockReadCookie = jest.fn();
const mockWriteCookie = jest.fn();
const mockClearCookie = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
  getOptionalJwtAuth: jest.fn(),
}));

// Partial: the controller and the response helpers also read getQuery and
// getRequestUrl from this module, so only the cookie accessors are stubbed.
jest.mock("@/configuration/http/request", () => ({
  ...jest.requireActual("@/configuration/http/request"),
  readCookie: (...args: unknown[]) => mockReadCookie(...args),
  writeCookie: (...args: unknown[]) => mockWriteCookie(...args),
  clearCookie: (...args: unknown[]) => mockClearCookie(...args),
}));

function createController() {
  const authSessionService = {
    localVerify: jest.fn(async () => ({
      verified: true,
      auth: { userId: "user-1", deviceId: "device-1", role: "user" },
      client: {},
    })),
    refresh: jest.fn(async () => createSessionResult()),
    logout: jest.fn(async () => ({
      loggedOut: true,
      auth: { userId: "user-1", deviceId: "device-1" },
      client: {},
    })),
  };

  return {
    authSessionService,
    controller: new AuthSessionController(
      authSessionService as unknown as AuthSessionService,
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireJwtAuth.mockResolvedValue(createClaims());
  mockReadCookie.mockReturnValue(undefined);
});

describe("AuthSessionController.localVerify", () => {
  it("authenticates first, then passes the principal and client through", async () => {
    const auth = createClaims({ sub: USER_3_ID });
    mockRequireJwtAuth.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    const { controller, authSessionService } = createController();
    const context = createContext();

    const response = await invoke(controller.localVerify, context);

    expect(mockRequireJwtAuth).toHaveBeenCalled();
    expect(authSessionService.localVerify).toHaveBeenCalledWith({
      auth,
      client: context.get("client"),
    });
    expect(response.status).toBe(200);
  });

  it("does not call the service when authentication fails", async () => {
    mockRequireJwtAuth.mockRejectedValue(new Error("no token"));
    const { controller, authSessionService } = createController();

    await expect(
      invoke(controller.localVerify, createContext()),
    ).rejects.toThrow("no token");
    expect(authSessionService.localVerify).not.toHaveBeenCalled();
  });
});

describe("AuthSessionController.refresh", () => {
  it("prefers a refresh token supplied in the body", async () => {
    const { controller, authSessionService } = createController();

    await invoke(
      controller.refresh,
      createContext({ body: { refreshToken: "body-token" } }),
    );

    expect(authSessionService.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "body-token" }),
    );
  });

  it("falls back to the refresh cookie", async () => {
    mockReadCookie.mockReturnValue("cookie-token");
    const { controller, authSessionService } = createController();

    await invoke(controller.refresh, createContext({ body: {} }));

    expect(mockReadCookie).toHaveBeenCalledWith(
      expect.anything(),
      "refresh_token",
    );
    expect(authSessionService.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "cookie-token" }),
    );
  });

  it("returns the refresh token in the body for an API caller", async () => {
    const { controller } = createController();

    const response = await invoke(
      controller.refresh,
      createContext({ body: { refreshToken: "body-token" } }),
    );

    await expect(response.json()).resolves.toMatchObject({
      message: "Session refreshed successfully.",
      data: { refreshToken: "refresh-token-1" },
    });
    expect(mockWriteCookie).not.toHaveBeenCalled();
  });

  it("sets cookies and withholds the refresh token for a browser caller", async () => {
    const { controller } = createController();

    const response = await invoke(
      controller.refresh,
      createContext({
        body: { refreshToken: "body-token" },
        headers: { origin: "https://rent.test" },
      }),
    );

    expect(mockWriteCookie).toHaveBeenCalledWith(
      expect.anything(),
      "refresh_token",
      "refresh-token-1",
      expect.objectContaining({ httpOnly: true }),
    );
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data.refreshToken).toBeUndefined();
  });

  it("does not require authentication", async () => {
    const { controller } = createController();

    await invoke(controller.refresh, createContext({ body: {} }));

    expect(mockRequireJwtAuth).not.toHaveBeenCalled();
  });
});

describe("AuthSessionController.logout", () => {
  it("authenticates, forwards the refresh cookie, and clears both cookies", async () => {
    const auth = createClaims({ sub: USER_3_ID, sessionId: "session-1" });
    mockRequireJwtAuth.mockImplementation(
      async (request: AuthTestContext["request"]) => {
        request.auth = auth;
        return auth;
      },
    );
    mockReadCookie.mockReturnValue("cookie-refresh-token");
    const { controller, authSessionService } = createController();

    const response = await invoke(controller.logout, createContext());

    expect(authSessionService.logout).toHaveBeenCalledWith({
      auth,
      client: expect.any(Object),
      refreshToken: "cookie-refresh-token",
    });
    expect(mockClearCookie).toHaveBeenCalledWith(
      expect.anything(),
      "refresh_token",
      expect.objectContaining({ httpOnly: true }),
    );
    expect(mockClearCookie).toHaveBeenCalledWith(
      expect.anything(),
      "csrf_token",
      expect.any(Object),
    );
    await expect(response.json()).resolves.toMatchObject({
      message: "Logged out successfully.",
    });
  });

  it("does not clear cookies when authentication fails", async () => {
    mockRequireJwtAuth.mockRejectedValue(new Error("no token"));
    const { controller } = createController();

    await expect(invoke(controller.logout, createContext())).rejects.toThrow(
      "no token",
    );
    expect(mockClearCookie).not.toHaveBeenCalled();
  });
});
