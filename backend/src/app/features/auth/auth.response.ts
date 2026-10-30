import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { clearCookie, writeCookie } from "@/configuration/http/request";
import { ok } from "@/configuration/http/responses";
import {
  getSessionCookieNames,
  isSecureCookieEnabled,
  LEGACY_SESSION_COOKIE_NAMES,
  SECURE_SESSION_COOKIE_NAMES,
  type SessionCookieNames,
} from "@/features/auth/auth.cookies";
import type {
  AuthResponseBody,
  AuthSessionResult,
} from "@/features/auth/auth.model";

/**
 * Browser callers get their refresh token in an httpOnly cookie and never in the
 * response body; API callers get the opposite. There is no header that reliably
 * says "I am a browser", so this infers it from the fetch metadata browsers set
 * and non-browser clients generally do not.
 */
export function isBrowserRequest(request: Request): boolean {
  return Boolean(
    request.get("origin") ||
      request.get("referer") ||
      request.get("sec-fetch-site"),
  );
}

export function shouldSetRefreshCookie(request: Request): boolean {
  return isBrowserRequest(request);
}

export function createCsrfToken(): string {
  return randomUUID();
}

export function toAuthResponseBody(
  request: Request,
  result: AuthSessionResult,
): AuthResponseBody {
  const responseBody: AuthResponseBody = {
    accessToken: result.accessToken,
    device: result.device,
    user: {
      id: result.user.id,
      email: result.user.email,
      username: result.user.username,
      avatarUrl: result.user.avatarUrl,
      avatarVariants: result.user.avatarVariants,
      role: result.user.role,
      activeOrganization: result.user.activeOrganization,
      organizationMembershipCount: result.user.organizationMembershipCount,
    },
  };

  if (!shouldSetRefreshCookie(request)) {
    responseBody.refreshToken = result.refreshToken;
  }

  if (result.isNewUser) {
    responseBody.isNewUser = true;
  }

  return responseBody;
}

export function setBrowserSessionCookies(
  response: Response,
  result: AuthSessionResult,
): void {
  const secure = isSecureCookieEnabled();
  const names = getSessionCookieNames(secure);

  writeCookie(response, names.refresh, result.refreshToken, {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "Lax",
    maxAge: result.refreshTokenExpiresInSeconds,
  });
  writeCookie(response, names.csrf, createCsrfToken(), {
    path: "/",
    secure,
    sameSite: "Lax",
    maxAge: result.refreshTokenExpiresInSeconds,
  });

  if (secure) {
    // A session issued before the __Host- rename still holds the legacy
    // cookies; expire them so the browser is left with one pair.
    clearSessionCookies(response, LEGACY_SESSION_COOKIE_NAMES, secure);
  }
}

function clearSessionCookies(
  response: Response,
  names: SessionCookieNames,
  secure: boolean,
): void {
  clearCookie(response, names.refresh, {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "Lax",
  });
  clearCookie(response, names.csrf, {
    path: "/",
    secure,
    sameSite: "Lax",
  });
}

export function clearBrowserSessionCookies(response: Response): void {
  const secure = isSecureCookieEnabled();

  clearSessionCookies(response, LEGACY_SESSION_COOKIE_NAMES, secure);

  // Browsers reject a __Host- cookie that is not Secure, so these only exist,
  // and can only be cleared, when cookies are Secure.
  if (secure) {
    clearSessionCookies(response, SECURE_SESSION_COOKIE_NAMES, secure);
  }
}

/**
 * Writes an authenticated session response, setting the refresh and CSRF
 * cookies for browser clients.
 */
export function writeAuthSessionResponse(
  request: Request,
  response: Response,
  body: AuthSessionResult,
  options?: {
    message?: string;
  },
): void {
  const responseBody = toAuthResponseBody(request, body);

  if (shouldSetRefreshCookie(request)) {
    setBrowserSessionCookies(response, body);
  }

  ok(response, responseBody, options);
}
