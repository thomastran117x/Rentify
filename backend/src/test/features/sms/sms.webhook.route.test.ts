import { Hono } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { handleApplicationError } from "@/configuration/middlewares/error-handler.middleware";
import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import { SmsController } from "@/features/sms/sms.controller";

function createApp(processWebhook: jest.Mock) {
  const app = new Hono<AppBindings>();
  const controller = new SmsController({
    processWebhook,
  } as any);

  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    context.set("outputFormat", "json");
    context.set("logger", {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      critical: jest.fn(),
      child: jest.fn(),
    } as any);
    await next();
  });
  app.post("/sms/webhooks/telnyx", controller.webhook);
  app.onError(handleApplicationError);

  return app;
}

describe("SMS webhook route", () => {
  it("returns 200 for valid signed webhook requests", async () => {
    const processWebhook = jest.fn(async () => undefined);
    const app = createApp(processWebhook);

    const response = await app.request("http://rent.test/sms/webhooks/telnyx", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "telnyx-signature-ed25519": "signature-1",
        "telnyx-timestamp": "1718971200",
      },
      body: JSON.stringify({
        data: {
          event_type: "message.sent",
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "SMS webhook processed successfully.",
      data: {
        ok: true,
      },
    });
  });

  it("returns 403 for invalid webhook signatures", async () => {
    const app = createApp(
      jest.fn(async () => {
        throw new ForbiddenError("SMS webhook signature is invalid.");
      }),
    );

    const response = await app.request("http://rent.test/sms/webhooks/telnyx", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        data: {
          event_type: "message.sent",
        },
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message: "SMS webhook signature is invalid.",
      error: {
        code: "FORBIDDEN",
      },
    });
  });

  it("returns 400 for malformed webhook payloads", async () => {
    const app = createApp(
      jest.fn(async () => {
        throw new BadRequestError("SMS webhook payload is invalid.");
      }),
    );

    const response = await app.request("http://rent.test/sms/webhooks/telnyx", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{bad-json",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: "SMS webhook payload is invalid.",
      error: {
        code: "BAD_REQUEST",
      },
    });
  });
});
