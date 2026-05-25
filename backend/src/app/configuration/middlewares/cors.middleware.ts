import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { getOptionalEnvironmentVariable } from "@/configuration/environment";

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

function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  try {
    return allowedOrigins.includes(new URL(origin).origin);
  } catch {
    return allowedOrigins.includes(origin);
  }
}

export function createCorsMiddleware(): MiddlewareHandler<AppBindings> {
  const allowedOrigins = readAllowedOrigins();

  return cors({
    origin: (origin) => {
      if (!origin) {
        return "";
      }

      return isOriginAllowed(origin, allowedOrigins) ? origin : "";
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "authorization",
      "content-type",
      "x-device-id",
      "x-device-platform",
      "x-request-id",
      "x-csrf-token",
    ],
    exposeHeaders: [
      "content-type",
      "retry-after",
      "x-ratelimit-backend",
      "x-ratelimit-degraded",
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-policy",
      "x-ratelimit-strategy",
    ],
    credentials: true,
    maxAge: 24 * 60 * 60,
  });
}

export const corsMiddleware = createCorsMiddleware();
