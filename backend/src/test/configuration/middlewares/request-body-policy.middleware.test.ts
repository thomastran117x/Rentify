import { Hono } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { requestBodyPolicyMiddleware } from "@/configuration/middlewares/request-body-policy.middleware";

function createApp() {
  const app = new Hono<AppBindings>();
  app.use("*", requestBodyPolicyMiddleware);
  app.onError(handleApplicationError);
  app.get("/profiles", async (context) =>
    context.json({
      ok: true,
    }),
  );
  app.post("/profiles", async (context) =>
    context.json(await context.req.json()),
  );
  app.post("/blob/upload", async (context) =>
    context.json({ body: await context.req.text() }),
  );
  app.post("/payments/webhooks/square", async (context) =>
    context.json({ body: await context.req.text() }),
  );
  return app;
}

describe("requestBodyPolicyMiddleware", () => {
  const originalMaxBytes = process.env.REQUEST_BODY_MAX_BYTES;

  beforeEach(() => {
    delete process.env.REQUEST_BODY_MAX_BYTES;
  });

  afterAll(() => {
    if (originalMaxBytes === undefined) {
      delete process.env.REQUEST_BODY_MAX_BYTES;
      return;
    }

    process.env.REQUEST_BODY_MAX_BYTES = originalMaxBytes;
  });

  it("rejects non-json request bodies on write endpoints", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/profiles", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
      },
      body: "hello",
    });

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Request body must use application/json.",
      data: null,
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("rejects oversized request bodies before they reach the route handler", async () => {
    process.env.REQUEST_BODY_MAX_BYTES = "12";
    const app = createApp();
    const response = await app.request("http://rent.test/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        bio: "This body is definitely larger than twelve bytes.",
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Request body is too large.",
      data: null,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        details: {
          limitBytes: 12,
          receivedBytes: expect.any(Number),
        },
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("allows raw webhook routes to keep reading their json payload as text", async () => {
    const app = createApp();
    const response = await app.request(
      "http://rent.test/payments/webhooks/square",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          eventId: "evt_123",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      body: '{"eventId":"evt_123"}',
    });
  });

  it("rejects invalid content-length headers", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "abc",
      },
      body: JSON.stringify({
        bio: "hello",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Content-Length header is invalid.",
      data: null,
      error: {
        code: "BAD_REQUEST",
      },
      meta: {
        requestId: "unknown",
      },
    });
  });

  it("allows non-json uploads on blob routes", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/blob/upload", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
      },
      body: "raw blob body",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      body: "raw blob body",
    });
  });

  it("allows custom json media types on write endpoints", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/merge-patch+json",
      },
      body: JSON.stringify({
        bio: "patched",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bio: "patched",
    });
  });

  it("skips body enforcement for read-only requests", async () => {
    const app = createApp();
    const response = await app.request("http://rent.test/profiles", {
      method: "GET",
      headers: {
        "content-type": "text/plain",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
  });
});
