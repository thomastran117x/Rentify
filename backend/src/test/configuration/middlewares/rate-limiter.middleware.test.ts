import { Hono } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
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

class FakeContainer implements ServiceContainer {
  constructor(
    private readonly cacheService: { eval: jest.Mock },
    private readonly tokenService: { verifyAccessToken: jest.Mock },
  ) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.cacheService) {
      return this.cacheService as TValue;
    }

    if (token === containerTokens.tokenService) {
      return this.tokenService as TValue;
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
    sub: "user-1",
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
) {
  const app = new Hono<AppBindings>();
  const cacheService = {
    eval: cacheEval,
  };
  const tokenService = {
    verifyAccessToken,
  };
  const requestLogger: Logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
    child: jest.fn(),
  };
  requestLogger.child = jest.fn(() => requestLogger);

  app.use("*", async (context, next) => {
    context.set("client", {
      ip: "203.0.113.10",
      device: {
        type: "desktop",
        isMobile: false,
      },
    });
    context.set("container", new FakeContainer(cacheService, tokenService));
    context.set("logger", requestLogger);
    context.set("outputFormat", "json");
    await next();
  });
  app.use("*", rateLimiterMiddleware);
  app.onError(handleApplicationError);
  app.post("/auth/local/login", (context) => context.json({ ok: true }));
  app.post("/auth/refresh", (context) => context.json({ ok: true }));
  app.post("/auth/device/verify", (context) => context.json({ ok: true }));
  app.post("/auth/oauth/google/link", (context) => context.json({ ok: true }));
  app.delete("/auth/oauth/google", (context) => context.json({ ok: true }));
  app.post("/payments/:id/refunds", (context) => context.json({ ok: true }));
  app.post("/payments/webhooks/square", (context) =>
    context.json({ ok: true }),
  );
  app.post("/sms/webhooks/telnyx", (context) => context.json({ ok: true }));
  app.post("/postings", (context) => context.json({ ok: true }));

  return { app, cacheEval, verifyAccessToken, requestLogger };
}

describe("resolveRateLimitPolicy", () => {
  it("assigns a stricter auth policy to login routes", () => {
    const policy = resolveRateLimitPolicy(
      new Request("http://rent.test/auth/local/login", {
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
      new Request(`http://rent.test${buildApiPath("/auth/local/login")}`, {
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

  it("assigns a stable payment-write bucket to dynamic payment mutation routes", () => {
    const firstPolicy = resolveRateLimitPolicy(
      new Request("http://rent.test/payments/payment-1/refunds", {
        method: "POST",
      }),
    );
    const secondPolicy = resolveRateLimitPolicy(
      new Request("http://rent.test/payments/payment-2/refunds", {
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
      new Request("http://rent.test/auth/refresh", { method: "POST" }),
    );
    const logoutPolicy = resolveRateLimitPolicy(
      new Request("http://rent.test/auth/logout", { method: "POST" }),
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
      new Request("http://rent.test/auth/oauth/google/link", {
        method: "POST",
      }),
    );
    const deletePolicy = resolveRateLimitPolicy(
      new Request("http://rent.test/auth/oauth/google", {
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

  it("assigns the token-bucket webhook policy to the Square webhook route", () => {
    const policy = resolveRateLimitPolicy(
      new Request("http://rent.test/payments/webhooks/square", {
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
      new Request("http://rent.test/postings", {
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
      "http://rent.test/payments/webhooks/square",
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
    const app = new Hono<AppBindings>();
    const api = app.basePath(getApiRoutePrefix());
    const cacheService = {
      eval: cacheEval,
    };
    const tokenService = {
      verifyAccessToken,
    };

    api.use("*", async (context, next) => {
      context.set("client", {
        ip: "203.0.113.10",
        device: {
          type: "desktop",
          isMobile: false,
        },
      });
      context.set("container", new FakeContainer(cacheService, tokenService));
      context.set("outputFormat", "json");
      await next();
    });
    api.use("*", rateLimiterMiddleware);
    app.onError(handleApplicationError);
    api.post("/auth/local/login", (context) => context.json({ ok: true }));

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
      "rate-limit:POST:/postings:user:user-1",
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
    }) as never);
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
    }) as never);
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
    jest.useFakeTimers().setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation(((
      _chunk: string | Uint8Array,
      callback?: unknown,
    ) => {
      if (typeof callback === "function") {
        callback(null);
      }

      return true;
    }) as never);
    const { app } = createApp(
      jest
        .fn()
        .mockRejectedValue(new Error("Redis socket closed unexpectedly.")),
    );

    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const response = await app.request(
          "http://rent.test/payments/webhooks/square",
          {
            method: "POST",
          },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("x-ratelimit-backend")).toBe("memory");
      }

      const limitedResponse = await app.request(
        "http://rent.test/payments/webhooks/square",
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
