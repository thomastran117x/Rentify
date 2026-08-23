import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { clearCookie, writeCookie } from "@/configuration/http/request";
import { ok } from "@/configuration/http/responses";
import { environment } from "@/configuration/environment";
import {
  CSRF_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
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

export function isSecureCookieEnabled(): boolean {
  return environment.isProduction();
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

  writeCookie(response, REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "Lax",
    maxAge: result.refreshTokenExpiresInSeconds,
  });
  writeCookie(response, CSRF_TOKEN_COOKIE_NAME, createCsrfToken(), {
    path: "/",
    secure,
    sameSite: "Lax",
    maxAge: result.refreshTokenExpiresInSeconds,
  });
}

export function clearBrowserSessionCookies(response: Response): void {
  clearCookie(response, REFRESH_TOKEN_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    secure: isSecureCookieEnabled(),
    sameSite: "Lax",
  });
  clearCookie(response, CSRF_TOKEN_COOKIE_NAME, {
    path: "/",
    secure: isSecureCookieEnabled(),
    sameSite: "Lax",
  });
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
