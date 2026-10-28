import type { Request } from "express";
import { environment } from "@/configuration/environment";
import { readCookie } from "@/configuration/http/request";

/**
 * The names used over plain http, where the `__Host-` prefix is unavailable.
 * Secure deployments also accept them on the way in, so sessions issued before
 * the rename keep working; see {@link resolveSessionCookieNames}.
 */
export const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";
export const CSRF_TOKEN_COOKIE_NAME = "csrf_token";

/**
 * `__Host-` makes the browser refuse the cookie unless it is `Secure`, has
 * `Path=/` and no `Domain`, so a sibling subdomain can neither set nor
 * overwrite it.
 */
export const SECURE_REFRESH_TOKEN_COOKIE_NAME = "__Host-rentify_refresh";
export const SECURE_CSRF_TOKEN_COOKIE_NAME = "__Host-rentify_csrf";

export const CSRF_TOKEN_HEADER_NAME = "x-csrf-token";

export interface SessionCookieNames {
  refresh: string;
  csrf: string;
}

export const LEGACY_SESSION_COOKIE_NAMES: SessionCookieNames = {
  refresh: REFRESH_TOKEN_COOKIE_NAME,
  csrf: CSRF_TOKEN_COOKIE_NAME,
};

export const SECURE_SESSION_COOKIE_NAMES: SessionCookieNames = {
  refresh: SECURE_REFRESH_TOKEN_COOKIE_NAME,
  csrf: SECURE_CSRF_TOKEN_COOKIE_NAME,
};

export function isSecureCookieEnabled(): boolean {
  return environment.getTokenConfig().secureCookies;
}

/** The names new session cookies are written under. */
export function getSessionCookieNames(
  secure = isSecureCookieEnabled(),
): SessionCookieNames {
  return secure ? SECURE_SESSION_COOKIE_NAMES : LEGACY_SESSION_COOKIE_NAMES;
}

/**
 * The names to read this request's session cookies from. Both cookies of a
 * pair are always read together, so a legacy CSRF cookie planted next to a
 * `__Host-` session is never consulted.
 *
 * Secure deployments fall back to the legacy names for sessions issued before
 * the rename. Every refresh rewrites the session under the `__Host-` names and
 * expires the legacy ones, so the fallback can go once a remember-me refresh
 * token lifetime (REMEMBER_ME_REFRESH_TOKEN_TTL_SECONDS, 90 days by default)
 * has passed since the rename shipped.
 */
export function resolveSessionCookieNames(
  request: Request,
): SessionCookieNames {
  if (!isSecureCookieEnabled()) {
    return LEGACY_SESSION_COOKIE_NAMES;
  }

  const hasSecureCookie =
    readCookie(request, SECURE_REFRESH_TOKEN_COOKIE_NAME) !== undefined ||
    readCookie(request, SECURE_CSRF_TOKEN_COOKIE_NAME) !== undefined;

  return hasSecureCookie
    ? SECURE_SESSION_COOKIE_NAMES
    : LEGACY_SESSION_COOKIE_NAMES;
}

export function readRefreshTokenCookie(request: Request): string | undefined {
  return readCookie(request, resolveSessionCookieNames(request).refresh);
}

export function readCsrfTokenCookie(request: Request): string | undefined {
  return readCookie(request, resolveSessionCookieNames(request).csrf);
}
