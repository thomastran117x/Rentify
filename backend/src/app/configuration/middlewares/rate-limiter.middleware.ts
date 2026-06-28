import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  containerTokens,
  getRequestContainer,
} from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment";
import { stripApiRoutePrefix } from "@/configuration/http/api-path";
import { loggerFactory } from "@/configuration/logging";
import TooManyRequestError from "@/errors/http/too-many-request.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { getOptionalJwtAuth } from "./jwt-middleware";

type RateLimiterStrategy = "sliding-window" | "token-bucket";

interface SlidingWindowResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface TokenBucketResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

type RateLimitBackend = "memory" | "redis";

interface RateLimitEvaluation {
  backend: RateLimitBackend;
  result: SlidingWindowResult | TokenBucketResult;
}

export interface RateLimitPolicy {
  bucketKey: string;
  id: string;
  limit: number;
  refillTokensPerSecond: number;
  strategy: RateLimiterStrategy;
  windowSeconds: number;
  bucketCapacity: number;
}

interface MemoryTokenBucketState {
  expiresAtMs: number;
  lastRefillMs: number;
  tokens: number;
}

const slidingWindowMemoryStore = new Map<string, number[]>();
const tokenBucketMemoryStore = new Map<string, MemoryTokenBucketState>();
const REDIS_FALLBACK_LOG_COOLDOWN_MS = 60_000;
let lastRedisFallbackLogAt = 0;
const rateLimiterLogger = loggerFactory.forComponent(
  "rate-limiter.middleware",
  "middleware",
);

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local window_start = now - window_ms

redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

local current = redis.call('ZCARD', key)
if current >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_ms = window_ms

  if oldest[2] then
    retry_ms = math.max(1, math.floor((tonumber(oldest[2]) + window_ms - now)))
  end

  return {0, 0, math.ceil(retry_ms / 1000)}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window_ms)

local remaining = limit - current - 1
return {1, remaining, 0}
`;

const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill_rate = tonumber(ARGV[3])
local ttl_ms = tonumber(ARGV[4])

local values = redis.call('HMGET', key, 'tokens', 'last_refill_ms')
local tokens = tonumber(values[1])
local last_refill_ms = tonumber(values[2])

if tokens == nil then
  tokens = capacity
  last_refill_ms = now
end

local elapsed_ms = math.max(0, now - last_refill_ms)
local refill = (elapsed_ms / 1000) * refill_rate
tokens = math.min(capacity, tokens + refill)

if tokens < 1 then
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill_ms', now)
  redis.call('PEXPIRE', key, ttl_ms)

  local retry_ms = math.ceil(((1 - tokens) / refill_rate) * 1000)
  return {0, math.floor(tokens), math.ceil(math.max(1, retry_ms) / 1000)}
end

tokens = tokens - 1
redis.call('HMSET', key, 'tokens', tokens, 'last_refill_ms', now)
redis.call('PEXPIRE', key, ttl_ms)

return {1, math.floor(tokens), 0}
`;

function readStrategy(): RateLimiterStrategy {
  return environment.getRateLimiterConfig().strategy;
}

function isEnabled(): boolean {
  return environment.getRateLimiterConfig().enabled;
}

function getLimit(): number {
  return environment.getRateLimiterConfig().limit;
}

function getWindowSeconds(): number {
  return environment.getRateLimiterConfig().windowSeconds;
}

function getTokenBucketCapacity(): number {
  return environment.getRateLimiterConfig().bucketCapacity;
}

function getTokenBucketRefillRate(): number {
  return environment.getRateLimiterConfig().refillTokensPerSecond;
}

function createPolicy(
  request: Request,
  policy: Omit<RateLimitPolicy, "bucketKey"> & { bucketKey?: string },
): RateLimitPolicy {
  const pathname = stripApiRoutePrefix(new URL(request.url).pathname);

  return {
    ...policy,
    bucketKey: policy.bucketKey ?? `${request.method}:${pathname}`,
  };
}

function createDefaultPolicy(request: Request): RateLimitPolicy {
  return createPolicy(request, {
    id: "default",
    strategy: readStrategy(),
    limit: getLimit(),
    windowSeconds: getWindowSeconds(),
    bucketCapacity: getTokenBucketCapacity(),
    refillTokensPerSecond: getTokenBucketRefillRate(),
  });
}

function isAuthSensitiveRoute(request: Request, pathname: string): boolean {
  if (
    request.method === "POST" &&
    (/^\/auth\/local\/(login|signup|password\/forgot(?:\/resend)?|password\/reset|email\/verify|email\/resend|unlock(?:\/resend)?|verify)$/.test(
      pathname,
    ) ||
      /^\/auth\/oauth\/(google|microsoft|apple)$/.test(pathname))
  ) {
    return true;
  }

  // TOTP enrollment and verification — guessing codes is feasible at the global
  // default rate (60/min) over the 15-minute pending window; apply the same
  // tight bucket used for login.
  if (
    request.method === "POST" &&
    /^\/auth\/mfa\/totp\/(begin|confirm|disable)$/.test(pathname)
  ) {
    return true;
  }

  return false;
}

function isAuthSessionRoute(request: Request, pathname: string): boolean {
  return (
    (request.method === "POST" &&
      /^\/auth\/(logout|device\/verify)$/.test(pathname)) ||
    /^\/auth\/oauth\/[^/]+\/link$/.test(pathname) ||
    (request.method === "DELETE" && /^\/auth\/oauth\/[^/]+$/.test(pathname))
  );
}

function isAuthRefreshRoute(request: Request, pathname: string): boolean {
  return request.method === "POST" && pathname === "/auth/refresh";
}

function isPaymentMutationRoute(request: Request, pathname: string): boolean {
  return (
    request.method === "POST" &&
    (/^\/booking-requests\/[^/]+\/payment-session$/.test(pathname) ||
      /^\/payments\/[^/]+\/(retry|refunds|reconcile|repair)$/.test(pathname))
  );
}

function isPaymentWebhookRoute(request: Request, pathname: string): boolean {
  return request.method === "POST" && pathname === "/payments/webhooks/square";
}

function isSmsWebhookRoute(request: Request, pathname: string): boolean {
  return request.method === "POST" && pathname === "/sms/webhooks/telnyx";
}

export function resolveRateLimitPolicy(request: Request): RateLimitPolicy {
  const pathname = stripApiRoutePrefix(new URL(request.url).pathname);

  if (isAuthSensitiveRoute(request, pathname)) {
    return createPolicy(request, {
      id: "auth-sensitive",
      bucketKey: `${request.method}:auth-sensitive`,
      strategy: "sliding-window",
      limit: 10,
      windowSeconds: 60,
      bucketCapacity: 10,
      refillTokensPerSecond: 10 / 60,
    });
  }

  if (isAuthRefreshRoute(request, pathname)) {
    return createPolicy(request, {
      id: "auth-refresh",
      bucketKey: `${request.method}:auth-refresh`,
      strategy: "sliding-window",
      limit: 60,
      windowSeconds: 60,
      bucketCapacity: 60,
      refillTokensPerSecond: 1,
    });
  }

  if (isAuthSessionRoute(request, pathname)) {
    return createPolicy(request, {
      id: "auth-session",
      bucketKey: `${request.method}:auth-session`,
      strategy: "sliding-window",
      limit: 15,
      windowSeconds: 60,
      bucketCapacity: 15,
      refillTokensPerSecond: 15 / 60,
    });
  }

  if (isPaymentMutationRoute(request, pathname)) {
    return createPolicy(request, {
      id: "payments-write",
      bucketKey: `${request.method}:payments-write`,
      strategy: "sliding-window",
      limit: 12,
      windowSeconds: 60,
      bucketCapacity: 12,
      refillTokensPerSecond: 12 / 60,
    });
  }

  if (isPaymentWebhookRoute(request, pathname)) {
    return createPolicy(request, {
      id: "payments-webhook",
      bucketKey: `${request.method}:payments-webhook`,
      strategy: "token-bucket",
      limit: 120,
      windowSeconds: 60,
      bucketCapacity: 120,
      refillTokensPerSecond: 2,
    });
  }

  if (isSmsWebhookRoute(request, pathname)) {
    return createPolicy(request, {
      id: "sms-webhook",
      bucketKey: `${request.method}:sms-webhook`,
      strategy: "token-bucket",
      limit: 120,
      windowSeconds: 60,
      bucketCapacity: 120,
      refillTokensPerSecond: 2,
    });
  }

  return createDefaultPolicy(request);
}

function buildRateLimitKey(policy: RateLimitPolicy, ipAddress: string): string {
  return `rate-limit:${policy.bucketKey}:${ipAddress}`;
}

interface RateLimitIdentity {
  keyPart: string;
  type: "ip" | "user";
}

async function resolveRateLimitIdentity(
  context: Parameters<typeof rateLimiterMiddleware>[0],
): Promise<RateLimitIdentity> {
  const existingAuth = context.get("auth");

  if (existingAuth?.sub) {
    return {
      type: "user",
      keyPart: `user:${existingAuth.sub}`,
    };
  }

  try {
    const auth = await getOptionalJwtAuth(context);

    if (auth?.sub) {
      return {
        type: "user",
        keyPart: `user:${auth.sub}`,
      };
    }
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      throw error;
    }
  }

  return {
    type: "ip",
    keyPart: `ip:${context.get("client").ip ?? "unknown"}`,
  };
}

async function evaluateSlidingWindow(
  context: Parameters<typeof rateLimiterMiddleware>[0],
  key: string,
  policy: RateLimitPolicy,
): Promise<SlidingWindowResult> {
  const now = Date.now();
  const windowMs = policy.windowSeconds * 1000;
  const limit = policy.limit;
  const member = `${now}:${randomUUID()}`;

  const result = await getRequestContainer(context)
    .resolve(containerTokens.cacheService)
    .eval<[number, number, number]>(
      SLIDING_WINDOW_SCRIPT,
      [key],
      [String(now), String(windowMs), String(limit), member],
    );

  return {
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfterSeconds: result[2],
  };
}

function evaluateSlidingWindowInMemory(
  key: string,
  policy: RateLimitPolicy,
): SlidingWindowResult {
  const now = Date.now();
  const windowMs = policy.windowSeconds * 1000;
  const windowStart = now - windowMs;
  const entries = slidingWindowMemoryStore.get(key) ?? [];
  const activeEntries = entries.filter((timestamp) => timestamp > windowStart);

  if (activeEntries.length >= policy.limit) {
    const oldestTimestamp = activeEntries[0] ?? now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldestTimestamp + windowMs - now) / 1000),
    );

    slidingWindowMemoryStore.set(key, activeEntries);

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  activeEntries.push(now);
  slidingWindowMemoryStore.set(key, activeEntries);

  return {
    allowed: true,
    remaining: Math.max(0, policy.limit - activeEntries.length),
    retryAfterSeconds: 0,
  };
}

async function evaluateTokenBucket(
  context: Parameters<typeof rateLimiterMiddleware>[0],
  key: string,
  policy: RateLimitPolicy,
): Promise<TokenBucketResult> {
  const now = Date.now();
  const capacity = policy.bucketCapacity;
  const refillRate = policy.refillTokensPerSecond;
  const ttlMs = Math.max(Math.ceil((capacity / refillRate) * 1000 * 2), 1000);

  const result = await getRequestContainer(context)
    .resolve(containerTokens.cacheService)
    .eval<[number, number, number]>(
      TOKEN_BUCKET_SCRIPT,
      [key],
      [String(now), String(capacity), String(refillRate), String(ttlMs)],
    );

  return {
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfterSeconds: result[2],
  };
}

function evaluateTokenBucketInMemory(
  key: string,
  policy: RateLimitPolicy,
): TokenBucketResult {
  const now = Date.now();
  const capacity = policy.bucketCapacity;
  const refillRate = policy.refillTokensPerSecond;
  const ttlMs = Math.max(Math.ceil((capacity / refillRate) * 1000 * 2), 1000);
  const existingState = tokenBucketMemoryStore.get(key);

  let tokens = existingState?.tokens ?? capacity;
  let lastRefillMs = existingState?.lastRefillMs ?? now;

  const elapsedMs = Math.max(0, now - lastRefillMs);
  const refill = (elapsedMs / 1000) * refillRate;
  tokens = Math.min(capacity, tokens + refill);

  if (tokens < 1) {
    tokenBucketMemoryStore.set(key, {
      tokens,
      lastRefillMs: now,
      expiresAtMs: now + ttlMs,
    });

    return {
      allowed: false,
      remaining: Math.max(0, Math.floor(tokens)),
      retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / refillRate)),
    };
  }

  tokens -= 1;
  lastRefillMs = now;

  tokenBucketMemoryStore.set(key, {
    tokens,
    lastRefillMs,
    expiresAtMs: now + ttlMs,
  });

  return {
    allowed: true,
    remaining: Math.max(0, Math.floor(tokens)),
    retryAfterSeconds: 0,
  };
}

function pruneExpiredMemoryEntries(): void {
  const now = Date.now();

  for (const [key, state] of tokenBucketMemoryStore.entries()) {
    if (state.expiresAtMs <= now) {
      tokenBucketMemoryStore.delete(key);
    }
  }
}

function shouldFallbackToMemory(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /redis|socket|offline|closed|connect|econnrefused|initialize|not been initialized/i.test(
    error.message,
  );
}

function logRedisFallback(error: unknown, policy: RateLimitPolicy): void {
  const now = Date.now();

  if (now - lastRedisFallbackLogAt < REDIS_FALLBACK_LOG_COOLDOWN_MS) {
    return;
  }

  lastRedisFallbackLogAt = now;

  rateLimiterLogger.warn(
    "Rate limiter falling back to in-memory evaluation because Redis is unavailable.",
    {
      policy: policy.id,
      error: error instanceof Error ? error.message : error,
    },
  );
}

async function evaluateRateLimit(
  context: Parameters<typeof rateLimiterMiddleware>[0],
  key: string,
  policy: RateLimitPolicy,
): Promise<RateLimitEvaluation> {
  try {
    const result =
      policy.strategy === "sliding-window"
        ? await evaluateSlidingWindow(context, key, policy)
        : await evaluateTokenBucket(context, key, policy);

    return {
      backend: "redis",
      result,
    };
  } catch (error) {
    if (!shouldFallbackToMemory(error)) {
      throw error;
    }

    pruneExpiredMemoryEntries();
    logRedisFallback(error, policy);

    return {
      backend: "memory",
      result:
        policy.strategy === "sliding-window"
          ? evaluateSlidingWindowInMemory(key, policy)
          : evaluateTokenBucketInMemory(key, policy),
    };
  }
}

export function resetRateLimiterMemoryFallbackForTests(): void {
  slidingWindowMemoryStore.clear();
  tokenBucketMemoryStore.clear();
  lastRedisFallbackLogAt = 0;
}

export const rateLimiterMiddleware = createMiddleware<AppBindings>(
  async (context, next) => {
    if (!isEnabled()) {
      await next();
      return;
    }

    const policy = resolveRateLimitPolicy(context.req.raw);
    const identity = await resolveRateLimitIdentity(context);
    const key = buildRateLimitKey(policy, identity.keyPart);
    const strategy = policy.strategy;
    const evaluation = await evaluateRateLimit(context, key, policy);

    context.header("x-ratelimit-limit", String(policy.limit));
    context.header("x-ratelimit-backend", evaluation.backend);
    context.header(
      "x-ratelimit-remaining",
      String(Math.max(0, evaluation.result.remaining)),
    );
    context.header("x-ratelimit-policy", policy.id);
    context.header("x-ratelimit-strategy", strategy);
    if (evaluation.backend === "memory") {
      context.header("x-ratelimit-degraded", "true");
    }

    if (!evaluation.result.allowed) {
      context.header(
        "retry-after",
        String(Math.max(1, evaluation.result.retryAfterSeconds)),
      );
      throw new TooManyRequestError(
        "Too many requests. Please try again later.",
        {
          backend: evaluation.backend,
          identityType: identity.type,
          policy: policy.id,
          strategy,
          retryAfterSeconds: Math.max(1, evaluation.result.retryAfterSeconds),
        },
      );
    }

    await next();
  },
);
