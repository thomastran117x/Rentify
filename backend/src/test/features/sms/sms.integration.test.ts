import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { NoopSmsAdapter } from "@/features/sms/noop.adapter";
import {
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";

const WEBHOOK_PATH = "/sms/webhooks/telnyx";

/**
 * Controls whether the stubbed provider accepts the webhook signature. The
 * default provider in a test environment is the noop adapter, which accepts
 * everything, so a rejecting provider is needed to prove the route surfaces a
 * verification failure rather than swallowing it.
 */
let signatureIsValid = true;

function buildWebhookBody(eventId: string) {
  return {
    data: {
      id: eventId,
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
}

describe("SMS webhook persistence integration", () => {
  let persistenceApp: PersistenceTestApp;
  let receivedRawBodies: string[] = [];

  async function request(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {},
  ): Promise<Response> {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp({
      registerOverrides: (container) => {
        // Delegates to the production noop adapter so the parsed event keeps
        // its real shape; only signature validity is forced.
        const adapter = new NoopSmsAdapter();
        container.register({
          token: containerTokens.smsProvider,
          lifetime: "singleton",
          dependencies: [],
          resolve: () =>
            ({
              ...adapter,
              sendMessage: adapter.sendMessage.bind(adapter),
              parseWebhookEvent: adapter.parseWebhookEvent.bind(adapter),
              verifyWebhookSignature: (
                rawBody: string,
                headers: Record<string, string | undefined>,
              ) => {
                receivedRawBodies.push(rawBody);
                const verification = adapter.verifyWebhookSignature(
                  rawBody,
                  headers as never,
                );
                return signatureIsValid
                  ? verification
                  : {
                      ...verification,
                      isValid: false,
                      reason: "signature-mismatch",
                    };
              },
            }) as never,
        });
      },
    });
  }, 180_000);

  beforeEach(async () => {
    signatureIsValid = true;
    receivedRawBodies = [];
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("accepts a signed provider webhook and verifies the exact raw body", async () => {
    const rawBody = JSON.stringify(buildWebhookBody("event-accepted"));

    const response = await request(WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "telnyx-signature-ed25519": "test-signature",
        "telnyx-timestamp": "1750000000",
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { ok: true },
    });

    // Signature verification is computed over the exact bytes sent, so the
    // body must reach the provider unparsed and unmodified.
    expect(receivedRawBodies).toEqual([rawBody]);
  });

  it("rejects a webhook whose signature does not verify", async () => {
    signatureIsValid = false;

    const response = await request(WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "telnyx-signature-ed25519": "bad-signature",
        "telnyx-timestamp": "1750000000",
      },
      body: JSON.stringify(buildWebhookBody("event-rejected")),
    });

    expect(response.status).toBe(403);
  });
});
