import { environment } from "@/configuration/environment";
import {
  getSessionCookieNames,
  isSecureCookieEnabled,
  LEGACY_SESSION_COOKIE_NAMES,
  readCsrfTokenCookie,
  readRefreshTokenCookie,
  resolveSessionCookieNames,
  SECURE_SESSION_COOKIE_NAMES,
} from "@/features/auth/auth.cookies";
import { createMockRequest } from "../../support/mock-http";

const ORIGINAL_AUTH_COOKIE_SECURE = process.env.AUTH_COOKIE_SECURE;

function requestWithCookies(cookie: string) {
  return createMockRequest({ headers: { cookie } });
}

afterEach(() => {
  jest.restoreAllMocks();

  if (ORIGINAL_AUTH_COOKIE_SECURE === undefined) {
    delete process.env.AUTH_COOKIE_SECURE;
  } else {
    process.env.AUTH_COOKIE_SECURE = ORIGINAL_AUTH_COOKIE_SECURE;
  }
});

describe("isSecureCookieEnabled", () => {
  it("follows the environment by default", () => {
    delete process.env.AUTH_COOKIE_SECURE;

    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    expect(isSecureCookieEnabled()).toBe(true);

    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    expect(isSecureCookieEnabled()).toBe(false);
  });

  it("can be switched on outside production", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    process.env.AUTH_COOKIE_SECURE = "true";

    expect(isSecureCookieEnabled()).toBe(true);
  });
});

describe("getSessionCookieNames", () => {
  it("uses the __Host- names only for secure cookies", () => {
    expect(getSessionCookieNames(true)).toEqual({
      refresh: "__Host-rentify_refresh",
      csrf: "__Host-rentify_csrf",
    });
    expect(getSessionCookieNames(false)).toEqual({
      refresh: "refresh_token",
      csrf: "csrf_token",
    });
  });
});

describe("resolveSessionCookieNames", () => {
  it("reads only the legacy names when cookies are not secure", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    const request = requestWithCookies(
      "__Host-rentify_refresh=new; __Host-rentify_csrf=new-csrf",
    );

    expect(resolveSessionCookieNames(request)).toBe(
      LEGACY_SESSION_COOKIE_NAMES,
    );
    expect(readRefreshTokenCookie(request)).toBeUndefined();
  });

  it("reads the __Host- pair when a secure request carries it", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    const request = requestWithCookies(
      "__Host-rentify_refresh=new; __Host-rentify_csrf=new-csrf; refresh_token=old; csrf_token=old-csrf",
    );

    expect(resolveSessionCookieNames(request)).toBe(
      SECURE_SESSION_COOKIE_NAMES,
    );
    expect(readRefreshTokenCookie(request)).toBe("new");
    expect(readCsrfTokenCookie(request)).toBe("new-csrf");
  });

  it("falls back to the legacy pair for a session issued before the rename", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    const request = requestWithCookies(
      "refresh_token=old; csrf_token=old-csrf",
    );

    expect(readRefreshTokenCookie(request)).toBe("old");
    expect(readCsrfTokenCookie(request)).toBe("old-csrf");
  });

  it("never pairs a __Host- refresh cookie with a legacy CSRF cookie", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    const request = requestWithCookies(
      "__Host-rentify_refresh=new; csrf_token=planted",
    );

    expect(readRefreshTokenCookie(request)).toBe("new");
    expect(readCsrfTokenCookie(request)).toBeUndefined();
  });

  it("reads nothing from a request without cookies", () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    const request = createMockRequest();

    expect(readRefreshTokenCookie(request)).toBeUndefined();
    expect(readCsrfTokenCookie(request)).toBeUndefined();
  });
});
