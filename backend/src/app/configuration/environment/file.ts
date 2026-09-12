import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { z } from "zod";
import { normalizeFeatureName } from "@/configuration/environment/domains/features";
import type {
  ConfigurationFeatureSource,
  EnvironmentVariableName,
  RawEnvironmentValues,
} from "@/configuration/environment/types";

type ConfigurationFeature = {
  enabled: boolean;
  source: ConfigurationFeatureSource;
};

export type LoadedFileConfiguration = {
  raw: RawEnvironmentValues;
  features: Record<string, ConfigurationFeature>;
};

type ConfigurationDocument = Record<string, unknown>;

const configurationValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string(), z.number().finite(), z.boolean()])),
    z.record(z.string(), configurationValueSchema),
  ]),
);

const configurationDocumentSchema = z.record(
  z.string(),
  configurationValueSchema,
);

const featureSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

const FILE_KEY_TO_ENVIRONMENT_VARIABLE = {
  "application.baseUrl": "APP_BASE_URL",
  "application.frontendUrl": "FRONTEND_URL",
  "application.name": "APP_NAME",
  "auth.accessTokenTtlSeconds": "ACCESS_TOKEN_TTL_SECONDS",
  "auth.audience": "TOKEN_AUDIENCE",
  "auth.issuer": "TOKEN_ISSUER",
  "auth.mfaBypassEmails": "MFA_BYPASS_EMAILS",
  "auth.refreshTokenCachePrefix": "REFRESH_TOKEN_CACHE_PREFIX",
  "auth.refreshTokenMode": "REFRESH_TOKEN_MODE",
  "auth.refreshTokenTtlSeconds": "REFRESH_TOKEN_TTL_SECONDS",
  "auth.rememberMeRefreshTokenTtlSeconds":
    "REMEMBER_ME_REFRESH_TOKEN_TTL_SECONDS",
  "blobStorage.containerName": "AZURE_STORAGE_CONTAINER_NAME",
  "blobStorage.uploadSasTtlSeconds": "AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS",
  "captcha.allowedHosts": "CAPTCHA_ALLOWED_HOSTS",
  "cors.allowedOrigins": "CORS_ALLOWED_ORIGINS",
  "csrf.allowedOrigins": "CSRF_ALLOWED_ORIGINS",
  "database.autoSeedEnabled": "DATABASE_AUTO_SEED_ENABLED",
  "database.autoSeedRefresh": "DATABASE_AUTO_SEED_REFRESH",
  "database.operationLoggingEnabled": "DATABASE_OPERATION_LOGGING_ENABLED",
  "database.poolConnectionLimit": "DATABASE_POOL_CONNECTION_LIMIT",
  "database.poolMinimumIdle": "DATABASE_POOL_MINIMUM_IDLE",
  "database.queryLoggingEnabled": "DATABASE_QUERY_LOGGING_ENABLED",
  "database.slowOperationThresholdMs": "DATABASE_SLOW_OPERATION_THRESHOLD_MS",
  "database.slowQueryThresholdMs": "DATABASE_SLOW_QUERY_THRESHOLD_MS",
  "elasticsearch.circuitBreakerCooldownMs":
    "ELASTICSEARCH_CIRCUIT_BREAKER_COOLDOWN_MS",
  "elasticsearch.circuitBreakerFailureThreshold":
    "ELASTICSEARCH_CIRCUIT_BREAKER_FAILURE_THRESHOLD",
  "elasticsearch.enabled": "ELASTICSEARCH_ENABLED",
  "elasticsearch.indices.organizationBlogs":
    "ELASTICSEARCH_ORGANIZATION_BLOGS_INDEX",
  "elasticsearch.indices.organizations": "ELASTICSEARCH_ORGANIZATIONS_INDEX",
  "elasticsearch.indices.postings": "ELASTICSEARCH_POSTINGS_INDEX",
  "elasticsearch.indices.reports": "ELASTICSEARCH_REPORTS_INDEX",
  "elasticsearch.timeoutMs": "ELASTICSEARCH_TIMEOUT_MS",
  "elasticsearch.url": "ELASTICSEARCH_URL",
  "elasticsearch.username": "ELASTICSEARCH_USERNAME",
  "email.fromEmail": "EMAIL_FROM",
  "email.fromName": "EMAIL_FROM_NAME",
  "email.gmailUser": "GMAIL_USER",
  "http.requestBodyMaxBytes": "REQUEST_BODY_MAX_BYTES",
  "http.requestTimeoutMs": "REQUEST_TIMEOUT_MS",
  "http.trustProxyHeaders": "TRUST_PROXY_HEADERS",
  "identityBloom.email.capacity": "EMAIL_BLOOM_CAPACITY",
  "identityBloom.email.enabled": "EMAIL_BLOOM_ENABLED",
  "identityBloom.email.falsePositiveRate": "EMAIL_BLOOM_FALSE_POSITIVE_RATE",
  "identityBloom.email.maxStalenessMs": "EMAIL_BLOOM_MAX_STALENESS_MS",
  "identityBloom.email.rebuildBatchSize": "EMAIL_BLOOM_REBUILD_BATCH_SIZE",
  "identityBloom.email.rebuildIntervalMs": "EMAIL_BLOOM_REBUILD_INTERVAL_MS",
  "identityBloom.email.rebuildLockTtlMs": "EMAIL_BLOOM_REBUILD_LOCK_TTL_MS",
  "identityBloom.email.reloadIntervalMs": "EMAIL_BLOOM_RELOAD_INTERVAL_MS",
  "identityBloom.username.capacity": "USERNAME_BLOOM_CAPACITY",
  "identityBloom.username.enabled": "USERNAME_BLOOM_ENABLED",
  "identityBloom.username.falsePositiveRate":
    "USERNAME_BLOOM_FALSE_POSITIVE_RATE",
  "identityBloom.username.maxStalenessMs": "USERNAME_BLOOM_MAX_STALENESS_MS",
  "identityBloom.username.rebuildBatchSize":
    "USERNAME_BLOOM_REBUILD_BATCH_SIZE",
  "identityBloom.username.rebuildIntervalMs":
    "USERNAME_BLOOM_REBUILD_INTERVAL_MS",
  "identityBloom.username.rebuildLockTtlMs":
    "USERNAME_BLOOM_REBUILD_LOCK_TTL_MS",
  "identityBloom.username.reloadIntervalMs":
    "USERNAME_BLOOM_RELOAD_INTERVAL_MS",
  "logging.fallbackDirectory": "LOG_FALLBACK_DIRECTORY",
  "logging.level": "LOG_LEVEL",
  "logging.serviceName": "LOG_SERVICE_NAME",
  "logging.silent": "LOG_SILENT",
  "oauth.google.clientIds": "GOOGLE_OAUTH_CLIENT_IDS",
  "oauth.microsoft.clientIds": "MICROSOFT_OAUTH_CLIENT_IDS",
  "oauth.microsoft.tenant": "MICROSOFT_OAUTH_TENANT",
  "postingsCache.followerPollIntervalMs":
    "POSTINGS_PUBLIC_CACHE_FOLLOWER_POLL_INTERVAL_MS",
  "postingsCache.followerWaitTimeoutMs":
    "POSTINGS_PUBLIC_CACHE_FOLLOWER_WAIT_TIMEOUT_MS",
  "postingsCache.freshTtlSeconds": "POSTINGS_PUBLIC_CACHE_FRESH_TTL_SECONDS",
  "postingsCache.negativeTtlSeconds":
    "POSTINGS_PUBLIC_CACHE_NEGATIVE_TTL_SECONDS",
  "postingsCache.rebuildLockTtlMs": "POSTINGS_PUBLIC_CACHE_REBUILD_LOCK_TTL_MS",
  "postingsCache.staleTtlSeconds": "POSTINGS_PUBLIC_CACHE_STALE_TTL_SECONDS",
  "postingsCache.ttlJitterRatio": "POSTINGS_PUBLIC_CACHE_TTL_JITTER_RATIO",
  "rateLimiter.bucketCapacity": "RATE_LIMITER_BUCKET_CAPACITY",
  "rateLimiter.enabled": "RATE_LIMITER_ENABLED",
  "rateLimiter.limit": "RATE_LIMITER_LIMIT",
  "rateLimiter.refillTokensPerSecond": "RATE_LIMITER_REFILL_TOKENS_PER_SECOND",
  "rateLimiter.strategy": "RATE_LIMITER_STRATEGY",
  "rateLimiter.windowSeconds": "RATE_LIMITER_WINDOW_SECONDS",
  "redis.connectTimeoutMs": "REDIS_CONNECT_TIMEOUT_MS",
  "redis.db": "REDIS_DB",
  "redis.host": "REDIS_HOST",
  "redis.port": "REDIS_PORT",
  "routeModules.disabledIds": "DISABLED_ROUTE_MODULES",
  "server.port": "PORT",
  "sms.fromNumber": "SMS_FROM_NUMBER",
  "sms.provider": "SMS_PROVIDER",
  "sms.telnyx.messagingProfileId": "TELNYX_MESSAGING_PROFILE_ID",
  "sms.telnyx.publicKey": "TELNYX_PUBLIC_KEY",
  "sms.webhookPublicUrl": "SMS_WEBHOOK_PUBLIC_URL",
  "square.environment": "SQUARE_ENVIRONMENT",
  "square.locationId": "SQUARE_LOCATION_ID",
  "square.webhookNotificationUrl": "SQUARE_WEBHOOK_NOTIFICATION_URL",
  "workers.analytics.batchSize": "POSTINGS_ANALYTICS_OUTBOX_BATCH_SIZE",
  "workers.analytics.pollIntervalMs":
    "POSTINGS_ANALYTICS_OUTBOX_POLL_INTERVAL_MS",
  "workers.bookingExpiry.batchSize": "BOOKING_REQUEST_EXPIRY_BATCH_SIZE",
  "workers.bookingExpiry.pollIntervalMs":
    "BOOKING_REQUEST_EXPIRY_POLL_INTERVAL_MS",
  "workers.email.maxAttempts": "EMAIL_MAX_ATTEMPTS",
  "workers.email.prefetch": "EMAIL_WORKER_PREFETCH",
  "workers.paymentsRepair.batchSize": "PAYMENTS_REPAIR_BATCH_SIZE",
  "workers.paymentsRepair.pollIntervalMs": "PAYMENTS_REPAIR_POLL_INTERVAL_MS",
  "workers.paymentsRetry.batchSize": "PAYMENTS_RETRY_BATCH_SIZE",
  "workers.paymentsRetry.pollIntervalMs": "PAYMENTS_RETRY_POLL_INTERVAL_MS",
  "workers.postingExpiry.batchSize": "POSTING_EXPIRY_BATCH_SIZE",
  "workers.postingExpiry.pollIntervalMs": "POSTING_EXPIRY_POLL_INTERVAL_MS",
  "workers.postingExpiry.reminderLeadDays": "POSTING_EXPIRY_REMINDER_LEAD_DAYS",
  "workers.postingsThumbnail.maxAttempts": "POSTINGS_THUMBNAIL_MAX_ATTEMPTS",
  "workers.postingsThumbnail.prefetch": "POSTINGS_THUMBNAIL_PREFETCH",
  "workers.payoutRelease.batchSize": "PAYOUT_RELEASE_BATCH_SIZE",
  "workers.payoutRelease.pollIntervalMs": "PAYOUT_RELEASE_POLL_INTERVAL_MS",
  "workers.recommendationsPrecompute.batchSize":
    "RECOMMENDATIONS_PRECOMPUTE_BATCH_SIZE",
  "workers.recommendationsPrecompute.pollIntervalMs":
    "RECOMMENDATIONS_PRECOMPUTE_POLL_INTERVAL_MS",
  "workers.savedSearchAlert.batchSize": "SAVED_SEARCH_ALERT_BATCH_SIZE",
  "workers.savedSearchAlert.dailyIntervalHours":
    "SAVED_SEARCH_ALERT_DAILY_INTERVAL_HOURS",
  "workers.savedSearchAlert.pollIntervalMs":
    "SAVED_SEARCH_ALERT_POLL_INTERVAL_MS",
  "workers.search.batchSize": "POSTINGS_SEARCH_OUTBOX_BATCH_SIZE",
  "workers.search.pollIntervalMs": "POSTINGS_SEARCH_OUTBOX_POLL_INTERVAL_MS",
  "workers.searchIndexer.batchSize": "POSTINGS_SEARCH_INDEXER_BATCH_SIZE",
  "workers.searchIndexer.concurrency": "POSTINGS_SEARCH_INDEXER_CONCURRENCY",
  "workers.searchIndexer.flushIntervalMs":
    "POSTINGS_SEARCH_INDEXER_FLUSH_INTERVAL_MS",
  "workers.searchIndexer.maxAttempts": "POSTINGS_SEARCH_INDEX_MAX_ATTEMPTS",
  "workers.searchIndexer.prefetch": "POSTINGS_SEARCH_INDEXER_PREFETCH",
  "workers.searchReconcile.batchSize": "POSTINGS_SEARCH_RECONCILE_BATCH_SIZE",
  "workers.searchReconcile.pollIntervalMs":
    "POSTINGS_SEARCH_RECONCILE_POLL_INTERVAL_MS",
  "workers.searchReindex.batchSize": "POSTINGS_SEARCH_REINDEX_BATCH_SIZE",
  "workers.searchReindex.pollIntervalMs":
    "POSTINGS_SEARCH_REINDEX_POLL_INTERVAL_MS",
  "workers.searchRelay.batchSize": "POSTINGS_SEARCH_RELAY_BATCH_SIZE",
  "workers.searchRelay.maxAttempts": "POSTINGS_SEARCH_RELAY_MAX_ATTEMPTS",
  "workers.searchRelay.pollIntervalMs":
    "POSTINGS_SEARCH_RELAY_POLL_INTERVAL_MS",
  "workers.sms.maxAttempts": "SMS_MAX_ATTEMPTS",
  "workers.sms.prefetch": "SMS_WORKER_PREFETCH",
} as const satisfies Record<string, EnvironmentVariableName>;

const KNOWN_FILE_KEYS = new Set<string>(
  Object.keys(FILE_KEY_TO_ENVIRONMENT_VARIABLE),
);

const ARRAY_FILE_KEYS = new Set([
  "auth.mfaBypassEmails",
  "captcha.allowedHosts",
  "cors.allowedOrigins",
  "csrf.allowedOrigins",
  "oauth.google.clientIds",
  "oauth.microsoft.clientIds",
  "routeModules.disabledIds",
]);

const OPTIONAL_FILE_KEYS = new Set([
  "auth.audience",
  "auth.issuer",
  "blobStorage.containerName",
  "elasticsearch.url",
  "elasticsearch.username",
  "sms.fromNumber",
  "sms.telnyx.messagingProfileId",
  "sms.telnyx.publicKey",
  "sms.webhookPublicUrl",
]);

const STRING_FILE_KEYS = new Set([
  "application.baseUrl",
  "application.frontendUrl",
  "application.name",
  "auth.audience",
  "auth.issuer",
  "auth.refreshTokenCachePrefix",
  "auth.refreshTokenMode",
  "blobStorage.containerName",
  "elasticsearch.indices.organizationBlogs",
  "elasticsearch.indices.organizations",
  "elasticsearch.indices.postings",
  "elasticsearch.indices.reports",
  "elasticsearch.url",
  "elasticsearch.username",
  "email.fromEmail",
  "email.fromName",
  "email.gmailUser",
  "logging.fallbackDirectory",
  "logging.level",
  "logging.serviceName",
  "oauth.microsoft.tenant",
  "rateLimiter.strategy",
  "redis.host",
  "sms.fromNumber",
  "sms.provider",
  "sms.telnyx.messagingProfileId",
  "sms.telnyx.publicKey",
  "sms.webhookPublicUrl",
  "square.environment",
  "square.locationId",
  "square.webhookNotificationUrl",
]);

function isMapping(value: unknown): value is ConfigurationDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeConfigurationDocuments(
  base: ConfigurationDocument,
  overlay: ConfigurationDocument,
): ConfigurationDocument {
  const merged: ConfigurationDocument = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    const existing = merged[key];
    merged[key] =
      isMapping(existing) && isMapping(value)
        ? mergeConfigurationDocuments(existing, value)
        : value;
  }

  return merged;
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

export function readConfigurationDocument(
  filePath: string,
): ConfigurationDocument {
  let parsedYaml: unknown;

  try {
    parsedYaml = yaml.load(readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read configuration file ${filePath}: ${message}`,
    );
  }

  const result = configurationDocumentSchema.safeParse(parsedYaml ?? {});
  if (!result.success) {
    throw new Error(
      `Invalid configuration file ${filePath}: ${formatZodIssues(result.error)}`,
    );
  }

  validateKnownConfigurationKeys(result.data, filePath);
  return result.data;
}

function validateKnownConfigurationKeys(
  document: ConfigurationDocument,
  filePath: string,
  prefix = "",
): void {
  for (const [key, value] of Object.entries(document)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (path === "features") {
      if (!isMapping(value)) {
        throw new Error(
          `Invalid configuration file ${filePath}: features must be a mapping.`,
        );
      }
      for (const [featureName, featureValue] of Object.entries(value)) {
        const result = featureSchema.safeParse(featureValue);
        if (!result.success) {
          throw new Error(
            `Invalid configuration file ${filePath}: features.${featureName}: ${formatZodIssues(result.error)}`,
          );
        }
      }
      continue;
    }

    if (KNOWN_FILE_KEYS.has(path)) {
      if (isMapping(value)) {
        throw new Error(
          `Invalid configuration file ${filePath}: ${path} must be a scalar, array, or null.`,
        );
      }
      validateConfigurationValueType(path, value, filePath);
      continue;
    }

    const isKnownParent = [...KNOWN_FILE_KEYS].some((knownPath) =>
      knownPath.startsWith(`${path}.`),
    );

    if (!isKnownParent || !isMapping(value)) {
      throw new Error(
        `Invalid configuration file ${filePath}: unknown key ${path}.`,
      );
    }

    validateKnownConfigurationKeys(value, filePath, path);
  }
}

function validateConfigurationValueType(
  path: string,
  value: unknown,
  filePath: string,
): void {
  if (value === null) {
    if (!OPTIONAL_FILE_KEYS.has(path)) {
      throw new Error(
        `Invalid configuration file ${filePath}: ${path} cannot be null.`,
      );
    }
    return;
  }

  if (ARRAY_FILE_KEYS.has(path)) {
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== "string")
    ) {
      throw new Error(
        `Invalid configuration file ${filePath}: ${path} must be an array of strings.`,
      );
    }
    return;
  }

  const variableName = (
    FILE_KEY_TO_ENVIRONMENT_VARIABLE as Readonly<Record<string, string>>
  )[path];
  const isBoolean =
    variableName.endsWith("_ENABLED") ||
    variableName === "DATABASE_AUTO_SEED_REFRESH" ||
    variableName === "LOG_SILENT" ||
    variableName === "TRUST_PROXY_HEADERS";
  if (isBoolean && typeof value !== "boolean") {
    throw new Error(
      `Invalid configuration file ${filePath}: ${path} must be a boolean.`,
    );
  }

  if (STRING_FILE_KEYS.has(path) && typeof value !== "string") {
    throw new Error(
      `Invalid configuration file ${filePath}: ${path} must be a string.`,
    );
  }

  if (!isBoolean && !STRING_FILE_KEYS.has(path) && typeof value !== "number") {
    throw new Error(
      `Invalid configuration file ${filePath}: ${path} must be a number.`,
    );
  }
}

function serializeConfigurationValue(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return String(value);
}

function readPath(document: ConfigurationDocument, path: string): unknown {
  let current: unknown = document;
  for (const segment of path.split(".")) {
    if (!isMapping(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export function flattenConfigurationDocument(
  document: ConfigurationDocument,
): LoadedFileConfiguration {
  const raw: RawEnvironmentValues = {};

  for (const [path, variableName] of Object.entries(
    FILE_KEY_TO_ENVIRONMENT_VARIABLE,
  )) {
    const serialized = serializeConfigurationValue(readPath(document, path));
    if (serialized !== undefined) {
      raw[variableName] = serialized;
    }
  }

  const features: Record<string, ConfigurationFeature> = {};
  const configuredFeatures = document.features;
  if (isMapping(configuredFeatures)) {
    for (const [name, value] of Object.entries(configuredFeatures)) {
      const feature = featureSchema.parse(value);
      features[normalizeFeatureName(name)] = {
        enabled: feature.enabled,
        source: "config",
      };
    }
  }

  return { raw, features };
}
