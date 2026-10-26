import express from "express";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath, getApiRoutePrefix } from "@/configuration/http/api-path";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import {
  rateLimiterMiddleware,
  resetRateLimiterMemoryFallbackForTests,
  resolveRateLimitPolicy,
} from "@/configuration/middlewares/rate-limiter.middleware";
import type { Logger } from "@/configuration/logging";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { createTestApp } from "../../support/fetch-app";
import { testUuid } from "../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);

function ok(_request: express.Request, response: express.Response): void {
  response.json({ ok: true });
}

/**
 * A minimal stand-in for an Express request, for the cases that call
 * resolveRateLimitPolicy directly rather than over HTTP.
 */
function policyRequest(
  url: string,
  init?: { method?: string },
): express.Request {
  const target = new URL(url);
  const headers: Record<string, string> = { host: target.host };

  return {
    originalUrl: `${target.pathname}${target.search}`,
    protocol: "http",
    method: init?.method ?? "GET",
    headers,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as express.Request;
}

class FakeContainer implements ServiceContainer {
  constructor(
    private readonly cacheService: {
      eval: jest.Mock;
      setIfNotExists: jest.Mock;
    },
    private readonly tokenService: { verifyAccessToken: jest.Mock },
    private readonly authAuditService: { recordSafely: jest.Mock },
  ) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.cacheService) {
      return this.cacheService as TValue;
    }

    if (token === containerTokens.tokenService) {
      return this.tokenService as TValue;
    }

    if (token === containerTokens.authAuditService) {
      return this.authAuditService as TValue;
    }

    throw new Error(`Unexpected token: ${String(token)}`);
  }

  createScope(): ServiceContainer {
    return this;
  }

  async dispose(): Promise<void> {}
}

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: USER_1_ID,
    email: "user@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 0,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createApp(
  cacheEval = jest.fn().mockResolvedValue([1, 4, 0]),
  verifyAccessToken = jest.fn().mockResolvedValue(createClaims()),
  setIfNotExists = jest.fn().mockResolvedValue(true),
  recordSafely = jest.fn().mockResolvedValue(undefined),
) {
  const cacheService = {
    eval: cacheEval,
    setIfNotExists,
  };
  const tokenService = {
    verifyAccessToken,
  };
  const authAuditService = { recordSafely };
  const requestLogger: Logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
    child: jest.fn(),
  };
  requestLogger.child = jest.fn(() => requestLogger);

  const app = createTestApp((instance) => {
    instance.use((request, _response, next) => {
      request.client = {
        ip: "203.0.113.10",
        source: "api-tool",
        device: {
          type: "desktop",
          isMobile: false,
        },
      };
      request.container = new FakeContainer(
        cacheService,
        tokenService,
        authAuditService,
      );
      request.logger = requestLogger;
      request.outputFormat = "json";
      next();
    });
    instance.use(rateLimiterMiddleware);
    instance.post("/auth/local/login", ok);
    instance.post("/auth/refresh", ok);
    instance.post("/auth/device/verify", ok);
    instance.post("/auth/oauth/google/link", ok);
    instance.delete("/auth/oauth/google", ok);
    instance.post("/payments/:id/refunds", ok);
    instance.post("/payments/webhooks/paypal", ok);
    instance.post("/sms/webhooks/telnyx", ok);
    instance.post("/postings", ok);
    instance.use(handleApplicationError);
  });

  return {
    app,
    cacheEval,
    verifyAccessToken,
    setIfNotExists,
    recordSafely,
    requestLogger,
  };
}

describe("resolveRateLimitPolicy", () => {
  it("gives media status socket tickets their own bucket", () => {
    expect(
      resolveRateLimitPolicy(
        policyRequest("http://rent.test/media/socket-ticket", {
          method: "POST",
        }),
      ),
    ).toMatchObject({
      id: "media-status-socket-ticket",
      bucketKey: "POST:media-status-socket-ticket",
      limit: 60,
      windowSeconds: 300,
    });
    // Reading an item is not minting a ticket.
    expect(
      resolveRateLimitPolicy(
        policyRequest("http://rent.test/media/socket-ticket"),
      ).id,
    ).toBe("default");
  });

  it("assigns a stricter auth policy to login routes", () => {
    const policy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/auth/local/login", {
        method: "POST",
      }),
    );

    expect(policy).toMatchObject({
      id: "auth-sensitive",
      strategy: "sliding-window",
      limit: 10,
      bucketKey: "POST:auth-sensitive",
    });
  });

  it("assigns the same auth policy to versioned login routes", () => {
    const policy = resolveRateLimitPolicy(
      policyRequest(`http://rent.test${buildApiPath("/auth/local/login")}`, {
        method: "POST",
      }),
    );

    expect(policy).toMatchObject({
      id: "auth-sensitive",
      strategy: "sliding-window",
      limit: 10,
      bucketKey: "POST:auth-sensitive",
    });
  });

  it.each(["/auth/account/self-lock", "/auth/account/self-lock/session"])(
    "assigns the auth policy to %s",
    (path) => {
      const policy = resolveRateLimitPolicy(
        policyRequest(`http://rent.test${buildApiPath(path)}`, {
          method: "POST",
        }),
      );

      expect(policy).toMatchObject({
        id: "auth-sensitive",
        limit: 10,
        bucketKey: "POST:auth-sensitive",
      });
    },
  );

  it("assigns a dedicated policy to the username availability check", () => {
    const policy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/auth/username/available?username=casey", {
        method: "GET",
      }),
    );

    expect(policy).toMatchObject({
      id: "username-availability",
      strategy: "sliding-window",
      limit: 60,
      bucketKey: "GET:username-availability",
    });
  });

  it("assigns a bounded policy to username suggestions", () => {
    const policy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/auth/username/suggestions?limit=3"),
    );

    expect(policy).toMatchObject({
      id: "username-suggestions",
      strategy: "sliding-window",
      limit: 20,
      bucketKey: "GET:username-suggestions",
    });
  });

  it("does not apply the availability policy to other methods on that path", () => {
    const policy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/auth/username/available", {
        method: "POST",
      }),
    );

    expect(policy.id).toBe("default");
  });

  it("assigns a stable payment-write bucket to dynamic payment mutation routes", () => {
    const firstPolicy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/payments/payment-1/refunds", {
        method: "POST",
      }),
    );
    const secondPolicy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/payments/payment-2/refunds", {
        method: "POST",
      }),
    );

    expect(firstPolicy.id).toBe("payments-write");
    expect(secondPolicy.id).toBe("payments-write");
    expect(firstPolicy.bucketKey).toBe("POST:payments-write");
    expect(secondPolicy.bucketKey).toBe("POST:payments-write");
  });

  it("assigns a more generous dedicated policy to refresh than other auth session routes", () => {
    const refreshPolicy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/auth/refresh", { method: "POST" }),
    );
    const logoutPolicy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/auth/logout", { method: "POST" }),
    );

    expect(refreshPolicy).toMatchObject({
      id: "auth-refresh",
      limit: 60,
      bucketKey: "POST:auth-refresh",
    });
    expect(logoutPolicy).toMatchObject({
      id: "auth-session",
      limit: 15,
      bucketKey: "POST:auth-session",
    });
  });

  it("assigns the auth-session policy to oauth link and delete routes", () => {
    const linkPolicy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/auth/oauth/google/link", {
        method: "POST",
      }),
    );
    const deletePolicy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/auth/oauth/google", {
        method: "DELETE",
      }),
    );

    expect(linkPolicy).toMatchObject({
      id: "auth-session",
      bucketKey: "POST:auth-session",
    });
    expect(deletePolicy).toMatchObject({
      id: "auth-session",
      bucketKey: "DELETE:auth-session",
    });
  });

  it("assigns the token-bucket webhook policy to the PayPal webhook route", () => {
    const policy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/payments/webhooks/paypal", {
        method: "POST",
      }),
    );

    expect(policy).toMatchObject({
      id: "payments-webhook",
      strategy: "token-bucket",
      limit: 120,
      bucketKey: "POST:payments-webhook",
    });
  });

  it("falls back to the default policy for unrelated routes", () => {
    const policy = resolveRateLimitPolicy(
      policyRequest("http://rent.test/postings", {
        method: "POST",
      }),
    );

    expect(policy).toMatchObject({
      id: "default",
      strategy: "sliding-window",
      limit: 60,
      bucketKey: "POST:/postings",
    });
  });
});

describe("rateLimiterMiddleware", () => {
  const originalLogSilent = process.env.LOG_SILENT;

  beforeEach(() => {
    process.env.LOG_SILENT = "false";
  });

  afterEach(() => {
    process.env.LOG_SILENT = originalLogSilent;
    jest.restoreAllMocks();
    resetRateLimiterMemoryFallbackForTests();
  });

  it("uses the stricter auth policy headers on login routes", async () => {
    const { app } = createApp();
    const response = await app.request("http://rent.test/auth/local/login", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-backend")).toBe("redis");
    expect(response.headers.get("x-ratelimit-limit")).toBe("10");
    expect(response.headers.get("x-ratelimit-policy")).toBe("auth-sensitive");
    expect(response.headers.get("x-ratelimit-strategy")).toBe("sliding-window");
  });

  it("uses the dedicated refresh policy headers on the refresh route", async () => {
    const { app } = createApp();
    const response = await app.request("http://rent.test/auth/refresh", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-backend")).toBe("redis");
    expect(response.headers.get("x-ratelimit-limit")).toBe("60");
    expect(response.headers.get("x-ratelimit-policy")).toBe("auth-refresh");
    expect(response.headers.get("x-ratelimit-strategy")).toBe("sliding-window");
  });

  it("uses the auth-session policy headers on device verification routes", async () => {
    const { app } = createApp();
    const response = await app.request("http://rent.test/auth/device/verify", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-policy")).toBe("auth-session");
    expect(response.headers.get("x-ratelimit-limit")).toBe("15");
  });

  it("uses token-bucket headers on payment webhook routes", async () => {
    const { app, cacheEval } = createApp(
      jest.fn().mockResolvedValue([1, 119, 0]),
    );
    const response = await app.request(
      "http://rent.test/payments/webhooks/paypal",
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-policy")).toBe("payments-webhook");
    expect(response.headers.get("x-ratelimit-strategy")).toBe("token-bucket");
    expect(cacheEval.mock.calls[0]?.[0]).toContain("local key = KEYS[1]");
  });

  it("supports versioned API routes when the middleware is mounted on the API base path", async () => {
    const { cacheEval, verifyAccessToken } = createApp();
    const cacheService = {
      eval: cacheEval,
      setIfNotExists: jest.fn().mockResolvedValue(true),
    };
    const tokenService = {
      verifyAccessToken,
    };

    const app = createTestApp((instance) => {
      const api = express.Router();
      instance.use(getApiRoutePrefix(), api);

      api.use((request, _response, next) => {
        request.client = {
          ip: "203.0.113.10",
          source: "api-tool",
          device: {
            type: "desktop",
            isMobile: false,
          },
        };
        request.container = new FakeContainer(cacheService, tokenService, {
          recordSafely: jest.fn().mockResolvedValue(undefined),
        });
        request.outputFormat = "json";
        next();
      });
      api.use(rateLimiterMiddleware);
      api.post("/auth/local/login", ok);
      instance.use(handleApplicationError);
    });

    const response = await app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-policy")).toBe("auth-sensitive");
  });

  it("uses a stable rate-limit key for payment mutation routes with different ids", async () => {
    const { app, cacheEval } = createApp();

    await app.request("http://rent.test/payments/payment-1/refunds", {
      method: "POST",
    });
    await app.request("http://rent.test/payments/payment-2/refunds", {
      method: "POST",
    });

    const keys = cacheEval.mock.calls.map(([, redisKeys]) => redisKeys[0]);
    expect(keys).toEqual([
      "rate-limit:POST:payments-write:ip:203.0.113.10",
      "rate-limit:POST:payments-write:ip:203.0.113.10",
    ]);
  });

  it("returns the matched policy in rate-limit errors", async () => {
    const { app } = createApp(jest.fn().mockResolvedValue([0, 0, 9]));
    const response = await app.request("http://rent.test/auth/local/login", {
      method: "POST",
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("x-ratelimit-backend")).toBe("redis");
    expect(response.headers.get("retry-after")).toBe("9");
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Too many requests. Please try again later.",
      data: null,
      error: {
        code: "TOO_MANY_REQUESTS",
        details: {
          backend: "redis",
          identityType: "ip",
          policy: "auth-sensitive",
          strategy: "sliding-window",
          retryAfterSeconds: 9,
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("dedupes a 50-request login 429 burst to one IP audit event", async () => {
    const claimedKeys = new Set<string>();
    const setIfNotExists = jest.fn(async (key: string) => {
      if (claimedKeys.has(key)) {
        return false;
      }
      claimedKeys.add(key);
      return true;
    });
    const { app, recordSafely } = createApp(
      jest.fn().mockResolvedValue([0, 0, 9]),
      undefined,
      setIfNotExists,
    );

    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.request("http://rent.test/auth/local/login", { method: "POST" }),
      ),
    );

    expect(responses.every((response) => response.status === 429)).toBe(true);
    expect(recordSafely).toHaveBeenCalledTimes(1);
    expect(recordSafely).toHaveBeenCalledWith({
      eventType: "rate_limit.exceeded",
      outcome: "blocked",
      reasonCode: "rate_limited",
      userId: null,
      method: undefined,
      context: expect.objectContaining({ ipAddress: "203.0.113.10" }),
      metadata: {
        policy: "auth-sensitive",
        identityType: "ip",
      },
    });
    expect(setIfNotExists).toHaveBeenLastCalledWith(
      "auth:audit:rate-limit:auth-sensitive:ip:203.0.113.10",
      "1",
      60,
    );
  });

  it("uses separate user and IP dedupe identities and marks refresh events", async () => {
    const { app, setIfNotExists, recordSafely } = createApp(
      jest.fn().mockResolvedValue([0, 0, 9]),
    );

    await app.request("http://rent.test/auth/refresh", { method: "POST" });
    await app.request("http://rent.test/auth/refresh", {
      method: "POST",
      headers: { authorization: "Bearer valid-access-token" },
    });

    expect(setIfNotExists).toHaveBeenNthCalledWith(
      1,
      "auth:audit:rate-limit:auth-refresh:ip:203.0.113.10",
      "1",
      60,
    );
    expect(setIfNotExists).toHaveBeenNthCalledWith(
      2,
      `auth:audit:rate-limit:auth-refresh:user:${USER_1_ID}`,
      "1",
      60,
    );
    expect(recordSafely).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: USER_1_ID,
        method: "refresh",
        metadata: { policy: "auth-refresh", identityType: "user" },
      }),
    );
  });

  it("records again after the dedupe window expires", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const expiresAt = new Map<string, number>();
    const setIfNotExists = jest.fn(
      async (key: string, _value: string, ttlSeconds: number) => {
        const now = Date.now();
        if ((expiresAt.get(key) ?? 0) > now) {
          return false;
        }
        expiresAt.set(key, now + ttlSeconds * 1000);
        return true;
      },
    );
    const { app, recordSafely } = createApp(
      jest.fn().mockResolvedValue([0, 0, 9]),
      undefined,
      setIfNotExists,
    );

    await app.request("http://rent.test/auth/local/login", { method: "POST" });
    nowSpy.mockReturnValue(61_001);
    await app.request("http://rent.test/auth/local/login", { method: "POST" });

    expect(recordSafely).toHaveBeenCalledTimes(2);
  });

  it("does not audit unsupported policies or memory-fallback 429s", async () => {
    const redisApp = createApp(jest.fn().mockResolvedValue([0, 0, 9]));
    await redisApp.app.request("http://rent.test/auth/device/verify", {
      method: "POST",
    });
    expect(redisApp.recordSafely).not.toHaveBeenCalled();
    expect(redisApp.setIfNotExists).not.toHaveBeenCalled();

    const memoryApp = createApp(
      jest
        .fn()
        .mockRejectedValue(new Error("Redis connection closed unexpectedly.")),
    );
    for (let attempt = 0; attempt <= 10; attempt += 1) {
      await memoryApp.app.request("http://rent.test/auth/local/login", {
        method: "POST",
      });
    }
    expect(memoryApp.recordSafely).not.toHaveBeenCalled();
    expect(memoryApp.setIfNotExists).not.toHaveBeenCalled();
  });

  it("keeps the 429 response when dedupe or audit recording fails", async () => {
    const dedupeFailure = createApp(
      jest.fn().mockResolvedValue([0, 0, 9]),
      undefined,
      jest.fn().mockRejectedValue(new Error("dedupe unavailable")),
    );
    expect(
      (
        await dedupeFailure.app.request("http://rent.test/auth/local/login", {
          method: "POST",
        })
      ).status,
    ).toBe(429);

    const auditFailure = createApp(
      jest.fn().mockResolvedValue([0, 0, 9]),
      undefined,
      undefined,
      jest.fn().mockRejectedValue(new Error("audit unavailable")),
    );
    expect(
      (
        await auditFailure.app.request("http://rent.test/auth/local/login", {
          method: "POST",
        })
      ).status,
    ).toBe(429);
  });

  it("prefers the authenticated user id over the client ip when a valid bearer token is present", async () => {
    const { app, cacheEval, verifyAccessToken } = createApp();
    const response = await app.request("http://rent.test/postings", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-access-token",
      },
    });

    expect(response.status).toBe(200);
    expect(verifyAccessToken).toHaveBeenCalledWith("valid-access-token");
    expect(cacheEval.mock.calls[0]?.[1]?.[0]).toBe(
      `rate-limit:POST:/postings:user:${USER_1_ID}`,
    );
  });

  it("falls back to the client ip when optional bearer auth is invalid", async () => {
    const verifyAccessToken = jest
      .fn()
      .mockRejectedValue(
        new UnauthorizedError("Invalid access token signature."),
      );
    const { app, cacheEval } = createApp(undefined, verifyAccessToken);
    const response = await app.request("http://rent.test/postings", {
      method: "POST",
      headers: {
        authorization: "Bearer invalid-access-token",
      },
    });

    expect(response.status).toBe(200);
    expect(cacheEval.mock.calls[0]?.[1]?.[0]).toBe(
      "rate-limit:POST:/postings:ip:203.0.113.10",
    );
  });

  it("rethrows unexpected optional auth failures instead of silently falling back", async () => {
    const verifyAccessToken = jest
      .fn()
      .mockRejectedValue(new Error("token service exploded"));
    const { app, requestLogger } = createApp(undefined, verifyAccessToken);
    const response = await app.request("http://rent.test/postings", {
      method: "POST",
      headers: {
        authorization: "Bearer broken-token",
      },
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Internal server error.",
      data: null,
      error: {
        code: "INTERNAL_SERVER_ERROR",
      },
      meta: {
        requestId: "unknown",
      },
    });
    expect(requestLogger.error).toHaveBeenCalledWith(
      "Unhandled application error.",
      undefined,
      expect.any(Error),
    );
  });

  it("falls back to in-memory limiting when Redis is unavailable", async () => {
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
      callback?: unknown,
    ) => {
      if (typeof callback === "function") {
        callback(null);
      }

      return true;
    }) as any);
    const { app } = createApp(
      jest
        .fn()
        .mockRejectedValue(
          new Error(
            "Redis has not been initialized. Call connectRedis() first.",
          ),
        ),
    );

    const response = await app.request("http://rent.test/auth/local/login", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-backend")).toBe("memory");
    expect(response.headers.get("x-ratelimit-degraded")).toBe("true");
    expect(writeSpy).toHaveBeenCalled();
  });

  it("still enforces limits when running on the in-memory fallback", async () => {
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
      callback?: unknown,
    ) => {
      if (typeof callback === "function") {
        callback(null);
      }

      return true;
    }) as any);
    const { app } = createApp(
      jest
        .fn()
        .mockRejectedValue(new Error("Redis connection closed unexpectedly.")),
    );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await app.request("http://rent.test/auth/local/login", {
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-ratelimit-backend")).toBe("memory");
    }

    const limitedResponse = await app.request(
      "http://rent.test/auth/local/login",
      {
        method: "POST",
      },
    );

    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get("x-ratelimit-backend")).toBe("memory");
    expect(limitedResponse.headers.get("x-ratelimit-degraded")).toBe("true");
    await expect(limitedResponse.json()).resolves.toEqual({
      success: false,
      message: "Too many requests. Please try again later.",
      data: null,
      error: {
        code: "TOO_MANY_REQUESTS",
        details: {
          backend: "memory",
          identityType: "ip",
          policy: "auth-sensitive",
          strategy: "sliding-window",
          retryAfterSeconds: expect.any(Number),
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
    expect(writeSpy).toHaveBeenCalled();
  });

  it("enforces token-bucket limits on the in-memory fallback path", async () => {
    // Only the clock is frozen, so the token bucket cannot refill between
    // attempts. The timer functions stay real because requests now travel over
    // a socket, and faking those would stall the HTTP client.
    jest
      .useFakeTimers({
        doNotFake: [
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "setImmediate",
          "clearImmediate",
          "nextTick",
          "queueMicrotask",
          "performance",
        ],
      })
      .setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation(((
      _chunk: string | Uint8Array,
      callback?: unknown,
    ) => {
      if (typeof callback === "function") {
        callback(null);
      }

      return true;
    }) as any);
    const { app } = createApp(
      jest
        .fn()
        .mockRejectedValue(new Error("Redis socket closed unexpectedly.")),
    );

    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const response = await app.request(
          "http://rent.test/payments/webhooks/paypal",
          {
            method: "POST",
          },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("x-ratelimit-backend")).toBe("memory");
      }

      const limitedResponse = await app.request(
        "http://rent.test/payments/webhooks/paypal",
        {
          method: "POST",
        },
      );

      expect(limitedResponse.status).toBe(429);
      expect(limitedResponse.headers.get("x-ratelimit-strategy")).toBe(
        "token-bucket",
      );
      expect(limitedResponse.headers.get("x-ratelimit-backend")).toBe("memory");
      expect(writeSpy).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
