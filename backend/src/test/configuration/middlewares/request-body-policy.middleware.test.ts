import { Hono } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import { requestBodyPolicyMiddleware } from "@/configuration/middlewares/request-body-policy.middleware";

function createApp() {
  const app = new Hono<AppBindings>();
  app.use("*", requestBodyPolicyMiddleware);
  app.onError(handleApplicationError);
  app.post("/profiles", async (context) =>
    context.json(await context.req.json()),
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
});
