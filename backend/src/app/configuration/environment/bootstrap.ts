import { DEFAULT_LOG_FALLBACK_DIRECTORY } from "@/configuration/environment/constants";
import type {
  LoggingMode,
  NodeEnvironment,
} from "@/configuration/environment/types";
import type { LogLevel } from "@/configuration/logging/types";

export interface BootstrapLoggingConfig {
  environment: NodeEnvironment;
  fallbackDirectory: string;
  level: LogLevel;
  mode: LoggingMode;
  rabbitMqUrl?: string;
  serviceName: string;
  silent: boolean;
}

function readNonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function readNodeEnvironment(value: string | undefined): NodeEnvironment {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "development" ||
    normalized === "test" ||
    normalized === "production"
  ) {
    return normalized;
  }

  return "development";
}

function readLogLevel(value: string | undefined): LogLevel {
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

function readBooleanOverride(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized ?? "")) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized ?? "")) {
    return false;
  }

  return undefined;
}

/**
 * Reads the minimal process configuration needed to report a failure before
 * the validated environment manager is available. Normal runtime settings
 * continue to come from the cached layered configuration.
 */
export function readBootstrapLoggingConfig(
  source: NodeJS.ProcessEnv = process.env,
): BootstrapLoggingConfig {
  const environment = readNodeEnvironment(source.NODE_ENV);
  const silentOverride = readBooleanOverride(source.LOG_SILENT);

  return {
    environment,
    fallbackDirectory:
      readNonEmpty(source.LOG_FALLBACK_DIRECTORY) ??
      DEFAULT_LOG_FALLBACK_DIRECTORY,
    level: readLogLevel(source.LOG_LEVEL),
    mode: environment === "production" ? "rabbitmq" : "console",
    rabbitMqUrl: readNonEmpty(source.RABBITMQ_URL),
    serviceName: readNonEmpty(source.LOG_SERVICE_NAME) ?? "backend",
    silent: silentOverride ?? (source.CI === "true" && environment === "test"),
  };
}
