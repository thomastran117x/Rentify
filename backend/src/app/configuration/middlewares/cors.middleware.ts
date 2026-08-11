import cors from "cors";
import type { RequestHandler } from "express";
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

export function createCorsMiddleware(): RequestHandler {
  const allowedOrigins = readAllowedOrigins();

  return cors({
    // Mirrors the previous hono/cors callback: an unknown or missing origin
    // gets no Access-Control-Allow-Origin header rather than a rejection.
    origin: (origin, callback) => {
      callback(
        null,
        Boolean(origin) && isOriginAllowed(origin!, allowedOrigins),
      );
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "authorization",
      "content-type",
      "x-ms-blob-type",
      "x-device-id",
      "x-device-platform",
      "x-request-id",
      "x-csrf-token",
    ],
    exposedHeaders: [
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
