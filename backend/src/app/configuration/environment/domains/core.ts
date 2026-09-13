import { parseDisabledRouteModuleIds } from "@/configuration/bootstrap/routes/config";
import type { RouteModuleId } from "@/configuration/bootstrap/routes/types";
import { DEFAULT_LOG_FALLBACK_DIRECTORY } from "@/configuration/environment/constants";
import {
  normalizeBaseUrl,
  parseBoolean,
  parseNumber,
} from "@/configuration/environment/shared";
import type {
  AppEnvironment,
  NodeEnvironment,
  RawEnvironmentValues,
} from "@/configuration/environment/types";

export function parseNodeEnvironment(
  raw: RawEnvironmentValues,
  errors: string[],
): NodeEnvironment {
  const value = raw.NODE_ENV ?? "development";

  if (value === "development" || value === "test" || value === "production") {
    return value;
  }

  errors.push("NODE_ENV must be one of: development, test, production.");
  return "development";
}

function parseLoggingMode(
  nodeEnv: NodeEnvironment,
): AppEnvironment["logging"]["mode"] {
  return nodeEnv === "production" ? "rabbitmq" : "console";
}

function parseLogLevel(
  value: string | undefined,
): AppEnvironment["logging"]["level"] {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error" ||
    normalized === "critical"
  ) {
    return normalized;
  }

  return "info";
}

function readDisabledRouteModuleIds(
  raw: RawEnvironmentValues,
  errors: string[],
): RouteModuleId[] {
  const parsed = parseDisabledRouteModuleIds(raw.DISABLED_ROUTE_MODULES);

  if (parsed.invalidIds.length > 0) {
    errors.push(
      `DISABLED_ROUTE_MODULES contains unknown module ids: ${parsed.invalidIds.join(", ")}.`,
    );
  }

  return parsed.disabledIds;
}

export function buildServerConfig(
  raw: RawEnvironmentValues,
  nodeEnv: NodeEnvironment,
  errors: string[],
): AppEnvironment["server"] {
  return {
    nodeEnv,
    port: parseNumber(raw, "PORT", 8040, errors, {
      integer: true,
      min: 1,
    }),
    isProduction: nodeEnv === "production",
  };
}

export function buildApplicationConfig(
  raw: RawEnvironmentValues,
): AppEnvironment["application"] {
  const frontendUrl = normalizeBaseUrl(
    raw.FRONTEND_URL ?? "http://localhost:3040",
  );

  return {
    name: raw.APP_NAME ?? "Rent",
    frontendUrl,
    baseUrl: normalizeBaseUrl(raw.APP_BASE_URL ?? frontendUrl),
  };
}

export function buildHttpConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["http"] {
  return {
    requestTimeoutMs: parseNumber(raw, "REQUEST_TIMEOUT_MS", 15_000, errors, {
      integer: true,
      min: 1,
    }),
    requestBodyMaxBytes: parseNumber(
      raw,
      "REQUEST_BODY_MAX_BYTES",
      1024 * 1024,
      errors,
      { integer: true, min: 1 },
    ),
    trustProxyHeaders: parseBoolean(raw.TRUST_PROXY_HEADERS, false),
  };
}

export function buildLoggingConfig(
  raw: RawEnvironmentValues,
  nodeEnv: NodeEnvironment,
): AppEnvironment["logging"] {
  return {
    fallbackDirectory:
      raw.LOG_FALLBACK_DIRECTORY ?? DEFAULT_LOG_FALLBACK_DIRECTORY,
    level: parseLogLevel(raw.LOG_LEVEL),
    mode: parseLoggingMode(nodeEnv),
    serviceName: raw.LOG_SERVICE_NAME ?? "backend",
    silent: parseBoolean(raw.LOG_SILENT, false),
  };
}

export function buildRouteModulesConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["routeModules"] {
  return {
    disabledIds: readDisabledRouteModuleIds(raw, errors),
  };
}
