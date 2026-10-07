import {
  DEFAULT_ELASTICSEARCH_POSTINGS_INDEX,
  DEFAULT_REDIS_HOST,
  SUPPORTED_IMAGE_CONTENT_TYPES,
  isSupportedImageContentType,
} from "@/configuration/environment/constants";
import {
  normalizeDelimitedList,
  parseBoolean,
  parseCognitiveServicesEndpoint,
  parseNumber,
  parseStorageAccountUrl,
  parseStorageConnectionString,
} from "@/configuration/environment/shared";
import {
  BLOB_STORAGE_AUTH_MODES,
  MEDIA_MODERATION_AUTH_MODES,
  MEDIA_MODERATION_PROVIDERS,
  MEDIA_SCANNER_KINDS,
  PAYPAL_CHECKOUT_METHODS,
  type AppEnvironment,
  type BlobStorageAccount,
  type BlobStorageAuthMode,
  type MediaScannerKind,
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
  const auth = readBlobStorageAuthMode(raw);

  if (!auth) {
    errors.push(
      `AZURE_STORAGE_AUTH must be one of: ${BLOB_STORAGE_AUTH_MODES.join(", ")}.`,
    );
  }

  const containerName = raw.AZURE_STORAGE_CONTAINER_NAME?.trim() || undefined;
  const quarantineContainerName =
    raw.AZURE_STORAGE_QUARANTINE_CONTAINER_NAME?.trim() || undefined;

  return {
    auth: auth ?? "entra",
    // An unknown mode has already been reported; checking the account against
    // either mode's rules would only add a misleading second error.
    account: auth
      ? readBlobStorageAccount(
          raw,
          auth,
          containerName,
          quarantineContainerName,
          errors,
        )
      : undefined,
    containerName,
    quarantineContainerName,
    quarantineLegacyFallback: parseBoolean(
      raw.MEDIA_QUARANTINE_LEGACY_FALLBACK,
      false,
    ),
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

/**
 * Validates and parses the account for the chosen mode, so every blob setting
 * is checked when the environment loads, before any process does I/O.
 *
 * Client uploads go to their own private container, so whenever Azure is used
 * both containers must be named, and they must not be the same container.
 * Entra mode, the default, names the account by URL and refuses the connection
 * string outright: the point of the mode is that no process holds the account
 * key. A deployment that still sets one has to opt in to the deprecated
 * connection-string mode by name.
 */
function readBlobStorageAccount(
  raw: RawEnvironmentValues,
  auth: BlobStorageAuthMode,
  publicContainer: string | undefined,
  quarantineContainer: string | undefined,
  errors: string[],
): BlobStorageAccount | undefined {
  const entra = auth === "entra";
  const accountVariable = entra
    ? "AZURE_STORAGE_ACCOUNT_URL"
    : "AZURE_STORAGE_CONNECTION_STRING";
  const accountSetting = raw[accountVariable];
  const configured = [
    Boolean(accountSetting),
    Boolean(publicContainer),
    Boolean(quarantineContainer),
  ];

  if (entra && raw.AZURE_STORAGE_CONNECTION_STRING) {
    errors.push(
      "AZURE_STORAGE_CONNECTION_STRING must not be set when AZURE_STORAGE_AUTH is entra, the default. Move to Microsoft Entra ID with AZURE_STORAGE_ACCOUNT_URL, or set AZURE_STORAGE_AUTH=connection-string to keep the deprecated account-key mode.",
    );
  }

  if (configured.some(Boolean) && !configured.every(Boolean)) {
    errors.push(
      `${accountVariable}, AZURE_STORAGE_CONTAINER_NAME, and AZURE_STORAGE_QUARANTINE_CONTAINER_NAME must be configured together${entra ? "" : " when AZURE_STORAGE_AUTH is connection-string"}.`,
    );
  }

  if (
    publicContainer &&
    quarantineContainer &&
    publicContainer.toLowerCase() === quarantineContainer.toLowerCase()
  ) {
    errors.push(
      "AZURE_STORAGE_QUARANTINE_CONTAINER_NAME must differ from AZURE_STORAGE_CONTAINER_NAME.",
    );
  }

  if (!accountSetting) {
    return undefined;
  }

  if (entra) {
    const account = parseStorageAccountUrl(accountSetting);

    if (!account) {
      errors.push(
        "AZURE_STORAGE_ACCOUNT_URL must be an Azure Blob endpoint such as https://<account>.blob.core.windows.net.",
      );
      return undefined;
    }

    return configured.every(Boolean) ? { auth, ...account } : undefined;
  }

  const account = parseStorageConnectionString(accountSetting);

  if (!account) {
    errors.push(
      "AZURE_STORAGE_CONNECTION_STRING must be a storage connection string that includes AccountName and AccountKey.",
    );
    return undefined;
  }

  return configured.every(Boolean) ? { auth, ...account } : undefined;
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

/**
 * The malware scanner the media worker runs on each upload before decoding it.
 * `none` scans nothing and records the item as skipped. Whether production may
 * run with `none` is decided where the scanner is built
 * (createMalwareScanner), so only the media processing worker, the one
 * process that scans, refuses to start; every other process ignores this.
 */
export function buildMediaScanningConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["mediaScanning"] {
  const scannerValue = raw.MEDIA_SCANNER?.toLowerCase() ?? "none";
  let scanner: MediaScannerKind = "none";

  if (isMediaScannerKind(scannerValue)) {
    scanner = scannerValue;
  } else {
    errors.push(
      `MEDIA_SCANNER must be one of: ${MEDIA_SCANNER_KINDS.join(", ")}.`,
    );
  }

  return {
    scanner,
    clamavHost: raw.MEDIA_SCANNING_CLAMAV_HOST ?? "clamav",
    clamavPort: parseNumber(raw, "MEDIA_SCANNING_CLAMAV_PORT", 3_310, errors, {
      integer: true,
      min: 1,
      max: 65_535,
    }),
    timeoutMs: parseNumber(raw, "MEDIA_SCANNING_TIMEOUT_MS", 30_000, errors, {
      integer: true,
      min: 1,
    }),
    maxStreamBytes: parseNumber(
      raw,
      "MEDIA_SCANNING_MAX_STREAM_BYTES",
      25 * 1024 * 1024,
      errors,
      { integer: true, min: 1 },
    ),
    allowNone: parseBoolean(raw.MEDIA_SCANNING_ALLOW_NONE, false),
  };
}

function isMediaScannerKind(value: string): value is MediaScannerKind {
  return (MEDIA_SCANNER_KINDS as readonly string[]).includes(value);
}

const DEFAULT_MODERATION_BLOCK_AT_SEVERITY = 4;

type ModerationThresholdVariable =
  | "MEDIA_MODERATION_BLOCK_AT_HATE"
  | "MEDIA_MODERATION_BLOCK_AT_SEXUAL"
  | "MEDIA_MODERATION_BLOCK_AT_VIOLENCE"
  | "MEDIA_MODERATION_BLOCK_AT_SELF_HARM";

/**
 * Pre-publication moderation of each processed image. `none`, the default,
 * allows everything. Whether production may run with `none` is decided where
 * moderation is built (createImageModeration), as for the malware scanner.
 *
 * Every setting is checked here, but a problem is recorded rather than added
 * to `errors`: only the media processing worker moderates, so only it refuses
 * to start on one (createImageModeration), and the API and every other worker
 * start either way, as with the malware scanner. Like blob storage, entra mode
 * refuses an API key outright.
 */
export function buildMediaModerationConfig(
  raw: RawEnvironmentValues,
): AppEnvironment["mediaModeration"] {
  const problems: string[] = [];
  const provider = raw.MEDIA_MODERATION_PROVIDER?.toLowerCase() ?? "none";
  const auth = raw.MEDIA_MODERATION_AUTH?.toLowerCase() ?? "entra";
  const apiKey = raw.MEDIA_MODERATION_API_KEY;

  if (!(MEDIA_MODERATION_PROVIDERS as readonly string[]).includes(provider)) {
    problems.push(
      `MEDIA_MODERATION_PROVIDER must be one of: ${MEDIA_MODERATION_PROVIDERS.join(", ")}.`,
    );
  }

  if (!(MEDIA_MODERATION_AUTH_MODES as readonly string[]).includes(auth)) {
    problems.push(
      `MEDIA_MODERATION_AUTH must be one of: ${MEDIA_MODERATION_AUTH_MODES.join(", ")}.`,
    );
  }

  const endpoint = raw.MEDIA_MODERATION_ENDPOINT
    ? parseCognitiveServicesEndpoint(raw.MEDIA_MODERATION_ENDPOINT)
    : null;

  if (raw.MEDIA_MODERATION_ENDPOINT && !endpoint) {
    problems.push(
      "MEDIA_MODERATION_ENDPOINT must be an Azure AI services endpoint with a custom subdomain, such as https://<resource>.cognitiveservices.azure.com.",
    );
  } else if (!endpoint && provider === "azure-content-safety") {
    problems.push(
      "MEDIA_MODERATION_ENDPOINT is required when MEDIA_MODERATION_PROVIDER is azure-content-safety.",
    );
  }

  if (auth === "entra" && apiKey) {
    problems.push(
      "MEDIA_MODERATION_API_KEY must not be set when MEDIA_MODERATION_AUTH is entra, the default. Remove it, or set MEDIA_MODERATION_AUTH=api-key.",
    );
  }

  if (auth === "api-key" && provider === "azure-content-safety" && !apiKey) {
    problems.push(
      "MEDIA_MODERATION_API_KEY is required when MEDIA_MODERATION_AUTH is api-key.",
    );
  }

  const threshold = (name: ModerationThresholdVariable) =>
    parseNumber(raw, name, DEFAULT_MODERATION_BLOCK_AT_SEVERITY, problems, {
      integer: true,
      min: 0,
      max: 7,
    });
  const timeoutMs = parseNumber(
    raw,
    "MEDIA_MODERATION_TIMEOUT_MS",
    10_000,
    problems,
    { integer: true, min: 1 },
  );
  const blockAtSeverity = {
    hate: threshold("MEDIA_MODERATION_BLOCK_AT_HATE"),
    sexual: threshold("MEDIA_MODERATION_BLOCK_AT_SEXUAL"),
    violence: threshold("MEDIA_MODERATION_BLOCK_AT_VIOLENCE"),
    selfHarm: threshold("MEDIA_MODERATION_BLOCK_AT_SELF_HARM"),
  };

  if (problems.length > 0 || provider !== "azure-content-safety" || !endpoint) {
    return {
      setup: {
        provider: "none",
        allowNone: parseBoolean(raw.MEDIA_MODERATION_ALLOW_NONE, false),
      },
      problems,
    };
  }

  return {
    setup: {
      provider,
      endpoint: endpoint.origin,
      scope: endpoint.scope,
      auth:
        auth === "api-key" && apiKey
          ? { kind: "api-key", apiKey }
          : { kind: "entra" },
      timeoutMs,
      blockAtSeverity,
    },
    problems,
  };
}

/** The configured mode, entra when unset, or null when invalid. */
function readBlobStorageAuthMode(
  raw: RawEnvironmentValues,
): BlobStorageAuthMode | null {
  const value = raw.AZURE_STORAGE_AUTH?.toLowerCase() ?? "entra";

  return (BLOB_STORAGE_AUTH_MODES as readonly string[]).includes(value)
    ? (value as BlobStorageAuthMode)
    : null;
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
