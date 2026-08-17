import {
  DEFAULT_POSTINGS_PUBLIC_CACHE_FOLLOWER_POLL_INTERVAL_MS,
  DEFAULT_POSTINGS_PUBLIC_CACHE_FOLLOWER_WAIT_TIMEOUT_MS,
  DEFAULT_POSTINGS_PUBLIC_CACHE_FRESH_TTL_SECONDS,
  DEFAULT_POSTINGS_PUBLIC_CACHE_NEGATIVE_TTL_SECONDS,
  DEFAULT_POSTINGS_PUBLIC_CACHE_REBUILD_LOCK_TTL_MS,
  DEFAULT_POSTINGS_PUBLIC_CACHE_STALE_TTL_SECONDS,
  DEFAULT_POSTINGS_PUBLIC_CACHE_TTL_JITTER_RATIO,
  DEFAULT_USERNAME_BLOOM_CAPACITY,
  DEFAULT_USERNAME_BLOOM_FALSE_POSITIVE_RATE,
  DEFAULT_USERNAME_BLOOM_MAX_STALENESS_MS,
  DEFAULT_USERNAME_BLOOM_REBUILD_BATCH_SIZE,
  DEFAULT_USERNAME_BLOOM_REBUILD_INTERVAL_MS,
  DEFAULT_USERNAME_BLOOM_REBUILD_LOCK_TTL_MS,
  DEFAULT_USERNAME_BLOOM_RELOAD_INTERVAL_MS,
} from "@/configuration/environment/constants";
import { parseBoolean, parseNumber } from "@/configuration/environment/shared";
import type {
  AppEnvironment,
  RateLimiterStrategy,
  RawEnvironmentValues,
} from "@/configuration/environment/types";

export function parseRateLimiterStrategy(
  raw: RawEnvironmentValues,
  errors: string[],
): RateLimiterStrategy {
  const value = raw.RATE_LIMITER_STRATEGY?.toLowerCase() ?? "sliding-window";

  if (value === "sliding-window" || value === "token-bucket") {
    return value;
  }

  errors.push(
    "RATE_LIMITER_STRATEGY must be either 'sliding-window' or 'token-bucket'.",
  );
  return "sliding-window";
}

export function buildRateLimiterConfig(
  raw: RawEnvironmentValues,
  errors: string[],
  strategy: RateLimiterStrategy,
): AppEnvironment["rateLimiter"] {
  const limit = parseNumber(raw, "RATE_LIMITER_LIMIT", 60, errors, {
    integer: true,
    min: 1,
  });
  const windowSeconds = parseNumber(
    raw,
    "RATE_LIMITER_WINDOW_SECONDS",
    60,
    errors,
    {
      integer: true,
      min: 1,
    },
  );
  const bucketCapacity = parseNumber(
    raw,
    "RATE_LIMITER_BUCKET_CAPACITY",
    limit,
    errors,
    {
      integer: true,
      min: 1,
    },
  );
  const configuredRefillRate =
    raw.RATE_LIMITER_REFILL_TOKENS_PER_SECOND === undefined
      ? undefined
      : parseNumber(raw, "RATE_LIMITER_REFILL_TOKENS_PER_SECOND", 1, errors, {
          min: 0.000_001,
        });

  return {
    enabled: parseBoolean(raw.RATE_LIMITER_ENABLED, true),
    strategy,
    limit,
    windowSeconds,
    bucketCapacity,
    refillTokensPerSecond:
      configuredRefillRate ?? bucketCapacity / windowSeconds,
  };
}

export function buildWorkerConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["workers"] {
  const searchPollIntervalMs = parseNumber(
    raw,
    "POSTINGS_SEARCH_OUTBOX_POLL_INTERVAL_MS",
    2_000,
    errors,
    {
      integer: true,
      min: 1,
    },
  );
  const searchBatchSize = parseNumber(
    raw,
    "POSTINGS_SEARCH_OUTBOX_BATCH_SIZE",
    25,
    errors,
    {
      integer: true,
      min: 1,
    },
  );

  return {
    search: {
      pollIntervalMs: searchPollIntervalMs,
      batchSize: searchBatchSize,
    },
    searchRelay: {
      pollIntervalMs: parseNumber(
        raw,
        "POSTINGS_SEARCH_RELAY_POLL_INTERVAL_MS",
        searchPollIntervalMs,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      batchSize: parseNumber(
        raw,
        "POSTINGS_SEARCH_RELAY_BATCH_SIZE",
        searchBatchSize,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      maxAttempts: parseNumber(
        raw,
        "POSTINGS_SEARCH_RELAY_MAX_ATTEMPTS",
        8,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
    },
    searchIndexer: {
      prefetch: parseNumber(
        raw,
        "POSTINGS_SEARCH_INDEXER_PREFETCH",
        25,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      batchSize: parseNumber(
        raw,
        "POSTINGS_SEARCH_INDEXER_BATCH_SIZE",
        25,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      flushIntervalMs: parseNumber(
        raw,
        "POSTINGS_SEARCH_INDEXER_FLUSH_INTERVAL_MS",
        250,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      concurrency: parseNumber(
        raw,
        "POSTINGS_SEARCH_INDEXER_CONCURRENCY",
        2,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      maxAttempts: parseNumber(
        raw,
        "POSTINGS_SEARCH_INDEX_MAX_ATTEMPTS",
        8,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
    },
    searchReconcile: {
      pollIntervalMs: parseNumber(
        raw,
        "POSTINGS_SEARCH_RECONCILE_POLL_INTERVAL_MS",
        60_000,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      batchSize: parseNumber(
        raw,
        "POSTINGS_SEARCH_RECONCILE_BATCH_SIZE",
        50,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
    },
    searchReindex: {
      pollIntervalMs: parseNumber(
        raw,
        "POSTINGS_SEARCH_REINDEX_POLL_INTERVAL_MS",
        5_000,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      batchSize: parseNumber(
        raw,
        "POSTINGS_SEARCH_REINDEX_BATCH_SIZE",
        250,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
    },
    email: {
      prefetch: parseNumber(raw, "EMAIL_WORKER_PREFETCH", 10, errors, {
        integer: true,
        min: 1,
      }),
      maxAttempts: parseNumber(raw, "EMAIL_MAX_ATTEMPTS", 8, errors, {
        integer: true,
        min: 1,
      }),
    },
    sms: {
      prefetch: parseNumber(raw, "SMS_WORKER_PREFETCH", 10, errors, {
        integer: true,
        min: 1,
      }),
      maxAttempts: parseNumber(raw, "SMS_MAX_ATTEMPTS", 8, errors, {
        integer: true,
        min: 1,
      }),
    },
    analytics: {
      pollIntervalMs: parseNumber(
        raw,
        "POSTINGS_ANALYTICS_OUTBOX_POLL_INTERVAL_MS",
        2_000,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      batchSize: parseNumber(
        raw,
        "POSTINGS_ANALYTICS_OUTBOX_BATCH_SIZE",
        50,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
    },
    recommendationsPrecompute: {
      pollIntervalMs: parseNumber(
        raw,
        "RECOMMENDATIONS_PRECOMPUTE_POLL_INTERVAL_MS",
        5_000,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      batchSize: parseNumber(
        raw,
        "RECOMMENDATIONS_PRECOMPUTE_BATCH_SIZE",
        25,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
    },
    postingsThumbnail: {
      prefetch: parseNumber(raw, "POSTINGS_THUMBNAIL_PREFETCH", 10, errors, {
        integer: true,
        min: 1,
      }),
      maxAttempts: parseNumber(
        raw,
        "POSTINGS_THUMBNAIL_MAX_ATTEMPTS",
        5,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
    },
    bookingExpiry: {
      pollIntervalMs: parseNumber(
        raw,
        "BOOKING_REQUEST_EXPIRY_POLL_INTERVAL_MS",
        5_000,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      batchSize: parseNumber(
        raw,
        "BOOKING_REQUEST_EXPIRY_BATCH_SIZE",
        50,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
    },
    paymentsRetry: {
      pollIntervalMs: parseNumber(
        raw,
        "PAYMENTS_RETRY_POLL_INTERVAL_MS",
        5_000,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      batchSize: parseNumber(raw, "PAYMENTS_RETRY_BATCH_SIZE", 25, errors, {
        integer: true,
        min: 1,
      }),
    },
    paymentsRepair: {
      pollIntervalMs: parseNumber(
        raw,
        "PAYMENTS_REPAIR_POLL_INTERVAL_MS",
        10_000,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      batchSize: parseNumber(raw, "PAYMENTS_REPAIR_BATCH_SIZE", 25, errors, {
        integer: true,
        min: 1,
      }),
    },
    payoutRelease: {
      pollIntervalMs: parseNumber(
        raw,
        "PAYOUT_RELEASE_POLL_INTERVAL_MS",
        15_000,
        errors,
        {
          integer: true,
          min: 1,
        },
      ),
      batchSize: parseNumber(raw, "PAYOUT_RELEASE_BATCH_SIZE", 50, errors, {
        integer: true,
        min: 1,
      }),
    },
  };
}

export function buildPostingsCacheConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["postingsCache"] {
  return {
    freshTtlSeconds: parseNumber(
      raw,
      "POSTINGS_PUBLIC_CACHE_FRESH_TTL_SECONDS",
      DEFAULT_POSTINGS_PUBLIC_CACHE_FRESH_TTL_SECONDS,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    staleTtlSeconds: parseNumber(
      raw,
      "POSTINGS_PUBLIC_CACHE_STALE_TTL_SECONDS",
      DEFAULT_POSTINGS_PUBLIC_CACHE_STALE_TTL_SECONDS,
      errors,
      {
        integer: true,
        min: DEFAULT_POSTINGS_PUBLIC_CACHE_FRESH_TTL_SECONDS,
      },
    ),
    rebuildLockTtlMs: parseNumber(
      raw,
      "POSTINGS_PUBLIC_CACHE_REBUILD_LOCK_TTL_MS",
      DEFAULT_POSTINGS_PUBLIC_CACHE_REBUILD_LOCK_TTL_MS,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    followerWaitTimeoutMs: parseNumber(
      raw,
      "POSTINGS_PUBLIC_CACHE_FOLLOWER_WAIT_TIMEOUT_MS",
      DEFAULT_POSTINGS_PUBLIC_CACHE_FOLLOWER_WAIT_TIMEOUT_MS,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    followerPollIntervalMs: parseNumber(
      raw,
      "POSTINGS_PUBLIC_CACHE_FOLLOWER_POLL_INTERVAL_MS",
      DEFAULT_POSTINGS_PUBLIC_CACHE_FOLLOWER_POLL_INTERVAL_MS,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    negativeTtlSeconds: parseNumber(
      raw,
      "POSTINGS_PUBLIC_CACHE_NEGATIVE_TTL_SECONDS",
      DEFAULT_POSTINGS_PUBLIC_CACHE_NEGATIVE_TTL_SECONDS,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    ttlJitterRatio: parseNumber(
      raw,
      "POSTINGS_PUBLIC_CACHE_TTL_JITTER_RATIO",
      DEFAULT_POSTINGS_PUBLIC_CACHE_TTL_JITTER_RATIO,
      errors,
      {
        min: 0,
      },
    ),
  };
}

export function buildUsernameBloomConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["usernameBloom"] {
  return {
    enabled: parseBoolean(raw.USERNAME_BLOOM_ENABLED, true),
    capacity: parseNumber(
      raw,
      "USERNAME_BLOOM_CAPACITY",
      DEFAULT_USERNAME_BLOOM_CAPACITY,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    falsePositiveRate: parseNumber(
      raw,
      "USERNAME_BLOOM_FALSE_POSITIVE_RATE",
      DEFAULT_USERNAME_BLOOM_FALSE_POSITIVE_RATE,
      errors,
      {
        // A rate of 0 would demand an infinite bitmap and a rate of 1 would
        // make every answer useless, so both ends are excluded by the
        // validation below rather than by the bounds here.
        min: 0,
        max: 1,
      },
    ),
    reloadIntervalMs: parseNumber(
      raw,
      "USERNAME_BLOOM_RELOAD_INTERVAL_MS",
      DEFAULT_USERNAME_BLOOM_RELOAD_INTERVAL_MS,
      errors,
      {
        integer: true,
        min: 1_000,
      },
    ),
    maxStalenessMs: parseNumber(
      raw,
      "USERNAME_BLOOM_MAX_STALENESS_MS",
      DEFAULT_USERNAME_BLOOM_MAX_STALENESS_MS,
      errors,
      {
        integer: true,
        min: 1_000,
      },
    ),
    rebuildIntervalMs: parseNumber(
      raw,
      "USERNAME_BLOOM_REBUILD_INTERVAL_MS",
      DEFAULT_USERNAME_BLOOM_REBUILD_INTERVAL_MS,
      errors,
      {
        integer: true,
        min: 1_000,
      },
    ),
    rebuildBatchSize: parseNumber(
      raw,
      "USERNAME_BLOOM_REBUILD_BATCH_SIZE",
      DEFAULT_USERNAME_BLOOM_REBUILD_BATCH_SIZE,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    rebuildLockTtlMs: parseNumber(
      raw,
      "USERNAME_BLOOM_REBUILD_LOCK_TTL_MS",
      DEFAULT_USERNAME_BLOOM_REBUILD_LOCK_TTL_MS,
      errors,
      {
        integer: true,
        min: 1_000,
      },
    ),
  };
}

export function validateRuntimeConfig(
  config: Pick<AppEnvironment, "postingsCache" | "usernameBloom">,
  errors: string[],
): void {
  if (
    config.postingsCache.staleTtlSeconds < config.postingsCache.freshTtlSeconds
  ) {
    errors.push(
      "POSTINGS_PUBLIC_CACHE_STALE_TTL_SECONDS must be greater than or equal to POSTINGS_PUBLIC_CACHE_FRESH_TTL_SECONDS.",
    );
  }

  if (
    config.postingsCache.followerPollIntervalMs >
    config.postingsCache.followerWaitTimeoutMs
  ) {
    errors.push(
      "POSTINGS_PUBLIC_CACHE_FOLLOWER_POLL_INTERVAL_MS must be less than or equal to POSTINGS_PUBLIC_CACHE_FOLLOWER_WAIT_TIMEOUT_MS.",
    );
  }

  if (config.postingsCache.ttlJitterRatio >= 1) {
    errors.push("POSTINGS_PUBLIC_CACHE_TTL_JITTER_RATIO must be less than 1.");
  }

  if (
    config.usernameBloom.falsePositiveRate <= 0 ||
    config.usernameBloom.falsePositiveRate >= 1
  ) {
    errors.push(
      "USERNAME_BLOOM_FALSE_POSITIVE_RATE must be greater than 0 and less than 1.",
    );
  }

  // The staleness gate is what stops a wedged instance from answering out of a
  // bit array nobody has refreshed. Setting it below the reload interval would
  // trip it on every healthy cycle and disable the filter entirely.
  if (
    config.usernameBloom.maxStalenessMs <= config.usernameBloom.reloadIntervalMs
  ) {
    errors.push(
      "USERNAME_BLOOM_MAX_STALENESS_MS must be greater than USERNAME_BLOOM_RELOAD_INTERVAL_MS.",
    );
  }
}
