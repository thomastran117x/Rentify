import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("api client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    getDeviceIdMock.mockReturnValue("device-1");
    getDevicePlatformMock.mockReturnValue("web");
    readStoredSessionMock.mockReturnValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      device: {
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
    document.cookie = "csrf_token=client-csrf-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds repeated query params for arrays", async () => {
    const { buildPathWithQuery } = await import("./client");

    expect(
      buildPathWithQuery("/postings", {
        ids: ["posting-1", "posting-2"],
        page: 2,
        empty: undefined,
      }),
    ).toBe("/postings?ids=posting-1&ids=posting-2&page=2");
  });

  it("sends authenticated requests and retries once after refresh", async () => {
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
              requestId: "request-1",
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
            data: {
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              ok: true,
            },
            error: null,
            meta: {
              requestId: "request-3",
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

    const { authenticatedJson } = await import("./client");
    const result = await authenticatedJson<{ ok: true }>("GET", "/secure");

    expect(result).toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:8040/api/v1/secure",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:8040/api/v1/auth/refresh",
    );
    expect(writeStoredSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "new-access-token",
      }),
    );
  });

  it("falls back to a public request when optional auth gets a 401", async () => {
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
              requestId: "request-4",
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
            data: {
              ok: true,
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

    const { optionalAuthJson } = await import("./client");
    const result = await optionalAuthJson<{ ok: true }>("GET", "/optional");

    expect(result).toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer access-token",
        }),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          authorization: "Bearer access-token",
        }),
      }),
    );
  });

  it("returns raw text payloads for text requests", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("openapi: 3.1.0", {
          status: 200,
          headers: {
            "content-type": "application/yaml",
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { textRequest } = await import("./client");
    const result = await textRequest("/openapi.yaml");

    expect(result).toBe("openapi: 3.1.0");
  });
});
