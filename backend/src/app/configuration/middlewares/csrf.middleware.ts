import type { Request, RequestHandler } from "express";
import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import { stripApiRoutePrefix } from "@/configuration/http/api-path";
import {
  getHeader,
  getPathname,
  readCookie,
} from "@/configuration/http/request";
import ForbiddenError from "@/errors/http/forbidden.error";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_HEADER_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function expandLoopbackOriginAliases(origin: string): string[] {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.trim().toLowerCase();

    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      return [url.origin];
    }

    const aliases = new Set<string>([url.origin]);

    for (const loopbackHostname of ["localhost", "127.0.0.1"]) {
      url.hostname = loopbackHostname;
      aliases.add(url.origin);
    }

    return [...aliases];
  } catch {
    return [origin];
  }
}

/**
 * Exported so the WebSocket upgrade handler can apply the same allow-list. That
 * handler is attached to the raw Node server and never passes through this
 * middleware, so without sharing this list it would be the one authenticated
 * entry point in the app with no origin check at all.
 */
export function readAllowedOrigins(): string[] {
  const configuredOrigins =
    getOptionalEnvironmentVariable("CSRF_ALLOWED_ORIGINS") ??
    getOptionalEnvironmentVariable("CORS_ALLOWED_ORIGINS") ??
    getOptionalEnvironmentVariable("FRONTEND_URL") ??
    "http://localhost:3040";

  return [
    ...new Set(
      configuredOrigins
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
        .flatMap((origin) => expandLoopbackOriginAliases(origin)),
    ),
  ];
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function readRequestOrigin(request: Request): string | null {
  const origin = getHeader(request, "origin");

  if (origin) {
    return normalizeOrigin(origin);
  }

  const referer = getHeader(request, "referer");

  if (referer) {
    return normalizeOrigin(referer);
  }

  return null;
}

function isBrowserRequest(request: Request): boolean {
  return (
    getHeader(request, "origin") !== undefined ||
    getHeader(request, "referer") !== undefined ||
    getHeader(request, "sec-fetch-site") !== undefined
  );
}

function requiresCookieBackedCsrf(path: string, request: Request): boolean {
  if (path === "/auth/refresh" || path === "/auth/logout") {
    return true;
  }

  return (
    getHeader(request, "cookie")?.includes(`${REFRESH_TOKEN_COOKIE_NAME}=`) ??
    false
  );
}

export const csrfMiddleware: RequestHandler = (request, _response, next) => {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    next();
    return;
  }

  const path = stripApiRoutePrefix(getPathname(request));

  if (path.startsWith("/auth/oauth/")) {
    next();
    return;
  }

  if (!isBrowserRequest(request)) {
    next();
    return;
  }

  const requestOrigin = readRequestOrigin(request);
  const allowedOrigins = readAllowedOrigins()
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));

  if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
    throw new ForbiddenError("CSRF validation failed.");
  }

  if (getHeader(request, "sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new ForbiddenError("CSRF validation failed.");
  }

  if (requiresCookieBackedCsrf(path, request)) {
    const csrfCookie = readCookie(request, CSRF_TOKEN_COOKIE_NAME);
    const csrfHeader = getHeader(request, CSRF_TOKEN_HEADER_NAME);

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      throw new ForbiddenError("CSRF validation failed.");
    }
  }

  next();
};
