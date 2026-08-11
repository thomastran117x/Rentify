import express from "express";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import {
  rateLimiterMiddleware,
  resolveRateLimitPolicy,
} from "@/configuration/middlewares/rate-limiter.middleware";
import { createMockRequest } from "../../support/mock-http";
import { createTestApp } from "../../support/fetch-app";

class FakeContainer implements ServiceContainer {
  constructor(private readonly cacheService: { eval: jest.Mock }) {}

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.cacheService) {
      return this.cacheService as TValue;
    }

    throw new Error(`Unexpected token: ${String(token)}`);
  }

  createScope(): ServiceContainer {
    return this;
  }

  async dispose(): Promise<void> {}
}

function createApp(cacheEval = jest.fn().mockResolvedValue([1, 119, 0])) {
  const cacheService = {
    eval: cacheEval,
  };

  const app = createTestApp((instance) => {
    instance.use((request, _response, next) => {
      request.client = {
        ip: "203.0.113.10",
        device: {
          type: "desktop",
          isMobile: false,
        },
      };
      request.container = new FakeContainer(cacheService);
      request.outputFormat = "json";
      next();
    });
    instance.use(rateLimiterMiddleware);
    instance.post("/sms/webhooks/telnyx", (_request, response) => {
      response.json({ ok: true });
    });
    instance.use(handleApplicationError);
  });

  return { app, cacheEval };
}

describe("SMS webhook rate limiting", () => {
  it("assigns the token-bucket webhook policy to the Telnyx webhook route", () => {
    const policy = resolveRateLimitPolicy(
      createMockRequest({
        url: "http://rent.test/sms/webhooks/telnyx",
        method: "POST",
      }) as express.Request,
    );

    expect(policy).toMatchObject({
      id: "sms-webhook",
      strategy: "token-bucket",
      limit: 120,
      bucketKey: "POST:sms-webhook",
    });
  });

  it("uses token-bucket headers on SMS webhook routes", async () => {
    const { app, cacheEval } = createApp();

    const response = await app.request("http://rent.test/sms/webhooks/telnyx", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-policy")).toBe("sms-webhook");
    expect(response.headers.get("x-ratelimit-strategy")).toBe("token-bucket");
    expect(cacheEval.mock.calls[0]?.[0]).toContain("local key = KEYS[1]");
  });
});
