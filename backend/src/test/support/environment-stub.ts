const tokenConfig = {
  accessTokenSecret: "test-access-secret-value-with-32chars",
  refreshTokenSecret: "test-refresh-secret-value-with-32c",
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
  rememberMeRefreshTokenTtlSeconds: 90 * 24 * 60 * 60,
  issuer: undefined,
  audience: undefined,
  refreshTokenMode: "stateful" as const,
  refreshTokenCachePrefix: "auth:refresh",
  personalAccessTokenSecret: "test-personal-access-token-secret-32",
};

const captchaConfig = {
  secretKey: "test-turnstile-secret",
  allowedHosts: ["challenges.cloudflare.com"],
};

const elasticsearchConfig = {
  enabled: false,
  url: "http://localhost:9200",
  username: undefined,
  password: undefined,
  postingsIndexName: "postings",
  timeoutMs: 2_000,
  circuitBreakerFailureThreshold: 3,
  circuitBreakerCooldownMs: 30_000,
};

const oauthConfig = {
  google: {
    frontendBaseUrl: "http://localhost:3000",
  },
};

const rateLimiterConfig = {
  enabled: true,
  strategy: "sliding-window" as const,
  limit: 60,
  windowSeconds: 60,
  bucketCapacity: 60,
  refillTokensPerSecond: 1,
};

const squareConfig = {
  accessToken: "square-test-access-token",
  locationId: "square-test-location",
  webhookSignatureKey: "square-test-signature-key",
  webhookNotificationUrl: "http://localhost:8080/api/v1/payments/webhook",
  apiBaseUrl: "https://connect.squareupsandbox.com",
};

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }

  if (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }

  return fallback;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (value == null) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readNodeEnvironment() {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  return nodeEnv === "production" ||
    nodeEnv === "test" ||
    nodeEnv === "development"
    ? nodeEnv
    : "development";
}

function readLoggingConfig() {
  const nodeEnv = readNodeEnvironment();

  return {
    fallbackDirectory:
      process.env.LOG_FALLBACK_DIRECTORY ?? "C:/tmp/rent-test-logs",
    level:
      (process.env.LOG_LEVEL as
        | "debug"
        | "info"
        | "warn"
        | "error"
        | "critical"
        | undefined) ?? "debug",
    mode:
      nodeEnv === "production" ? ("rabbitmq" as const) : ("console" as const),
    serviceName: process.env.LOG_SERVICE_NAME ?? "backend-test",
  };
}

function readRabbitMqConfig() {
  return {
    url: process.env.RABBITMQ_URL ?? "amqp://localhost:5672",
  };
}

function readDatabaseConfig() {
  return {
    autoSeedEnabled: readBoolean(process.env.DATABASE_AUTO_SEED_ENABLED, true),
    autoSeedRefresh: readBoolean(process.env.DATABASE_AUTO_SEED_REFRESH, false),
    operationLoggingEnabled: readBoolean(
      process.env.DATABASE_OPERATION_LOGGING_ENABLED,
      false,
    ),
    queryLoggingEnabled: readBoolean(
      process.env.DATABASE_QUERY_LOGGING_ENABLED,
      false,
    ),
    slowOperationThresholdMs: readNumber(
      process.env.DATABASE_SLOW_OPERATION_THRESHOLD_MS,
      500,
    ),
    slowQueryThresholdMs: readNumber(
      process.env.DATABASE_SLOW_QUERY_THRESHOLD_MS,
      250,
    ),
    url:
      process.env.DATABASE_URL ??
      "mysql://user:password@localhost:3306/rent_test",
  };
}

function readRouteModulesConfig() {
  const configuredIds = (process.env.DISABLED_ROUTE_MODULES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    disabledIds: Array.from(new Set(configuredIds)),
  };
}

export const environment = {
  isProduction(): boolean {
    return readNodeEnvironment() === "production";
  },
  isDevelopment(): boolean {
    return readNodeEnvironment() === "development";
  },
  isTest(): boolean {
    return readNodeEnvironment() === "test";
  },
  getNodeEnvironment() {
    return readNodeEnvironment();
  },
  getServerPort() {
    return 8040;
  },
  getDatabaseConfig() {
    return readDatabaseConfig();
  },
  getTokenConfig() {
    return tokenConfig;
  },
  getCaptchaConfig() {
    return captchaConfig;
  },
  getRateLimiterConfig() {
    return rateLimiterConfig;
  },
  getLoggingConfig() {
    return readLoggingConfig();
  },
  getRabbitMqConfig() {
    return readRabbitMqConfig();
  },
  getElasticsearchConfig() {
    return elasticsearchConfig;
  },
  getSquareConfig() {
    return squareConfig;
  },
  getRouteModulesConfig() {
    return readRouteModulesConfig();
  },
  load() {
    return {
      auth: tokenConfig,
      captcha: captchaConfig,
      database: readDatabaseConfig(),
      elasticsearch: elasticsearchConfig,
      logging: readLoggingConfig(),
      oauth: oauthConfig,
      routeModules: readRouteModulesConfig(),
      rabbitmq: readRabbitMqConfig(),
      rateLimiter: rateLimiterConfig,
      server: {
        nodeEnv: readNodeEnvironment(),
        isProduction: readNodeEnvironment() === "production",
      },
      square: squareConfig,
    };
  },
  get() {
    return this.load();
  },
};

export function loadEnvironment() {
  return environment.load();
}

export function getEnvironment() {
  return environment.get();
}

export function getOptionalEnvironmentVariable(name: string) {
  return process.env[name];
}
