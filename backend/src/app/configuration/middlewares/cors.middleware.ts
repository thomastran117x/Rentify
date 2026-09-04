import cors from "cors";
import type { RequestHandler } from "express";
import { readCorsAllowedOrigins } from "@/configuration/http/allowed-origins";
import { CLIENT_APP_HEADER_NAME } from "@/configuration/http/client-source";

function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  try {
    return allowedOrigins.includes(new URL(origin).origin);
  } catch {
    return allowedOrigins.includes(origin);
  }
}

export function createCorsMiddleware(): RequestHandler {
  const allowedOrigins = readCorsAllowedOrigins();

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
      CLIENT_APP_HEADER_NAME,
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
