import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import type { AppBindings } from "@/configuration/http/bindings";
import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import { stripApiRoutePrefix } from "@/configuration/http/api-path";
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

function readAllowedOrigins(): string[] {
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
  const origin = request.headers.get("origin");

  if (origin) {
    return normalizeOrigin(origin);
  }

  const referer = request.headers.get("referer");

  if (referer) {
    return normalizeOrigin(referer);
  }

  return null;
}

function isBrowserRequest(request: Request): boolean {
  return (
    request.headers.has("origin") ||
    request.headers.has("referer") ||
    request.headers.has("sec-fetch-site")
  );
}

function requiresCookieBackedCsrf(path: string, request: Request): boolean {
  if (path === "/auth/refresh" || path === "/auth/logout") {
    return true;
  }

  return (
    request.headers.get("cookie")?.includes(`${REFRESH_TOKEN_COOKIE_NAME}=`) ??
    false
  );
}

export const csrfMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    const request = context.req.raw;

    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      await next();
      return;
    }

    const path = stripApiRoutePrefix(new URL(request.url).pathname);

    if (path.startsWith("/auth/oauth/")) {
      await next();
      return;
    }

    if (!isBrowserRequest(request)) {
      await next();
      return;
    }

    const requestOrigin = readRequestOrigin(request);
    const allowedOrigins = readAllowedOrigins()
      .map((origin) => normalizeOrigin(origin))
      .filter((origin): origin is string => Boolean(origin));

    if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
      throw new ForbiddenError("CSRF validation failed.");
    }

    if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
      throw new ForbiddenError("CSRF validation failed.");
    }

    if (requiresCookieBackedCsrf(path, request)) {
      const csrfCookie = getCookie(context, CSRF_TOKEN_COOKIE_NAME);
      const csrfHeader = request.headers.get(CSRF_TOKEN_HEADER_NAME);

      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        throw new ForbiddenError("CSRF validation failed.");
      }
    }

    await next();
  },
);
