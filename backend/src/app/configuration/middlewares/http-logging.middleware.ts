import type { Request, RequestHandler } from "express";
import { getRequestUrl } from "@/configuration/http/request";
import { runAfterResponse } from "@/configuration/http/response-lifecycle";

const REDACTED_QUERY_VALUE = "[REDACTED]";

const SENSITIVE_EXACT_QUERY_KEYS = new Set([
  "access_token",
  "api_key",
  "assertion",
  "auth_code",
  "authorization",
  "authorization_code",
  "client_secret",
  "code",
  "code_verifier",
  "id_token",
  "jwt",
  "nonce",
  "otp",
  "password",
  "passcode",
  "private_key",
  "public_key",
  "refresh_token",
  "saml_request",
  "saml_response",
  "session",
  "session_id",
  "sig",
  "signature",
  "state",
  "token",
]);

const SENSITIVE_QUERY_KEY_PATTERN =
  /(token|secret|password|passwd|signature|assertion|nonce|otp|jwt|saml)/i;

const colors = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function shouldUseColors(): boolean {
  // Keeps this safe for non-Node runtimes.
  if (typeof process === "undefined") {
    return false;
  }

  return process.env.NO_COLOR !== "1" && process.env.FORCE_COLOR !== "0";
}

function colorize(value: string, color: string): string {
  if (!shouldUseColors()) {
    return value;
  }

  return `${color}${value}${colors.reset}`;
}

function normalizeQueryKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isSensitiveQueryKey(key: string): boolean {
  const normalizedKey = normalizeQueryKey(key);

  return (
    SENSITIVE_EXACT_QUERY_KEYS.has(normalizedKey) ||
    SENSITIVE_QUERY_KEY_PATTERN.test(normalizedKey)
  );
}

function getSanitizedPathWithQuery(request: Request): string {
  const url = getRequestUrl(request);

  for (const key of new Set(url.searchParams.keys())) {
    if (isSensitiveQueryKey(key)) {
      url.searchParams.set(key, REDACTED_QUERY_VALUE);
    }
  }

  const queryString = url.searchParams.toString();

  return queryString ? `${url.pathname}?${queryString}` : url.pathname;
}

function getStatusColor(status: number): string {
  if (status >= 500) return colors.red;
  if (status >= 400) return colors.yellow;
  if (status >= 300) return colors.cyan;

  return colors.green;
}

function getMethodColor(method: string): string {
  switch (method) {
    case "GET":
      return colors.green;
    case "POST":
      return colors.yellow;
    case "PUT":
    case "PATCH":
      return colors.cyan;
    case "DELETE":
      return colors.red;
    default:
      return colors.magenta;
  }
}

function getDurationColor(durationMs: number): string {
  if (durationMs > 1000) return colors.red;
  if (durationMs > 300) return colors.yellow;

  return colors.green;
}

function getLogLevel(status: number): "info" | "warn" | "error" {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";

  return "info";
}

function roundDurationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function formatHttpLogLine(input: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
  ip: string;
  format?: string;
}): string {
  const method = colorize(input.method.padEnd(6), getMethodColor(input.method));
  const status = colorize(String(input.status), getStatusColor(input.status));
  const duration = colorize(
    `${input.durationMs}ms`,
    getDurationColor(input.durationMs),
  );

  const requestId = colorize(`req=${input.requestId}`, colors.gray);
  const ip = colorize(`ip=${input.ip}`, colors.gray);
  const format = input.format
    ? colorize(`format=${input.format}`, colors.gray)
    : undefined;

  return [
    "HTTP",
    method,
    input.path,
    "->",
    status,
    duration,
    requestId,
    ip,
    format,
  ]
    .filter(Boolean)
    .join(" ");
}

export const httpLoggingMiddleware: RequestHandler = (
  request,
  response,
  next,
) => {
  const startedAt = performance.now();

  // Logged once the response has been written, since the status is the whole
  // point of the line. Reading it before next() would always report 200.
  runAfterResponse(response, () => {
    const durationMs = roundDurationMs(startedAt);

    const logger = request.logger;
    const client = request.client;
    const outputFormat = request.outputFormat;
    const requestId = request.requestId;

    const method = request.method;
    const path = getSanitizedPathWithQuery(request);
    const status = response.statusCode;

    const logLevel = getLogLevel(status);

    const logLine = formatHttpLogLine({
      method,
      path,
      status,
      durationMs,
      requestId: requestId ?? "unknown",
      ip: client?.ip ?? "unknown",
      format: outputFormat,
    });

    logger[logLevel](logLine, {
      durationMs,
      format: outputFormat,
      ip: client?.ip ?? "unknown",
      method,
      path,
      requestId: requestId ?? "unknown",
      status,
    });
  });

  next();
};
