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
  mfaBypassEmails: [],
  mfaTotpEncryptionKey:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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
  reportsIndexName: "postings-reports",
  organizationsIndexName: "postings-organizations",
  organizationBlogsIndexName: "postings-organization-blogs",
  timeoutMs: 2_000,
  circuitBreakerFailureThreshold: 3,
  circuitBreakerCooldownMs: 30_000,
};

const oauthConfig = {
  google: {
    audiences: [],
    clientSecret: undefined,
    frontendBaseUrl: "http://localhost:3000",
  },
  microsoft: {
    audiences: [],
    clientSecret: undefined,
    tenant: "consumers",
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
  environment: "sandbox" as const,
  locationId: "square-test-location",
  webhookSignatureKey: "square-test-signature-key",
  webhookNotificationUrl: "http://localhost:8080/api/v1/payments/webhook",
  apiBaseUrl: "https://connect.squareupsandbox.com",
};

const smsConfig = {
  provider: "noop" as const,
  fromNumber: undefined,
  webhookPublicUrl: undefined,
  telnyx: {
    apiKey: undefined,
    publicKey: undefined,
    messagingProfileId: undefined,
  },
};

const applicationConfig = {
  name: "Rent",
  frontendUrl: "http://localhost:3040",
  baseUrl: "http://localhost:3040",
};

function readApplicationConfig() {
  const frontendUrl = process.env.FRONTEND_URL ?? applicationConfig.frontendUrl;

  return {
    ...applicationConfig,
    frontendUrl,
    baseUrl: process.env.APP_BASE_URL ?? frontendUrl,
  };
}

function readOriginList(value: string | undefined, fallback: string): string[] {
  return (value ?? fallback)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function readElasticsearchConfig() {
  const postingsIndexName =
    process.env.ELASTICSEARCH_INDEX ?? elasticsearchConfig.postingsIndexName;

  return {
    ...elasticsearchConfig,
    postingsIndexName,
    reportsIndexName:
      process.env.ELASTICSEARCH_REPORTS_INDEX ?? `${postingsIndexName}-reports`,
    organizationsIndexName:
      process.env.ELASTICSEARCH_ORGANIZATIONS_INDEX ??
      `${postingsIndexName}-organizations`,
    organizationBlogsIndexName:
      process.env.ELASTICSEARCH_ORGANIZATION_BLOGS_INDEX ??
      `${postingsIndexName}-organization-blogs`,
  };
}

function readGoogleOAuthConfig() {
  const clientIds =
    process.env.GOOGLE_OAUTH_CLIENT_IDS ?? process.env.GOOGLE_OAUTH_CLIENT_ID;

  return {
    audiences: readOriginList(clientIds, ""),
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    frontendBaseUrl: readApplicationConfig().frontendUrl,
  };
}

function readMicrosoftOAuthConfig() {
  const clientIds =
    process.env.MICROSOFT_OAUTH_CLIENT_IDS ??
    process.env.MICROSOFT_OAUTH_CLIENT_ID;

  return {
    audiences: readOriginList(clientIds, ""),
    clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
    tenant: process.env.MICROSOFT_OAUTH_TENANT ?? "consumers",
    frontendBaseUrl: readApplicationConfig().frontendUrl,
  };
}

function readBlobStorageConfig() {
  return {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    containerName: process.env.AZURE_STORAGE_CONTAINER_NAME,
    uploadSasTtlSeconds: readNumber(
      process.env.AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS,
      15 * 60,
    ),
  };
}

function readHttpConfig() {
  return {
    requestTimeoutMs: readNumber(process.env.REQUEST_TIMEOUT_MS, 15_000),
    requestBodyMaxBytes: readNumber(
      process.env.REQUEST_BODY_MAX_BYTES,
      1024 * 1024,
    ),
    trustProxyHeaders: readBoolean(process.env.TRUST_PROXY_HEADERS, false),
  };
}

const emailConfig = {
  gmailUser: "test@example.com",
  gmailAppPassword: "test-password",
  fromEmail: "test@example.com",
  fromName: "Rent",
  appBaseUrl: "http://localhost:3000",
};

const blobStorageConfig = {
  connectionString: undefined,
  containerName: undefined,
  uploadSasTtlSeconds: 15 * 60,
};

const identityBloomConfig = {
  enabled: true,
  capacity: 200_000,
  falsePositiveRate: 0.01,
  reloadIntervalMs: 60_000,
  maxStalenessMs: 300_000,
  rebuildIntervalMs: 21_600_000,
  rebuildBatchSize: 5_000,
  rebuildLockTtlMs: 60_000,
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
    silent: readBoolean(process.env.LOG_SILENT, false),
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
    poolConnectionLimit: readNumber(
      process.env.DATABASE_POOL_CONNECTION_LIMIT,
      10,
    ),
    poolMinimumIdle: readNumber(process.env.DATABASE_POOL_MINIMUM_IDLE, 1),
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

function readFeaturesConfig() {
  const features: Record<string, { enabled: boolean; source: "env" }> = {};
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^FEATURE_(.+)_ENABLED$/);
    if (match) {
      const featureId = match[1].toLowerCase().replace(/_/g, "-");
      features[featureId] = {
        enabled: readBoolean(value, false),
        source: "env",
      };
    }
  }
  return features;
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
  getApplicationConfig() {
    return readApplicationConfig();
  },
  getHttpConfig() {
    return readHttpConfig();
  },
  getDatabaseConfig() {
    return readDatabaseConfig();
  },
  getTokenConfig() {
    return tokenConfig;
  },
  getSmsConfig() {
    return smsConfig;
  },
  getEmailConfig() {
    return emailConfig;
  },
  getBlobStorageConfig() {
    return readBlobStorageConfig();
  },
  getCorsAllowedOrigins() {
    return readOriginList(
      process.env.CORS_ALLOWED_ORIGINS,
      readApplicationConfig().frontendUrl,
    );
  },
  getCsrfAllowedOrigins() {
    return readOriginList(
      process.env.CSRF_ALLOWED_ORIGINS ?? process.env.CORS_ALLOWED_ORIGINS,
      readApplicationConfig().frontendUrl,
    );
  },
  getGoogleOAuthConfig() {
    return readGoogleOAuthConfig();
  },
  getMicrosoftOAuthConfig() {
    return readMicrosoftOAuthConfig();
  },
  getCaptchaConfig() {
    return captchaConfig;
  },
  getSmsWorkerConfig() {
    return {
      prefetch: 10,
      maxAttempts: 8,
    };
  },
  getRateLimiterConfig() {
    return rateLimiterConfig;
  },
  getUsernameBloomConfig() {
    return identityBloomConfig;
  },
  getEmailBloomConfig() {
    return identityBloomConfig;
  },
  getLoggingConfig() {
    return readLoggingConfig();
  },
  getRabbitMqConfig() {
    return readRabbitMqConfig();
  },
  getElasticsearchConfig() {
    return readElasticsearchConfig();
  },
  getSquareConfig() {
    return squareConfig;
  },
  getRouteModulesConfig() {
    return readRouteModulesConfig();
  },
  getFeaturesConfig() {
    return readFeaturesConfig();
  },
  load() {
    return {
      auth: tokenConfig,
      application: applicationConfig,
      http: readHttpConfig(),
      email: emailConfig,
      blobStorage: blobStorageConfig,
      captcha: captchaConfig,
      database: readDatabaseConfig(),
      elasticsearch: elasticsearchConfig,
      logging: readLoggingConfig(),
      sms: smsConfig,
      oauth: oauthConfig,
      routeModules: readRouteModulesConfig(),
      features: readFeaturesConfig(),
      rabbitmq: readRabbitMqConfig(),
      rateLimiter: rateLimiterConfig,
      server: {
        nodeEnv: readNodeEnvironment(),
        isProduction: readNodeEnvironment() === "production",
      },
      square: squareConfig,
      usernameBloom: identityBloomConfig,
      emailBloom: identityBloomConfig,
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
