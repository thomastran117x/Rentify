import type { Request, Response } from "express";
import {
  clearCookie,
  getHeader,
  getPathname,
  getQuery,
  getRequestUrl,
  readCookie,
  writeCookie,
} from "@/configuration/http/request";

interface FakeRequestInput {
  originalUrl?: string;
  protocol?: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
}

function fakeRequest(input: FakeRequestInput = {}): Request {
  const headers = input.headers ?? {};

  return {
    originalUrl: input.originalUrl ?? "/",
    protocol: input.protocol ?? "http",
    headers,
    query: input.query ?? {},
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function fakeResponse(): {
  response: Response;
  cookies: Array<[string, string, Record<string, unknown>]>;
  cleared: Array<[string, Record<string, unknown>]>;
} {
  const cookies: Array<[string, string, Record<string, unknown>]> = [];
  const cleared: Array<[string, Record<string, unknown>]> = [];

  const response = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      cookies.push([name, value, options]);
    },
    clearCookie: (name: string, options: Record<string, unknown>) => {
      cleared.push([name, options]);
    },
  } as unknown as Response;

  return { response, cookies, cleared };
}

describe("getRequestUrl", () => {
  it("rebuilds an absolute url from the host header and original url", () => {
    const url = getRequestUrl(
      fakeRequest({
        originalUrl: "/api/v1/postings?page=2",
        headers: { host: "rent.test:8040" },
      }),
    );

    expect(url.origin).toBe("http://rent.test:8040");
    expect(url.pathname).toBe("/api/v1/postings");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("honours the request protocol", () => {
    const url = getRequestUrl(
      fakeRequest({
        originalUrl: "/health",
        protocol: "https",
        headers: { host: "rent.test" },
      }),
    );

    expect(url.origin).toBe("https://rent.test");
  });

  it("falls back to a valid origin when the host header is missing", () => {
    const url = getRequestUrl(fakeRequest({ originalUrl: "/health" }));

    expect(url.origin).toBe("http://localhost");
    expect(url.pathname).toBe("/health");
  });

  it("falls back to a valid origin when the host header is malformed", () => {
    const url = getRequestUrl(
      fakeRequest({
        originalUrl: "/health",
        headers: { host: "not a host" },
      }),
    );

    expect(url.origin).toBe("http://localhost");
    expect(url.pathname).toBe("/health");
  });

  it("preserves repeated query parameters", () => {
    const url = getRequestUrl(
      fakeRequest({
        originalUrl: "/api/v1/postings?tag=a&tag=b",
        headers: { host: "rent.test" },
      }),
    );

    expect(url.searchParams.getAll("tag")).toEqual(["a", "b"]);
  });
});

describe("getPathname", () => {
  it("keeps the mount prefix that req.path would strip", () => {
    expect(
      getPathname(fakeRequest({ originalUrl: "/api/v1/postings/42?x=1" })),
    ).toBe("/api/v1/postings/42");
  });

  it("returns the path unchanged when there is no query string", () => {
    expect(getPathname(fakeRequest({ originalUrl: "/api/v1/health" }))).toBe(
      "/api/v1/health",
    );
  });

  it("returns a root path for an empty original url", () => {
    expect(getPathname(fakeRequest({ originalUrl: "" }))).toBe("/");
  });
});

describe("getQuery", () => {
  it("returns single-valued parameters as strings", () => {
    expect(
      getQuery(fakeRequest({ query: { page: "2", sort: "asc" } })),
    ).toEqual({ page: "2", sort: "asc" });
  });

  it("keeps only the first value of a repeated parameter", () => {
    expect(getQuery(fakeRequest({ query: { tag: ["a", "b"] } }))).toEqual({
      tag: "a",
    });
  });

  it("drops nested and empty values it cannot flatten", () => {
    expect(
      getQuery(
        fakeRequest({
          query: { nested: { a: "1" }, empty: [], page: "1" },
        }),
      ),
    ).toEqual({ page: "1" });
  });
});

describe("getHeader", () => {
  it("reads a header case-insensitively", () => {
    const request = fakeRequest({ headers: { "x-request-id": "req-1" } });

    expect(getHeader(request, "X-Request-Id")).toBe("req-1");
  });

  it("returns undefined for a missing header", () => {
    expect(getHeader(fakeRequest(), "x-missing")).toBeUndefined();
  });
});

describe("readCookie", () => {
  it("reads a cookie from the raw cookie header", () => {
    const request = fakeRequest({
      headers: { cookie: "refresh_token=abc; csrf_token=xyz" },
    });

    expect(readCookie(request, "refresh_token")).toBe("abc");
    expect(readCookie(request, "csrf_token")).toBe("xyz");
  });

  it("returns undefined when the cookie header is absent", () => {
    expect(readCookie(fakeRequest(), "refresh_token")).toBeUndefined();
  });

  it("returns undefined when the named cookie is absent", () => {
    const request = fakeRequest({ headers: { cookie: "other=1" } });

    expect(readCookie(request, "refresh_token")).toBeUndefined();
  });

  it("decodes percent-encoded values", () => {
    const request = fakeRequest({ headers: { cookie: "token=a%20b" } });

    expect(readCookie(request, "token")).toBe("a b");
  });
});

describe("writeCookie", () => {
  it("converts maxAge from seconds to milliseconds", () => {
    const { response, cookies } = fakeResponse();

    writeCookie(response, "refresh_token", "abc", {
      maxAge: 900,
      httpOnly: true,
      path: "/",
      sameSite: "Lax",
      secure: true,
    });

    expect(cookies).toEqual([
      [
        "refresh_token",
        "abc",
        {
          maxAge: 900_000,
          httpOnly: true,
          path: "/",
          // Normalised for Express; the serialised header is still SameSite=Lax.
          sameSite: "lax",
          secure: true,
        },
      ],
    ]);
  });

  it("omits maxAge entirely when it was not provided", () => {
    const { response, cookies } = fakeResponse();

    writeCookie(response, "csrf_token", "xyz", { path: "/" });

    expect(cookies[0][2]).toEqual({ path: "/" });
    expect(cookies[0][2]).not.toHaveProperty("maxAge");
  });

  it("treats a zero maxAge as an immediate expiry rather than as absent", () => {
    const { response, cookies } = fakeResponse();

    writeCookie(response, "csrf_token", "xyz", { maxAge: 0 });

    expect(cookies[0][2]).toEqual({ maxAge: 0 });
  });
});

describe("clearCookie", () => {
  it("forwards the matching cookie attributes", () => {
    const { response, cleared } = fakeResponse();

    clearCookie(response, "refresh_token", {
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });

    expect(cleared).toEqual([
      [
        "refresh_token",
        { path: "/", httpOnly: true, secure: false, sameSite: "lax" },
      ],
    ]);
  });

  it("leaves sameSite absent when it was not provided", () => {
    const { response, cleared } = fakeResponse();

    clearCookie(response, "refresh_token", { path: "/" });

    expect(cleared[0][1]).toEqual({ path: "/" });
  });
});
