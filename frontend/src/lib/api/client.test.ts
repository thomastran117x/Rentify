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
    if (typeof document !== "undefined") {
      document.cookie = "csrf_token=client-csrf-token";
    }
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

  it("maps 4xx responses to ApiClientError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              message: "Validation failed.",
              data: null,
              error: {
                code: "VALIDATION_ERROR",
                details: {
                  email: "invalid",
                },
              },
              meta: {
                requestId: "request-6a",
              },
            }),
            {
              status: 422,
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      ),
    );

    const { publicJson } = await import("./client");

    await expect(publicJson("GET", "/profiles")).rejects.toMatchObject({
      name: "ApiClientError",
      message: "Validation failed.",
      code: "VALIDATION_ERROR",
      status: 422,
      request: {
        method: "GET",
        path: "/profiles",
        requestUrl: "http://localhost:8040/api/v1/profiles",
      },
    });
  });

  it("maps 5xx responses to ApiServerError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              message: "Server exploded.",
              data: null,
              error: {
                code: "INTERNAL_SERVER_ERROR",
              },
              meta: {
                requestId: "request-6b",
              },
            }),
            {
              status: 500,
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      ),
    );

    const { publicJson } = await import("./client");

    await expect(publicJson("GET", "/health")).rejects.toMatchObject({
      name: "ApiServerError",
      message: "Server exploded.",
      code: "INTERNAL_SERVER_ERROR",
      status: 500,
    });
  });

  it("maps fetch rejections to ApiNetworkError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const { publicJson } = await import("./client");

    await expect(publicJson("GET", "/health")).rejects.toMatchObject({
      name: "ApiNetworkError",
      message: "Unable to reach the server.",
      code: "NETWORK_ERROR",
      request: {
        method: "GET",
        path: "/health",
        requestUrl: "http://localhost:8040/api/v1/health",
      },
    });
  });

  it("maps malformed success envelopes to ApiProtocolError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              message: "ok",
              meta: {
                requestId: "request-6c",
              },
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      ),
    );

    const { publicJson } = await import("./client");

    await expect(publicJson("GET", "/health")).rejects.toMatchObject({
      name: "ApiProtocolError",
      message: "API response payload did not include a valid data envelope.",
      code: "INVALID_API_RESPONSE",
      request: {
        method: "GET",
        path: "/health",
      },
    });
  });

  it("does not reclassify abort errors", async () => {
    const abortError = new DOMException(
      "The operation was aborted.",
      "AbortError",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw abortError;
      }),
    );

    const { publicJson } = await import("./client");

    await expect(
      publicJson("GET", "/health", undefined, undefined, new AbortController().signal),
    ).rejects.toBe(abortError);
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

  it("includes the CSRF header for public auth requests", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              ok: true,
            },
            error: null,
            meta: {
              requestId: "request-6",
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

    const { publicJson } = await import("./client");
    await publicJson<{ ok: true }, { email: string }>(
      "POST",
      "/auth/local/login",
      {
        email: "owner1@rentify.local",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/auth/local/login",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "client-csrf-token",
        }),
      }),
    );
  });

  it("sends public requests safely during server rendering", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/auth/device");
    vi.doUnmock("@/lib/auth/storage");

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              ok: true,
            },
            error: null,
            meta: {
              requestId: "request-7",
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

    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalNavigator = globalThis.navigator;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: undefined,
    });

    try {
      const { publicJson } = await import("./client");
      const result = await publicJson<{ ok: true }>("GET", "/postings");

      expect(result).toEqual({
        ok: true,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8040/api/v1/postings",
        expect.objectContaining({
          headers: {
            accept: "application/json",
          },
        }),
      );
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
      });
    }
  });
});
