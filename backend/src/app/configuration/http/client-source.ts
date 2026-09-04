import type { Request } from "express";
import {
  normalizeOrigin,
  readCorsAllowedOrigins,
} from "@/configuration/http/allowed-origins";
import { getHeader } from "@/configuration/http/request";

/**
 * Header a first-party client uses to name itself, as `<app>/<runtime>`.
 *
 * This is an unauthenticated hint: anyone can send it. It exists so log lines
 * can be split by caller, and must never gate authorization, CSRF, or rate
 * limiting. The heuristics below are what keep the classification useful for
 * callers that stay silent or lie.
 */
export const CLIENT_APP_HEADER_NAME = "x-client-app";

export const FRONTEND_APP_TOKEN = "rentify-web";

export type ClientSource =
  | "frontend-browser"
  | "frontend-server"
  | "api-integration"
  | "browser-direct"
  | "api-tool"
  | "bot"
  | "server-side"
  | "unknown";

export interface ClientSourceContext {
  source: ClientSource;
  origin?: string;
  declaredApp?: string;
}

const DECLARED_APP_MAX_LENGTH = 64;
const DECLARED_APP_PATTERN = /^[a-z0-9._/-]+$/;

const API_TOOL_USER_AGENT_PATTERN =
  /postmanruntime|insomnia|curl|wget|httpie|python-requests|node-fetch|axios|go-http-client|okhttp/;

const BOT_USER_AGENT_PATTERN = /bot|crawler|spider|slurp/;

const RUNTIME_USER_AGENT_PATTERN = /^(undici|node|node-fetch|got|next\.js)\b/;

/**
 * Normalises the declared app token before it reaches the log pipeline.
 *
 * The value is attacker-controlled and ends up in log output, so anything
 * over-long or outside a conservative character set is dropped rather than
 * truncated — a caller sending garbage should fall through to the heuristics.
 */
function readDeclaredApp(request: Request): string | undefined {
  const value = getHeader(request, CLIENT_APP_HEADER_NAME)
    ?.trim()
    .toLowerCase();

  if (!value || value.length > DECLARED_APP_MAX_LENGTH) {
    return undefined;
  }

  return DECLARED_APP_PATTERN.test(value) ? value : undefined;
}

function readRequestOrigin(request: Request): string | undefined {
  const origin = getHeader(request, "origin");

  if (origin) {
    return normalizeOrigin(origin) ?? undefined;
  }

  const referer = getHeader(request, "referer");

  if (referer) {
    return normalizeOrigin(referer) ?? undefined;
  }

  return undefined;
}

function hasBrowserHeaders(request: Request): boolean {
  return (
    getHeader(request, "origin") !== undefined ||
    getHeader(request, "referer") !== undefined ||
    getHeader(request, "sec-fetch-site") !== undefined
  );
}

function isAllowedFrontendOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }

  return readCorsAllowedOrigins()
    .map((allowed) => normalizeOrigin(allowed))
    .includes(origin);
}

function resolveDeclaredSource(declaredApp: string): ClientSource {
  const [app, runtime] = declaredApp.split("/");

  if (app !== FRONTEND_APP_TOKEN) {
    return "api-integration";
  }

  return runtime === "server" ? "frontend-server" : "frontend-browser";
}

function resolveUserAgentSource(userAgent: string | undefined): ClientSource {
  if (!userAgent) {
    return "server-side";
  }

  const normalized = userAgent.toLowerCase();

  // Checked before the crawler pattern, which matches the bare substring "bot"
  // and so fires on plenty of agents that are not crawlers. A user agent naming
  // a specific tool is the more precise signal, so it wins.
  if (API_TOOL_USER_AGENT_PATTERN.test(normalized)) {
    return "api-tool";
  }

  if (BOT_USER_AGENT_PATTERN.test(normalized)) {
    return "bot";
  }

  if (RUNTIME_USER_AGENT_PATTERN.test(normalized)) {
    return "server-side";
  }

  return "unknown";
}

/**
 * Classifies who is calling the API, for logging only.
 *
 * Signals are evaluated in descending order of confidence: an explicit
 * {@link CLIENT_APP_HEADER_NAME} declaration, then an `Origin`/`Referer` that
 * matches the configured frontend, then the generic browser headers, and
 * finally the user agent.
 */
export function resolveClientSource(request: Request): ClientSourceContext {
  const declaredApp = readDeclaredApp(request);
  const origin = readRequestOrigin(request);

  if (declaredApp) {
    return { source: resolveDeclaredSource(declaredApp), origin, declaredApp };
  }

  if (isAllowedFrontendOrigin(origin)) {
    return { source: "frontend-browser", origin };
  }

  if (hasBrowserHeaders(request)) {
    return { source: "browser-direct", origin };
  }

  return {
    source: resolveUserAgentSource(getHeader(request, "user-agent")?.trim()),
    origin,
  };
}
