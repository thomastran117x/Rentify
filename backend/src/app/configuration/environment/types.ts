import type { RouteModuleId } from "@/configuration/bootstrap/routes/types";

export type NodeEnvironment = "development" | "test" | "production";
export type RefreshTokenMode = "stateless" | "stateful";
export type RateLimiterStrategy = "sliding-window" | "token-bucket";
export type LoggingMode = "console" | "rabbitmq";
export type SmsProvider = "noop" | "telnyx";

export type RawEnvironmentValues = {
  ACCESS_TOKEN_SECRET?: string;
  ACCESS_TOKEN_TTL_SECONDS?: string;
  APP_BASE_URL?: string;
  AZURE_STORAGE_CONNECTION_STRING?: string;
  AZURE_STORAGE_CONTAINER_NAME?: string;
  AZURE_STORAGE_UPLOAD_SAS_TTL_SECONDS?: string;
  BOOKING_REQUEST_EXPIRY_BATCH_SIZE?: string;
  BOOKING_REQUEST_EXPIRY_POLL_INTERVAL_MS?: string;
  CAPTCHA_ALLOWED_HOSTS?: string;
  CLOUDFLARE_TURNSTILE_SECRET_KEY?: string;
  CORS_ALLOWED_ORIGINS?: string;
  CSRF_ALLOWED_ORIGINS?: string;
  DATABASE_OPERATION_LOGGING_ENABLED?: string;
  DATABASE_QUERY_LOGGING_ENABLED?: string;
  DATABASE_AUTO_SEED_ENABLED?: string;
  DATABASE_AUTO_SEED_REFRESH?: string;
  DATABASE_SLOW_OPERATION_THRESHOLD_MS?: string;
  DATABASE_SLOW_QUERY_THRESHOLD_MS?: string;
  DATABASE_URL?: string;
  DISABLED_ROUTE_MODULES?: string;
  ELASTICSEARCH_ENABLED?: string;
  ELASTICSEARCH_CIRCUIT_BREAKER_COOLDOWN_MS?: string;
  ELASTICSEARCH_CIRCUIT_BREAKER_FAILURE_THRESHOLD?: string;
  ELASTICSEARCH_PASSWORD?: string;
  ELASTICSEARCH_POSTINGS_INDEX?: string;
  ELASTICSEARCH_TIMEOUT_MS?: string;
  ELASTICSEARCH_URL?: string;
  ELASTICSEARCH_USERNAME?: string;
  EMAIL_WORKER_PREFETCH?: string;
  EMAIL_MAX_ATTEMPTS?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  SMS_FROM_NUMBER?: string;
  SMS_MAX_ATTEMPTS?: string;
  SMS_PROVIDER?: string;
  SMS_WEBHOOK_PUBLIC_URL?: string;
  SMS_WORKER_PREFETCH?: string;
  FRONTEND_URL?: string;
  GMAIL_APP_PASSWORD?: string;
  GMAIL_USER?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_IDS?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  LOG_FALLBACK_DIRECTORY?: string;
  LOG_LEVEL?: string;
  LOG_SERVICE_NAME?: string;
  MICROSOFT_OAUTH_CLIENT_ID?: string;
  MICROSOFT_OAUTH_CLIENT_IDS?: string;
  MICROSOFT_OAUTH_CLIENT_SECRET?: string;
  MFA_TOTP_ENCRYPTION_KEY?: string;
  MICROSOFT_OAUTH_TENANT?: string;
  NODE_ENV?: string;
  PORT?: string;
  POSTINGS_ANALYTICS_OUTBOX_BATCH_SIZE?: string;
  POSTINGS_ANALYTICS_OUTBOX_POLL_INTERVAL_MS?: string;
  RECOMMENDATIONS_PRECOMPUTE_BATCH_SIZE?: string;
  RECOMMENDATIONS_PRECOMPUTE_POLL_INTERVAL_MS?: string;
  POSTINGS_THUMBNAIL_PREFETCH?: string;
  POSTINGS_THUMBNAIL_MAX_ATTEMPTS?: string;
  POSTINGS_PUBLIC_CACHE_FRESH_TTL_SECONDS?: string;
  POSTINGS_PUBLIC_CACHE_STALE_TTL_SECONDS?: string;
  POSTINGS_PUBLIC_CACHE_REBUILD_LOCK_TTL_MS?: string;
  POSTINGS_PUBLIC_CACHE_FOLLOWER_WAIT_TIMEOUT_MS?: string;
  POSTINGS_PUBLIC_CACHE_FOLLOWER_POLL_INTERVAL_MS?: string;
  POSTINGS_PUBLIC_CACHE_NEGATIVE_TTL_SECONDS?: string;
  POSTINGS_PUBLIC_CACHE_TTL_JITTER_RATIO?: string;
  POSTINGS_SEARCH_OUTBOX_BATCH_SIZE?: string;
  POSTINGS_SEARCH_OUTBOX_POLL_INTERVAL_MS?: string;
  POSTINGS_SEARCH_INDEXER_PREFETCH?: string;
  POSTINGS_SEARCH_INDEXER_BATCH_SIZE?: string;
  POSTINGS_SEARCH_INDEXER_FLUSH_INTERVAL_MS?: string;
  POSTINGS_SEARCH_INDEXER_CONCURRENCY?: string;
  POSTINGS_SEARCH_INDEX_MAX_ATTEMPTS?: string;
  POSTINGS_SEARCH_RECONCILE_BATCH_SIZE?: string;
  POSTINGS_SEARCH_RECONCILE_POLL_INTERVAL_MS?: string;
  POSTINGS_SEARCH_REINDEX_BATCH_SIZE?: string;
  POSTINGS_SEARCH_REINDEX_POLL_INTERVAL_MS?: string;
  POSTINGS_SEARCH_RELAY_BATCH_SIZE?: string;
  POSTINGS_SEARCH_RELAY_MAX_ATTEMPTS?: string;
  POSTINGS_SEARCH_RELAY_POLL_INTERVAL_MS?: string;
  PAYMENTS_RETRY_BATCH_SIZE?: string;
  PAYMENTS_RETRY_POLL_INTERVAL_MS?: string;
  PAYMENTS_REPAIR_BATCH_SIZE?: string;
  PAYMENTS_REPAIR_POLL_INTERVAL_MS?: string;
  PAYOUT_RELEASE_BATCH_SIZE?: string;
  PAYOUT_RELEASE_POLL_INTERVAL_MS?: string;
  RABBITMQ_URL?: string;
  RATE_LIMITER_BUCKET_CAPACITY?: string;
  RATE_LIMITER_ENABLED?: string;
  RATE_LIMITER_LIMIT?: string;
  RATE_LIMITER_REFILL_TOKENS_PER_SECOND?: string;
  RATE_LIMITER_STRATEGY?: string;
  RATE_LIMITER_WINDOW_SECONDS?: string;
  REDIS_CONNECT_TIMEOUT_MS?: string;
  REDIS_DB?: string;
  REDIS_HOST?: string;
  REDIS_PASSWORD?: string;
  REDIS_PORT?: string;
  REDIS_URL?: string;
  REFRESH_TOKEN_CACHE_PREFIX?: string;
  REFRESH_TOKEN_MODE?: string;
  REFRESH_TOKEN_SECRET?: string;
  PERSONAL_ACCESS_TOKEN_SECRET?: string;
  REMEMBER_ME_REFRESH_TOKEN_TTL_SECONDS?: string;
  REFRESH_TOKEN_TTL_SECONDS?: string;
  SQUARE_ACCESS_TOKEN?: string;
  SQUARE_ENVIRONMENT?: string;
  SQUARE_LOCATION_ID?: string;
  SQUARE_WEBHOOK_NOTIFICATION_URL?: string;
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string;
  TELNYX_API_KEY?: string;
  TELNYX_MESSAGING_PROFILE_ID?: string;
  TELNYX_PUBLIC_KEY?: string;
  TOKEN_AUDIENCE?: string;
  TOKEN_ISSUER?: string;
  TRUST_PROXY_HEADERS?: string;
};

export type EnvironmentVariableName = keyof RawEnvironmentValues;

export interface AppEnvironment {
  raw: RawEnvironmentValues;
  server: {
    nodeEnv: NodeEnvironment;
    port: number;
    isProduction: boolean;
  };
  database: {
    url: string;
    autoSeedEnabled: boolean;
    autoSeedRefresh: boolean;
    operationLoggingEnabled: boolean;
    queryLoggingEnabled: boolean;
    slowOperationThresholdMs: number;
    slowQueryThresholdMs: number;
  };
  auth: {
    accessTokenSecret: string;
    refreshTokenSecret: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlSeconds: number;
    rememberMeRefreshTokenTtlSeconds: number;
    issuer?: string;
    audience?: string;
    refreshTokenMode: RefreshTokenMode;
    refreshTokenCachePrefix: string;
    personalAccessTokenSecret: string;
    mfaTotpEncryptionKey: string;
  };
  email: {
    gmailUser: string;
    gmailAppPassword: string;
    fromEmail: string;
    fromName: string;
    appBaseUrl: string;
  };
  sms: {
    provider: SmsProvider;
    fromNumber?: string;
    webhookPublicUrl?: string;
    telnyx: {
      apiKey?: string;
      publicKey?: string;
      messagingProfileId?: string;
    };
  };
  captcha: {
    secretKey?: string;
    allowedHosts: string[];
  };
  cors: {
    allowedOrigins: string[];
  };
  csrf: {
    allowedOrigins: string[];
  };
  oauth: {
    google: {
      audiences: string[];
      clientSecret?: string;
      frontendBaseUrl: string;
    };
    microsoft: {
      audiences: string[];
      clientSecret?: string;
      tenant: string;
      frontendBaseUrl: string;
    };
  };
  redis: {
    url: string;
    host: string;
    port: number;
    password?: string;
    db: number;
    connectTimeoutMs: number;
  };
  rateLimiter: {
    enabled: boolean;
    strategy: RateLimiterStrategy;
    limit: number;
    windowSeconds: number;
    bucketCapacity: number;
    refillTokensPerSecond: number;
  };
  workers: {
    search: {
      pollIntervalMs: number;
      batchSize: number;
    };
    searchRelay: {
      pollIntervalMs: number;
      batchSize: number;
      maxAttempts: number;
    };
    searchIndexer: {
      prefetch: number;
      batchSize: number;
      flushIntervalMs: number;
      concurrency: number;
      maxAttempts: number;
    };
    searchReconcile: {
      pollIntervalMs: number;
      batchSize: number;
    };
    searchReindex: {
      pollIntervalMs: number;
      batchSize: number;
    };
    email: {
      prefetch: number;
      maxAttempts: number;
    };
    sms: {
      prefetch: number;
      maxAttempts: number;
    };
    analytics: {
      pollIntervalMs: number;
      batchSize: number;
    };
    recommendationsPrecompute: {
      pollIntervalMs: number;
      batchSize: number;
    };
    postingsThumbnail: {
      prefetch: number;
      maxAttempts: number;
    };
    bookingExpiry: {
      pollIntervalMs: number;
      batchSize: number;
    };
    paymentsRetry: {
      pollIntervalMs: number;
      batchSize: number;
    };
    paymentsRepair: {
      pollIntervalMs: number;
      batchSize: number;
    };
    payoutRelease: {
      pollIntervalMs: number;
      batchSize: number;
    };
  };
  postingsCache: {
    freshTtlSeconds: number;
    staleTtlSeconds: number;
    rebuildLockTtlMs: number;
    followerWaitTimeoutMs: number;
    followerPollIntervalMs: number;
    negativeTtlSeconds: number;
    ttlJitterRatio: number;
  };
  blobStorage: {
    connectionString?: string;
    containerName?: string;
    uploadSasTtlSeconds: number;
  };
  logging: {
    fallbackDirectory: string;
    level: "debug" | "info" | "warn" | "error" | "critical";
    mode: LoggingMode;
    serviceName: string;
  };
  routeModules: {
    disabledIds: RouteModuleId[];
  };
  features: Record<string, { enabled: boolean }>;
  rabbitmq: {
    url?: string;
  };
  elasticsearch: {
    enabled: boolean;
    url?: string;
    username?: string;
    password?: string;
    postingsIndexName: string;
    timeoutMs: number;
    circuitBreakerFailureThreshold: number;
    circuitBreakerCooldownMs: number;
  };
  square: {
    accessToken: string;
    environment: "sandbox" | "production";
    locationId: string;
    webhookSignatureKey: string;
    webhookNotificationUrl: string;
    apiBaseUrl: string;
  };
}

export interface EnvironmentState {
  raw: RawEnvironmentValues;
  config: AppEnvironment;
}

export type NumberOptions = {
  integer?: boolean;
  max?: number;
  min?: number;
};
