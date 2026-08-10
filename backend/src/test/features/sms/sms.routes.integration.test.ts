import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { SmsController } from "@/features/sms/sms.controller";
import { createRouteTestApp } from "../../support/integration-app";

const WEBHOOK_PATH = "/sms/webhooks/telnyx";

const WEBHOOK_BODY = {
  data: {
    id: "event-1",
    event_type: "message.sent",
    occurred_at: "2026-06-21T12:00:00.000Z",
    payload: {
      id: "telnyx-message-1",
      direction: "outbound",
      from: { phone_number: "+14165550199" },
      to: [{ phone_number: "+14165550100", status: "queued" }],
    },
  },
};

function createApp() {
  const smsService = {
    processWebhook: jest.fn(
      async (
        _rawBody: string,
        headers: { signatureEd25519?: string; timestamp?: string },
      ) => {
        if (!headers.signatureEd25519 || !headers.timestamp) {
          throw new UnauthorizedError("Webhook signature is missing.");
        }
      },
    ),
  };

  const registry = new Map<unknown, unknown>([
    [containerTokens.smsController, new SmsController(smsService as never)],
  ]);

  return { app: createRouteTestApp(registry), smsService };
}

describe("Telnyx SMS webhook routes integration", () => {
  it("passes the raw body and signature headers to the service", async () => {
    const { app, smsService } = createApp();
    const rawBody = JSON.stringify(WEBHOOK_BODY);

    const response = await app.request(
      `http://rent.test${buildApiPath(WEBHOOK_PATH)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "telnyx-signature-ed25519": "test-signature",
          "telnyx-timestamp": "1750000000",
        },
        body: rawBody,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { ok: true },
    });

    // The raw body must reach the service unparsed: signature verification is
    // computed over the exact bytes Telnyx sent.
    expect(smsService.processWebhook).toHaveBeenCalledWith(rawBody, {
      signatureEd25519: "test-signature",
      timestamp: "1750000000",
    });
  });

  it("rejects a webhook that arrives without signature headers", async () => {
    const { app, smsService } = createApp();

    const response = await app.request(
      `http://rent.test${buildApiPath(WEBHOOK_PATH)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(WEBHOOK_BODY),
      },
    );

    expect(response.status).toBe(401);
    expect(smsService.processWebhook).toHaveBeenCalledWith(expect.any(String), {
      signatureEd25519: undefined,
      timestamp: undefined,
    });
  });
});
