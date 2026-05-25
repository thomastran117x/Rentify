import {
  DEFAULT_ELASTICSEARCH_POSTINGS_INDEX,
  DEFAULT_REDIS_HOST,
} from "@/configuration/environment/constants";
import { parseBoolean, parseNumber } from "@/configuration/environment/shared";
import type {
  AppEnvironment,
  NodeEnvironment,
  RawEnvironmentValues,
} from "@/configuration/environment/types";

export function validateInfrastructureConfig(
  raw: RawEnvironmentValues,
  nodeEnv: NodeEnvironment,
  errors: string[],
): void {
  const elasticsearchEnabled = parseBoolean(raw.ELASTICSEARCH_ENABLED, false);

  if (elasticsearchEnabled && !raw.ELASTICSEARCH_URL) {
    errors.push(
      "ELASTICSEARCH_URL is required when ELASTICSEARCH_ENABLED is true.",
    );
  }

  if (nodeEnv === "production" && !raw.RABBITMQ_URL) {
    errors.push("RABBITMQ_URL is required when NODE_ENV is production.");
  }

  const hasBlobConnectionString = Boolean(raw.AZURE_STORAGE_CONNECTION_STRING);
  const hasBlobContainerName = Boolean(raw.AZURE_STORAGE_CONTAINER_NAME);

  if (hasBlobConnectionString !== hasBlobContainerName) {
    errors.push(
      "AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER_NAME must be configured together.",
    );
  }
}

export function buildDatabaseConfig(
  raw: RawEnvironmentValues,
  nodeEnv: NodeEnvironment,
  errors: string[],
  databaseUrl: string,
): AppEnvironment["database"] {
  return {
    url: databaseUrl,
    autoSeedEnabled: parseBoolean(
      raw.DATABASE_AUTO_SEED_ENABLED,
      nodeEnv !== "production",
    ),
    autoSeedRefresh: parseBoolean(raw.DATABASE_AUTO_SEED_REFRESH, false),
    operationLoggingEnabled: parseBoolean(
      raw.DATABASE_OPERATION_LOGGING_ENABLED,
      false,
    ),
    queryLoggingEnabled: parseBoolean(
      raw.DATABASE_QUERY_LOGGING_ENABLED,
      false,
    ),
    slowOperationThresholdMs: parseNumber(
      raw,
      "DATABASE_SLOW_OPERATION_THRESHOLD_MS",
      nodeEnv === "production" ? 1_000 : 500,
      errors,
      {
        integer: true,
        min: 0,
      },
    ),
    slowQueryThresholdMs: parseNumber(
      raw,
      "DATABASE_SLOW_QUERY_THRESHOLD_MS",
      nodeEnv === "production" ? 750 : 250,
      errors,
      {
        integer: true,
        min: 0,
      },
    ),
  };
}

export function buildRedisConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["redis"] {
  return {
    url: raw.REDIS_URL ?? "",
    host: raw.REDIS_HOST ?? DEFAULT_REDIS_HOST,
    port: parseNumber(raw, "REDIS_PORT", 6379, errors, {
      integer: true,
      min: 1,
    }),
    password: raw.REDIS_PASSWORD,
    db: parseNumber(raw, "REDIS_DB", 0, errors, {
      integer: true,
      min: 0,
    }),
    connectTimeoutMs: parseNumber(
      raw,
      "REDIS_CONNECT_TIMEOUT_MS",
      10_000,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
  };
}

export function buildBlobStorageConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["blobStorage"] {
  return {
    connectionString: raw.AZURE_STORAGE_CONNECTION_STRING,
    containerName: raw.AZURE_STORAGE_CONTAINER_NAME,
    uploadSasTtlSeconds: parseNumber(
      raw,
      "AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS",
      15 * 60,
      errors,
      {
        integer: true,
        min: 60,
        max: 60 * 60,
      },
    ),
  };
}

export function buildRabbitMqConfig(
  raw: RawEnvironmentValues,
): AppEnvironment["rabbitmq"] {
  return {
    url: raw.RABBITMQ_URL,
  };
}

export function buildElasticsearchConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["elasticsearch"] {
  const enabled = parseBoolean(raw.ELASTICSEARCH_ENABLED, false);

  return {
    enabled,
    url: raw.ELASTICSEARCH_URL?.replace(/\/+$/, ""),
    username: raw.ELASTICSEARCH_USERNAME,
    password: raw.ELASTICSEARCH_PASSWORD,
    postingsIndexName:
      raw.ELASTICSEARCH_POSTINGS_INDEX ?? DEFAULT_ELASTICSEARCH_POSTINGS_INDEX,
    timeoutMs: parseNumber(raw, "ELASTICSEARCH_TIMEOUT_MS", 2_000, errors, {
      integer: true,
      min: 1,
    }),
    circuitBreakerFailureThreshold: parseNumber(
      raw,
      "ELASTICSEARCH_CIRCUIT_BREAKER_FAILURE_THRESHOLD",
      3,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    circuitBreakerCooldownMs: parseNumber(
      raw,
      "ELASTICSEARCH_CIRCUIT_BREAKER_COOLDOWN_MS",
      30_000,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
  };
}

export function buildSquareConfig(
  raw: RawEnvironmentValues,
  errors: string[],
  squareAccessToken: string,
  squareLocationId: string,
  squareWebhookSignatureKey: string,
  squareWebhookNotificationUrl: string,
): AppEnvironment["square"] {
  const squareEnvironment = raw.SQUARE_ENVIRONMENT?.toLowerCase() ?? "sandbox";

  if (squareEnvironment !== "sandbox" && squareEnvironment !== "production") {
    errors.push("SQUARE_ENVIRONMENT must be either sandbox or production.");
  }

  return {
    accessToken: squareAccessToken,
    environment: squareEnvironment === "production" ? "production" : "sandbox",
    locationId: squareLocationId,
    webhookSignatureKey: squareWebhookSignatureKey,
    webhookNotificationUrl: squareWebhookNotificationUrl,
    apiBaseUrl:
      squareEnvironment === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com",
  };
}
