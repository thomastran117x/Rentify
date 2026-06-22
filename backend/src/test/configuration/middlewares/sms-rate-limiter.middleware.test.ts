import { Hono } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import {
  rateLimiterMiddleware,
  resolveRateLimitPolicy,
} from "@/configuration/middlewares/rate-limiter.middleware";

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
  const app = new Hono<AppBindings>();
  const cacheService = {
    eval: cacheEval,
  };

  app.use("*", async (context, next) => {
    context.set("client", {
      ip: "203.0.113.10",
      device: {
        type: "desktop",
        isMobile: false,
      },
    });
    context.set("container", new FakeContainer(cacheService));
    context.set("outputFormat", "json");
    await next();
  });
  app.use("*", rateLimiterMiddleware);
  app.onError(handleApplicationError);
  app.post("/sms/webhooks/telnyx", (context) => context.json({ ok: true }));

  return { app, cacheEval };
}

describe("SMS webhook rate limiting", () => {
  it("assigns the token-bucket webhook policy to the Telnyx webhook route", () => {
    const policy = resolveRateLimitPolicy(
      new Request("http://rent.test/sms/webhooks/telnyx", {
        method: "POST",
      }),
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
