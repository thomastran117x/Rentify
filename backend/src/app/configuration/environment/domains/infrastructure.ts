import {
  DEFAULT_ELASTICSEARCH_POSTINGS_INDEX,
  DEFAULT_REDIS_HOST,
  SUPPORTED_IMAGE_CONTENT_TYPES,
  isSupportedImageContentType,
} from "@/configuration/environment/constants";
import {
  normalizeDelimitedList,
  parseBoolean,
  parseNumber,
} from "@/configuration/environment/shared";
import {
  PAYPAL_CHECKOUT_METHODS,
  type AppEnvironment,
  type NodeEnvironment,
  type PayPalCheckoutMethod,
  type RawEnvironmentValues,
  type SmsProvider,
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
  // Every process that connects owns its own pool, so these are per-process
  // costs. minimumIdle must stay at or above 1: the driver only grows a pool to
  // satisfy minimumIdle and never to satisfy a queued request, so a value of 0
  // stalls every acquire until it times out.
  const poolConnectionLimit = parseNumber(
    raw,
    "DATABASE_POOL_CONNECTION_LIMIT",
    10,
    errors,
    {
      integer: true,
      min: 1,
    },
  );
  const poolMinimumIdle = parseNumber(
    raw,
    "DATABASE_POOL_MINIMUM_IDLE",
    1,
    errors,
    {
      integer: true,
      min: 1,
    },
  );

  // The driver clamps a too-large minimumIdle silently, so surface it instead.
  if (poolMinimumIdle > poolConnectionLimit) {
    errors.push(
      "DATABASE_POOL_MINIMUM_IDLE must be less than or equal to DATABASE_POOL_CONNECTION_LIMIT.",
    );
  }

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
    poolConnectionLimit,
    poolMinimumIdle,
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

// The allow-list is intentionally a narrowing-only knob. Operators can drop a
// format they do not want, but they cannot re-enable one the codebase has no
// sniffer or extension mapping for (SVG, GIF, TIFF, HEIC), so the deliberate
// exclusions cannot be undone by configuration alone.
export function buildImageUploadsConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["imageUploads"] {
  const configured = normalizeDelimitedList(raw.ALLOWED_IMAGE_TYPES).map(
    (entry) => entry.toLowerCase(),
  );

  for (const entry of configured) {
    if (!isSupportedImageContentType(entry)) {
      errors.push(
        `ALLOWED_IMAGE_TYPES contains unsupported value ${entry}. Supported values: ${SUPPORTED_IMAGE_CONTENT_TYPES.join(", ")}.`,
      );
    }
  }

  return {
    allowedContentTypes: configured.length
      ? configured
      : [...SUPPORTED_IMAGE_CONTENT_TYPES],
    maxSizeBytes: parseNumber(
      raw,
      "MAX_IMAGE_SIZE_BYTES",
      5 * 1024 * 1024,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    maxWidth: parseNumber(raw, "MAX_IMAGE_WIDTH", 8_000, errors, {
      integer: true,
      min: 1,
    }),
    maxHeight: parseNumber(raw, "MAX_IMAGE_HEIGHT", 8_000, errors, {
      integer: true,
      min: 1,
    }),
    maxPixels: parseNumber(raw, "MAX_IMAGE_PIXELS", 40_000_000, errors, {
      integer: true,
      min: 1,
    }),
    maxProcessedEdge: parseNumber(
      raw,
      "MAX_PROCESSED_IMAGE_EDGE",
      2_560,
      errors,
      {
        integer: true,
        min: 256,
        max: 8_000,
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
  const postingsIndexName =
    raw.ELASTICSEARCH_POSTINGS_INDEX ?? DEFAULT_ELASTICSEARCH_POSTINGS_INDEX;

  return {
    enabled,
    url: raw.ELASTICSEARCH_URL?.replace(/\/+$/, ""),
    username: raw.ELASTICSEARCH_USERNAME,
    password: raw.ELASTICSEARCH_PASSWORD,
    postingsIndexName,
    reportsIndexName:
      raw.ELASTICSEARCH_REPORTS_INDEX ?? `${postingsIndexName}-reports`,
    organizationsIndexName:
      raw.ELASTICSEARCH_ORGANIZATIONS_INDEX ??
      `${postingsIndexName}-organizations`,
    organizationBlogsIndexName:
      raw.ELASTICSEARCH_ORGANIZATION_BLOGS_INDEX ??
      `${postingsIndexName}-organization-blogs`,
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

/** Card and PayPal work without extra account setup; wallets are opt-in. */
const DEFAULT_PAYPAL_CHECKOUT_METHODS: PayPalCheckoutMethod[] = [
  "paypal",
  "paypal_guest",
  "card",
];

function readPayPalCheckoutMethods(
  raw: RawEnvironmentValues,
  errors: string[],
): PayPalCheckoutMethod[] {
  if (raw.PAYPAL_CHECKOUT_METHODS === undefined) {
    return [...DEFAULT_PAYPAL_CHECKOUT_METHODS];
  }

  const values = raw.PAYPAL_CHECKOUT_METHODS.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const invalid = values.filter(
    (value) => !(PAYPAL_CHECKOUT_METHODS as readonly string[]).includes(value),
  );

  if (invalid.length > 0) {
    errors.push(
      `PAYPAL_CHECKOUT_METHODS contains unknown methods: ${invalid.join(", ")}.`,
    );
  }

  return [...new Set(values)].filter((value): value is PayPalCheckoutMethod =>
    (PAYPAL_CHECKOUT_METHODS as readonly string[]).includes(value),
  );
}

export function buildPayPalConfig(
  raw: RawEnvironmentValues,
  errors: string[],
  paypalClientId: string,
  paypalClientSecret: string,
  paypalWebhookId: string,
): AppEnvironment["paypal"] {
  const paypalEnvironment = raw.PAYPAL_ENVIRONMENT?.toLowerCase() ?? "sandbox";

  if (paypalEnvironment !== "sandbox" && paypalEnvironment !== "production") {
    errors.push("PAYPAL_ENVIRONMENT must be either sandbox or production.");
  }

  return {
    clientId: paypalClientId,
    clientSecret: paypalClientSecret,
    checkoutMethods: readPayPalCheckoutMethods(raw, errors),
    environment: paypalEnvironment === "production" ? "production" : "sandbox",
    webhookId: paypalWebhookId,
    apiBaseUrl:
      paypalEnvironment === "production"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com",
  };
}

export function buildSmsConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["sms"] {
  const providerValue = raw.SMS_PROVIDER?.toLowerCase();
  let provider: SmsProvider = "noop";

  if (providerValue === undefined || providerValue === "noop") {
    provider = "noop";
  } else if (providerValue === "telnyx") {
    provider = "telnyx";
  } else {
    errors.push("SMS_PROVIDER must be either noop or telnyx.");
  }

  if (provider === "telnyx") {
    if (!raw.SMS_FROM_NUMBER) {
      errors.push("SMS_FROM_NUMBER is required when SMS_PROVIDER is telnyx.");
    }

    if (!raw.TELNYX_API_KEY) {
      errors.push("TELNYX_API_KEY is required when SMS_PROVIDER is telnyx.");
    }

    if (!raw.TELNYX_PUBLIC_KEY) {
      errors.push("TELNYX_PUBLIC_KEY is required when SMS_PROVIDER is telnyx.");
    }
  }

  return {
    provider,
    fromNumber: raw.SMS_FROM_NUMBER,
    webhookPublicUrl: raw.SMS_WEBHOOK_PUBLIC_URL,
    telnyx: {
      apiKey: raw.TELNYX_API_KEY,
      publicKey: raw.TELNYX_PUBLIC_KEY,
      messagingProfileId: raw.TELNYX_MESSAGING_PROFILE_ID,
    },
  };
}
