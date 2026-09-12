import {
  buildAuthConfig,
  buildCaptchaConfig,
  buildCorsConfig,
  buildCsrfConfig,
  buildEmailConfig,
  buildOauthConfig,
  parseRefreshTokenMode,
} from "@/configuration/environment/domains/auth";
import {
  buildApplicationConfig,
  buildHttpConfig,
  buildLoggingConfig,
  buildRouteModulesConfig,
  buildServerConfig,
  parseNodeEnvironment,
} from "@/configuration/environment/domains/core";
import {
  buildBlobStorageConfig,
  buildDatabaseConfig,
  buildElasticsearchConfig,
  buildRabbitMqConfig,
  buildRedisConfig,
  buildSmsConfig,
  buildSquareConfig,
  validateInfrastructureConfig,
} from "@/configuration/environment/domains/infrastructure";
import { buildFeaturesConfig } from "@/configuration/environment/domains/features";
import {
  buildPostingsCacheConfig,
  buildRateLimiterConfig,
  buildEmailBloomConfig,
  buildUsernameBloomConfig,
  buildWorkerConfig,
  parseRateLimiterStrategy,
  validateRuntimeConfig,
} from "@/configuration/environment/domains/runtime";
import {
  normalizeRawEnvironment,
  readRequiredSecret,
  readRequiredString,
} from "@/configuration/environment/shared";
import type {
  AppEnvironment,
  EnvironmentState,
  RawEnvironmentValues,
} from "@/configuration/environment/types";

export function parseEnvironmentState(
  source: NodeJS.ProcessEnv,
  fileDefaults: RawEnvironmentValues = {},
  configuredFeatures: AppEnvironment["features"] = {},
): EnvironmentState {
  const environmentOverrides = normalizeRawEnvironment(source);
  const raw = {
    ...fileDefaults,
    ...environmentOverrides,
  };

  if (
    environmentOverrides.FRONTEND_URL &&
    !environmentOverrides.CORS_ALLOWED_ORIGINS
  ) {
    raw.CORS_ALLOWED_ORIGINS = environmentOverrides.FRONTEND_URL;
  }
  if (
    environmentOverrides.FRONTEND_URL &&
    !environmentOverrides.CSRF_ALLOWED_ORIGINS &&
    !environmentOverrides.CORS_ALLOWED_ORIGINS
  ) {
    raw.CSRF_ALLOWED_ORIGINS = environmentOverrides.FRONTEND_URL;
  }
  const errors: string[] = [];
  const nodeEnv = parseNodeEnvironment(raw, errors);
  const refreshTokenMode = parseRefreshTokenMode(raw, errors);
  const rateLimiterStrategy = parseRateLimiterStrategy(raw, errors);

  const databaseUrl = readRequiredString(raw, "DATABASE_URL", errors);
  const accessTokenSecret = readRequiredSecret(
    raw,
    "ACCESS_TOKEN_SECRET",
    errors,
  );
  const refreshTokenSecret = readRequiredSecret(
    raw,
    "REFRESH_TOKEN_SECRET",
    errors,
  );
  const personalAccessTokenSecret = readRequiredSecret(
    raw,
    "PERSONAL_ACCESS_TOKEN_SECRET",
    errors,
  );
  const mfaTotpEncryptionKeyRaw = raw.MFA_TOTP_ENCRYPTION_KEY;
  if (!mfaTotpEncryptionKeyRaw) {
    errors.push("MFA_TOTP_ENCRYPTION_KEY is required.");
  } else if (!/^[0-9a-fA-F]{64}$/.test(mfaTotpEncryptionKeyRaw)) {
    errors.push(
      "MFA_TOTP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).",
    );
  }
  const mfaTotpEncryptionKey = mfaTotpEncryptionKeyRaw ?? "";
  const gmailUser = readRequiredString(raw, "GMAIL_USER", errors);
  const gmailAppPassword = readRequiredString(
    raw,
    "GMAIL_APP_PASSWORD",
    errors,
  );
  const squareAccessToken = readRequiredString(
    raw,
    "SQUARE_ACCESS_TOKEN",
    errors,
  );
  const squareLocationId = readRequiredString(
    raw,
    "SQUARE_LOCATION_ID",
    errors,
  );
  const squareWebhookSignatureKey = readRequiredString(
    raw,
    "SQUARE_WEBHOOK_SIGNATURE_KEY",
    errors,
  );
  const squareWebhookNotificationUrl = readRequiredString(
    raw,
    "SQUARE_WEBHOOK_NOTIFICATION_URL",
    errors,
  );
  validateInfrastructureConfig(raw, nodeEnv, errors);

  const config: AppEnvironment = {
    raw,
    server: buildServerConfig(raw, nodeEnv, errors),
    application: buildApplicationConfig(raw),
    http: buildHttpConfig(raw, errors),
    database: buildDatabaseConfig(raw, nodeEnv, errors, databaseUrl),
    auth: buildAuthConfig(
      raw,
      errors,
      refreshTokenMode,
      accessTokenSecret,
      refreshTokenSecret,
      personalAccessTokenSecret,
      mfaTotpEncryptionKey,
    ),
    email: buildEmailConfig(raw, gmailUser, gmailAppPassword),
    sms: buildSmsConfig(raw, errors),
    captcha: buildCaptchaConfig(raw),
    cors: buildCorsConfig(raw),
    csrf: buildCsrfConfig(raw),
    oauth: buildOauthConfig(raw, errors),
    redis: buildRedisConfig(raw, errors),
    rateLimiter: buildRateLimiterConfig(raw, errors, rateLimiterStrategy),
    workers: buildWorkerConfig(raw, errors),
    postingsCache: buildPostingsCacheConfig(raw, errors),
    usernameBloom: buildUsernameBloomConfig(raw, errors),
    emailBloom: buildEmailBloomConfig(raw, errors),
    blobStorage: buildBlobStorageConfig(raw, errors),
    logging: buildLoggingConfig(raw, nodeEnv),
    routeModules: buildRouteModulesConfig(raw, errors),
    features: buildFeaturesConfig(source, configuredFeatures),
    rabbitmq: buildRabbitMqConfig(raw),
    elasticsearch: buildElasticsearchConfig(raw, errors),
    square: buildSquareConfig(
      raw,
      errors,
      squareAccessToken,
      squareLocationId,
      squareWebhookSignatureKey,
      squareWebhookNotificationUrl,
    ),
  };

  validateRuntimeConfig(config, errors);

  if (errors.length > 0) {
    throw new Error(
      [
        "Environment validation failed.",
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }

  return {
    raw,
    config,
  };
}

export function parseEnvironment(source: NodeJS.ProcessEnv): AppEnvironment {
  return parseEnvironmentState(source).config;
}
