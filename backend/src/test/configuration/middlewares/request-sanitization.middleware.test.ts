import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "@/configuration/http/bindings";
import type { ServiceContainer } from "@/configuration/bootstrap/container";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { requestSanitizationMiddleware } from "@/configuration/middlewares/request-sanitization.middleware";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import { parseRequestBody } from "@/configuration/validation/request";
import { containerTokens } from "@/configuration/container/tokens";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";

class FakeContainer implements ServiceContainer {
  private readonly contentSanitizationService =
    new ContentSanitizationService();

  resolve<TValue>(token: unknown): TValue {
    if (token === containerTokens.contentSanitizationService) {
      return this.contentSanitizationService as TValue;
    }

    throw new Error(`Unexpected token: ${String(token)}`);
  }

  createScope(): ServiceContainer {
    return this;
  }

  async dispose(): Promise<void> {}
}

function createApp() {
  const app = new Hono<AppBindings>();

  app.use("*", async (context, next) => {
    context.set("container", new FakeContainer());
    context.set("outputFormat", "json");
    await next();
  });
  app.use("*", requestSanitizationMiddleware);
  app.onError(handleApplicationError);

  app.get("/search", (context) => context.json({ ok: true }));
  app.get("/postings/:id", (context) =>
    context.json({ id: requireSafeRouteParam(context, "id") }),
  );
  app.post("/profiles", async (context) => {
    const body = await parseRequestBody(
      context,
      z.object({
        bio: z.string(),
        password: z.string(),
      }),
    );

    return context.json(body);
  });
  app.post("/payments/webhooks/square", async (context) => {
    const body = await context.req.text();
    return context.json({ body });
  });

  return app;
}

describe("requestSanitizationMiddleware", () => {
  it("rejects unsafe query string content before the controller runs", async () => {
    const app = createApp();
    const response = await app.request(
      "http://rent.test/search?q=%3Cscript%3Ealert(1)%3C/script%3E",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Request query validation failed.",
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        details: {
          "query.q": ["Contains disallowed content."],
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("rejects unsafe route params before the controller runs", async () => {
    const app = createApp();
    const response = await app.request(
      "http://rent.test/postings/%3Cimg%20src=x%20onerror=alert(1)%3E",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Route parameter validation failed.",
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        details: {
          id: ["Contains disallowed content."],
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("rejects unsafe json body content through the shared parser", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        bio: "<script>alert('xss')</script>",
        password: "Strong<script>Password123!",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Request body validation failed.",
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        details: {
          bio: ["Contains disallowed content."],
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("does not sanitize password-like secret fields at the request boundary", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        bio: "Hello there",
        password: "Strong<script>Password123!",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bio: "Hello there",
      password: "Strong<script>Password123!",
    });
  });

  it("leaves raw-body webhook routes readable", async () => {
    const app = createApp();
    const response = await app.request(
      "http://rent.test/payments/webhooks/square",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          html: "<script>alert('xss')</script>",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      body: '{"html":"<script>alert(\'xss\')</script>"}',
    });
  });
});
