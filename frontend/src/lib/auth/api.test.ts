import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthResponseBody } from "@/lib/auth/types";

const getDeviceIdMock = vi.fn();
const getDevicePlatformMock = vi.fn();
const readStoredSessionMock = vi.fn();
const writeStoredSessionMock = vi.fn();
const clearStoredSessionMock = vi.fn();

vi.mock("@/lib/auth/device", () => ({
  getDeviceId: getDeviceIdMock,
  getDevicePlatform: getDevicePlatformMock,
}));

vi.mock("@/lib/auth/storage", () => ({
  readStoredSession: readStoredSessionMock,
  writeStoredSession: writeStoredSessionMock,
  clearStoredSession: clearStoredSessionMock,
}));

const sampleSession: AuthResponseBody = {
  accessToken: "new-access-token",
  refreshToken: "new-refresh-token",
  device: {
    deviceId: "device-1",
    known: true,
    knownByIp: false,
  },
  user: {
    id: "user-1",
    email: "person@example.com",
    username: "person",
    role: "user",
  },
};

describe("authApi", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    getDeviceIdMock.mockReturnValue("device-1");
    getDevicePlatformMock.mockReturnValue("web");
    readStoredSessionMock.mockReturnValue({
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      device: {
        deviceId: "device-1",
        known: true,
        knownByIp: false,
      },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "user",
      },
    });
    document.cookie = "csrf_token=test-csrf-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends login requests with device headers and payload", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: sampleSession,
            error: null,
            meta: {
              requestId: "request-1",
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { authApi } = await import("./api");
    const result = await authApi.login({
      username: "person",
      password: "secret",
      captchaToken: "captcha-token",
    });

    expect(result).toEqual(sampleSession);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/auth/local/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "content-type": "application/json",
          accept: "application/json",
          "x-device-id": "device-1",
          "x-device-platform": "web",
        }),
        body: JSON.stringify({
          username: "person",
          password: "secret",
          captchaToken: "captcha-token",
          deviceId: "device-1",
        }),
      }),
    );
  });

  it("includes authorization and CSRF headers on authenticated writes", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              revoked: true,
              tokenId: "token-1",
            },
            error: null,
            meta: {
              requestId: "request-2",
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { authApi } = await import("./api");
    await authApi.revokePersonalAccessToken("token-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/auth/personal-access-tokens/token-1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          authorization: "Bearer old-access-token",
          "x-csrf-token": "test-csrf-token",
          "x-device-id": "device-1",
          "x-device-platform": "web",
        }),
      }),
    );
  });

  it("refreshes the stored session once and retries 401 responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            message: "Unauthorized.",
            data: null,
            error: {
              code: "UNAUTHORIZED",
            },
            meta: {
              requestId: "request-3",
            },
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: sampleSession,
            error: null,
            meta: {
              requestId: "request-4",
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              tokens: [],
            },
            error: null,
            meta: {
              requestId: "request-5",
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { authApi } = await import("./api");
    const result = await authApi.listPersonalAccessTokens();

    expect(result).toEqual({
      tokens: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:8040/api/v1/auth/refresh",
    );
    expect(writeStoredSessionMock).toHaveBeenCalledWith(sampleSession);
  });

  it("clears the stored session when refresh fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            message: "Unauthorized.",
            data: null,
            error: {
              code: "UNAUTHORIZED",
            },
            meta: {
              requestId: "request-6",
            },
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            message: "Refresh failed.",
            data: null,
            error: {
              code: "REFRESH_FAILED",
            },
            meta: {
              requestId: "request-7",
            },
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { authApi } = await import("./api");

    await expect(authApi.listPersonalAccessTokens()).rejects.toMatchObject({
      message: "Unauthorized.",
      code: "UNAUTHORIZED",
      status: 401,
    });
    expect(clearStoredSessionMock).toHaveBeenCalledTimes(1);
  });
});
