import type { RouteModuleId } from "@/configuration/bootstrap/routes/types";

export type NodeEnvironment = "development" | "test" | "production";
export type RefreshTokenMode = "stateless" | "stateful";
export type AccessTokenAlgorithm = "HS256" | "RS256";
export type RateLimiterStrategy = "sliding-window" | "token-bucket";
export type LoggingMode = "console" | "rabbitmq";
export type SmsProvider = "noop" | "telnyx";
export const MEDIA_SCANNER_KINDS = ["clamav", "none"] as const;
export type MediaScannerKind = (typeof MEDIA_SCANNER_KINDS)[number];
export const MEDIA_MODERATION_PROVIDERS = [
  "none",
  "azure-content-safety",
] as const;
export type MediaModerationProvider =
  (typeof MEDIA_MODERATION_PROVIDERS)[number];
export const MEDIA_MODERATION_AUTH_MODES = ["entra", "api-key"] as const;
export type MediaModerationAuthMode =
  (typeof MEDIA_MODERATION_AUTH_MODES)[number];
export const BLOB_STORAGE_AUTH_MODES = ["connection-string", "entra"] as const;
export type BlobStorageAuthMode = (typeof BLOB_STORAGE_AUTH_MODES)[number];
/** A storage account as the environment layer parsed and validated it. */
export type BlobStorageAccount =
  | { auth: "entra"; accountName: string; serviceUrl: string }
  | {
      auth: "connection-string";
      accountName: string;
      accountKey: string;
      serviceUrl: string;
    };
export const PAYPAL_CHECKOUT_METHODS = [
  "paypal",
  "paypal_guest",
  "card",
] as const;
export type PayPalCheckoutMethod = (typeof PAYPAL_CHECKOUT_METHODS)[number];
export type ConfigurationFeatureSource = "config" | "env";

export type RawEnvironmentValues = {
  ACCESS_TOKEN_ALGORITHM?: string;
  ACCESS_TOKEN_PRIVATE_KEY?: string;
  ACCESS_TOKEN_PUBLIC_KEY?: string;
  ACCESS_TOKEN_SECRET?: string;
  ACCESS_TOKEN_TTL_SECONDS?: string;
  ALLOWED_IMAGE_TYPES?: string;
  APP_BASE_URL?: string;
  APP_NAME?: string;
  AZURE_STORAGE_ACCOUNT_URL?: string;
  AZURE_STORAGE_AUTH?: string;
  AZURE_STORAGE_CONNECTION_STRING?: string;
  AZURE_STORAGE_CONTAINER_NAME?: string;
  AZURE_STORAGE_QUARANTINE_CONTAINER_NAME?: string;
  MEDIA_QUARANTINE_LEGACY_FALLBACK?: string;
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
  DATABASE_POOL_CONNECTION_LIMIT?: string;
  DATABASE_POOL_MINIMUM_IDLE?: string;
  DATABASE_SLOW_OPERATION_THRESHOLD_MS?: string;
  DATABASE_SLOW_QUERY_THRESHOLD_MS?: string;
  DATABASE_URL?: string;
  DISABLED_ROUTE_MODULES?: string;
  ELASTICSEARCH_ENABLED?: string;
  ELASTICSEARCH_CIRCUIT_BREAKER_COOLDOWN_MS?: string;
  ELASTICSEARCH_CIRCUIT_BREAKER_FAILURE_THRESHOLD?: string;
  ELASTICSEARCH_PASSWORD?: string;
  ELASTICSEARCH_POSTINGS_INDEX?: string;
  ELASTICSEARCH_ORGANIZATIONS_INDEX?: string;
  ELASTICSEARCH_ORGANIZATION_BLOGS_INDEX?: string;
  ELASTICSEARCH_REPORTS_INDEX?: string;
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
  APPLE_OAUTH_CLIENT_ID?: string;
  APPLE_OAUTH_CLIENT_IDS?: string;
  APPLE_OAUTH_TEAM_ID?: string;
  APPLE_OAUTH_KEY_ID?: string;
  APPLE_OAUTH_PRIVATE_KEY?: string;
  LOG_FALLBACK_DIRECTORY?: string;
  LOG_LEVEL?: string;
  LOG_SILENT?: string;
  LOG_SERVICE_NAME?: string;
  MAX_IMAGE_HEIGHT?: string;
  MAX_IMAGE_PIXELS?: string;
  MAX_IMAGE_SIZE_BYTES?: string;
  MAX_IMAGE_WIDTH?: string;
  MAX_PROCESSED_IMAGE_EDGE?: string;
  MICROSOFT_OAUTH_CLIENT_ID?: string;
  MICROSOFT_OAUTH_CLIENT_IDS?: string;
  MICROSOFT_OAUTH_CLIENT_SECRET?: string;
  MFA_BYPASS_EMAILS?: string;
  MFA_TOTP_ENCRYPTION_KEY?: string;
  MICROSOFT_OAUTH_TENANT?: string;
  NODE_ENV?: string;
  PAYPAL_CHECKOUT_METHODS?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_ENVIRONMENT?: string;
  PAYPAL_WEBHOOK_ID?: string;
  PORT?: string;
  REQUEST_BODY_MAX_BYTES?: string;
  REQUEST_TIMEOUT_MS?: string;
  POSTING_EXPIRY_BATCH_SIZE?: string;
  POSTING_EXPIRY_POLL_INTERVAL_MS?: string;
  POSTING_EXPIRY_REMINDER_LEAD_DAYS?: string;
  SAVED_SEARCH_ALERT_POLL_INTERVAL_MS?: string;
  SAVED_SEARCH_ALERT_BATCH_SIZE?: string;
  SAVED_SEARCH_ALERT_DAILY_INTERVAL_HOURS?: string;
  POSTINGS_ANALYTICS_OUTBOX_BATCH_SIZE?: string;
  POSTINGS_ANALYTICS_OUTBOX_POLL_INTERVAL_MS?: string;
  RECOMMENDATIONS_PRECOMPUTE_BATCH_SIZE?: string;
  RECOMMENDATIONS_PRECOMPUTE_POLL_INTERVAL_MS?: string;
  POSTINGS_THUMBNAIL_PREFETCH?: string;
  POSTINGS_THUMBNAIL_MAX_ATTEMPTS?: string;
  MEDIA_PROCESSING_PREFETCH?: string;
  MEDIA_PROCESSING_MAX_ATTEMPTS?: string;
  MEDIA_CLEANUP_POLL_INTERVAL_MS?: string;
  MEDIA_CLEANUP_BATCH_SIZE?: string;
  MEDIA_CLEANUP_PENDING_UPLOAD_TTL_MS?: string;
  MEDIA_CLEANUP_STUCK_THRESHOLD_MS?: string;
  MEDIA_CLEANUP_MAX_REQUEUES?: string;
  MEDIA_CLEANUP_REJECTED_RETENTION_MS?: string;
  MEDIA_SCANNER?: string;
  MEDIA_SCANNING_ALLOW_NONE?: string;
  MEDIA_SCANNING_CLAMAV_HOST?: string;
  MEDIA_SCANNING_CLAMAV_PORT?: string;
  MEDIA_SCANNING_MAX_STREAM_BYTES?: string;
  MEDIA_SCANNING_TIMEOUT_MS?: string;
  MEDIA_MODERATION_API_KEY?: string;
  MEDIA_MODERATION_AUTH?: string;
  MEDIA_MODERATION_BLOCK_AT_HATE?: string;
  MEDIA_MODERATION_BLOCK_AT_SELF_HARM?: string;
  MEDIA_MODERATION_BLOCK_AT_SEXUAL?: string;
  MEDIA_MODERATION_BLOCK_AT_VIOLENCE?: string;
  MEDIA_MODERATION_ENDPOINT?: string;
  MEDIA_MODERATION_PROVIDER?: string;
  MEDIA_MODERATION_TIMEOUT_MS?: string;
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
  TELNYX_API_KEY?: string;
  TELNYX_MESSAGING_PROFILE_ID?: string;
  TELNYX_PUBLIC_KEY?: string;
  TOKEN_AUDIENCE?: string;
  TOKEN_ISSUER?: string;
  TRUST_PROXY_HEADERS?: string;
  USERNAME_BLOOM_ENABLED?: string;
  USERNAME_BLOOM_CAPACITY?: string;
  USERNAME_BLOOM_FALSE_POSITIVE_RATE?: string;
  USERNAME_BLOOM_RELOAD_INTERVAL_MS?: string;
  USERNAME_BLOOM_MAX_STALENESS_MS?: string;
  USERNAME_BLOOM_REBUILD_INTERVAL_MS?: string;
  USERNAME_BLOOM_REBUILD_BATCH_SIZE?: string;
  USERNAME_BLOOM_REBUILD_LOCK_TTL_MS?: string;
  EMAIL_BLOOM_ENABLED?: string;
  EMAIL_BLOOM_CAPACITY?: string;
  EMAIL_BLOOM_FALSE_POSITIVE_RATE?: string;
  EMAIL_BLOOM_RELOAD_INTERVAL_MS?: string;
  EMAIL_BLOOM_MAX_STALENESS_MS?: string;
  EMAIL_BLOOM_REBUILD_INTERVAL_MS?: string;
  EMAIL_BLOOM_REBUILD_BATCH_SIZE?: string;
  EMAIL_BLOOM_REBUILD_LOCK_TTL_MS?: string;
};

export type EnvironmentVariableName = keyof RawEnvironmentValues;

/** One identity bloom filter's settings; see `identity-bloom.service.ts`. */
export interface IdentityBloomEnvironment {
  enabled: boolean;
  capacity: number;
  falsePositiveRate: number;
  reloadIntervalMs: number;
  maxStalenessMs: number;
  rebuildIntervalMs: number;
  rebuildBatchSize: number;
  rebuildLockTtlMs: number;
}

export interface AppEnvironment {
  raw: RawEnvironmentValues;
  server: {
    nodeEnv: NodeEnvironment;
    port: number;
    isProduction: boolean;
  };
  application: {
    name: string;
    frontendUrl: string;
    baseUrl: string;
  };
  http: {
    requestTimeoutMs: number;
    requestBodyMaxBytes: number;
    trustProxyHeaders: boolean;
  };
  database: {
    url: string;
    autoSeedEnabled: boolean;
    autoSeedRefresh: boolean;
    operationLoggingEnabled: boolean;
    poolConnectionLimit: number;
    poolMinimumIdle: number;
    queryLoggingEnabled: boolean;
    slowOperationThresholdMs: number;
    slowQueryThresholdMs: number;
  };
  auth: {
    accessTokenAlgorithm: AccessTokenAlgorithm;
    accessTokenSecret?: string;
    accessTokenPrivateKey?: string;
    accessTokenPublicKey?: string;
    refreshTokenSecret: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlSeconds: number;
    rememberMeRefreshTokenTtlSeconds: number;
    issuer?: string;
    audience?: string;
    refreshTokenMode: RefreshTokenMode;
    refreshTokenCachePrefix: string;
    personalAccessTokenSecret: string;
    mfaBypassEmails: string[];
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
    apple: {
      audiences: string[];
      teamId?: string;
      keyId?: string;
      privateKey?: string;
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
    mediaProcessing: {
      prefetch: number;
      maxAttempts: number;
    };
    mediaCleanup: {
      pollIntervalMs: number;
      batchSize: number;
      pendingUploadTtlMs: number;
      stuckThresholdMs: number;
      maxRequeues: number;
      rejectedRetentionMs: number;
    };
    bookingExpiry: {
      pollIntervalMs: number;
      batchSize: number;
    };
    postingExpiry: {
      pollIntervalMs: number;
      batchSize: number;
      reminderLeadDays: number;
    };
    savedSearchAlert: {
      pollIntervalMs: number;
      batchSize: number;
      /**
       * Doubles as the `instant` cadence: a search set to instant is re-checked
       * every poll interval, so the sweep interval and the alert cadence are
       * one knob rather than two that can disagree.
       */
      dailyIntervalHours: number;
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
  usernameBloom: IdentityBloomEnvironment;
  emailBloom: IdentityBloomEnvironment;
  blobStorage: {
    /**
     * entra, the default, gives each process its own Microsoft Entra ID
     * identity through DefaultAzureCredential and signs uploads with a user
     * delegation key. connection-string signs everything with the account key
     * and is deprecated.
     */
    auth: BlobStorageAuthMode;
    /**
     * The account to reach, present only when the account setting and both
     * container names are configured and valid. Absent means Azure is not
     * configured; startup has already rejected anything in between.
     */
    account?: BlobStorageAccount;
    containerName?: string;
    quarantineContainerName?: string;
    /** Look for quarantine names in their pre-split location too. */
    quarantineLegacyFallback: boolean;
    uploadSasTtlSeconds: number;
  };
  imageUploads: {
    allowedContentTypes: string[];
    maxSizeBytes: number;
    maxWidth: number;
    maxHeight: number;
    maxPixels: number;
    maxProcessedEdge: number;
  };
  mediaScanning: {
    scanner: MediaScannerKind;
    clamavHost: string;
    clamavPort: number;
    timeoutMs: number;
    maxStreamBytes: number;
    allowNone: boolean;
  };
  mediaModeration: {
    provider: MediaModerationProvider;
    /**
     * The Content Safety resource's origin, such as
     * https://<resource>.cognitiveservices.azure.com. Present whenever it is
     * configured and valid; startup has refused azure-content-safety without
     * it.
     */
    endpoint?: string;
    /**
     * entra, the default, signs each request with the process's Microsoft
     * Entra ID identity; api-key sends apiKey instead.
     */
    auth: MediaModerationAuthMode;
    /** Present only in api-key mode. Environment-only, never in YAML. */
    apiKey?: string;
    timeoutMs: number;
    /**
     * The severity at or above which a category blocks an image. Content
     * Safety reports images as 0, 2, 4, or 6, so 7 never blocks, and 0 blocks
     * every image.
     */
    blockAtSeverity: {
      hate: number;
      sexual: number;
      violence: number;
      selfHarm: number;
    };
  };
  logging: {
    fallbackDirectory: string;
    level: "debug" | "info" | "warn" | "error" | "critical";
    mode: LoggingMode;
    serviceName: string;
    silent: boolean;
  };
  routeModules: {
    disabledIds: RouteModuleId[];
  };
  features: Record<
    string,
    { enabled: boolean; source: ConfigurationFeatureSource }
  >;
  rabbitmq: {
    url?: string;
  };
  elasticsearch: {
    enabled: boolean;
    url?: string;
    username?: string;
    password?: string;
    postingsIndexName: string;
    reportsIndexName: string;
    organizationsIndexName: string;
    organizationBlogsIndexName: string;
    timeoutMs: number;
    circuitBreakerFailureThreshold: number;
    circuitBreakerCooldownMs: number;
  };
  paypal: {
    clientId: string;
    clientSecret: string;
    environment: "sandbox" | "production";
    webhookId: string;
    apiBaseUrl: string;
    /** Embedded checkout methods offered to renters; the redirect is always on. */
    checkoutMethods: PayPalCheckoutMethod[];
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
