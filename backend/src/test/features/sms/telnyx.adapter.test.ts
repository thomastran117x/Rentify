import { generateKeyPairSync, sign as signPayload } from "node:crypto";

const mockGetEnvironment = jest.fn();

jest.mock("@/configuration/environment/index", () => ({
  getEnvironment: () => mockGetEnvironment(),
}));

import { TelnyxSmsAdapter } from "@/features/sms/telnyx.adapter";

function createFetchResponse(options: {
  ok: boolean;
  status: number;
  body?: Record<string, unknown>;
}) {
  return {
    ok: options.ok,
    status: options.status,
    text: async () => JSON.stringify(options.body ?? {}),
  } as Response;
}

function createWebhookPayload(eventType: string) {
  return {
    data: {
      id: `event-${eventType}`,
      event_type: eventType,
      occurred_at: "2026-06-21T12:00:00.000Z",
      payload: {
        id: "msg-1",
        direction: eventType === "message.received" ? "inbound" : "outbound",
        from: {
          phone_number: "+14165550199",
        },
        to: [
          {
            phone_number: "+14165550100",
            status:
              eventType === "message.finalized" ? "delivered" : "queued",
          },
        ],
        errors:
          eventType === "message.finalized"
            ? [
                {
                  code: "30007",
                  title: "Carrier filtered",
                  detail: "Carrier rejected the message.",
                },
              ]
            : [],
      },
    },
  };
}

describe("TelnyxSmsAdapter", () => {
  beforeEach(() => {
    mockGetEnvironment.mockReturnValue({
      sms: {
        fromNumber: "+14165550199",
        webhookPublicUrl: "https://rent.test/api/v1/sms/webhooks/telnyx",
        telnyx: {
          apiKey: "telnyx-api-key",
          publicKey: "unused-for-most-tests",
          messagingProfileId: "profile-1",
        },
      },
    });
    jest.restoreAllMocks();
  });

  afterEach(() => {
    mockGetEnvironment.mockReset();
  });

  it("maps outbound send requests to the Telnyx messages API", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      createFetchResponse({
        ok: true,
        status: 200,
        body: {
          data: {
            id: "telnyx-message-1",
            to: [
              {
                status: "queued",
              },
            ],
            cost: {
              amount: 0.0075,
              currency: "USD",
            },
          },
        },
      }),
    );
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519").publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    });

    const result = await adapter.sendMessage({
      to: "+14165550100",
      text: "Your booking is confirmed.",
      metadata: {
        tags: ["booking", "confirmed"],
      },
      webhookContext: {
        webhookFailoverUrl: "https://rent.test/sms-failover",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telnyx.com/v2/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer telnyx-api-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(
      JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string),
    ).toEqual({
      from: "+14165550199",
      to: "+14165550100",
      text: "Your booking is confirmed.",
      messaging_profile_id: "profile-1",
      webhook_url: "https://rent.test/api/v1/sms/webhooks/telnyx",
      webhook_failover_url: "https://rent.test/sms-failover",
      tags: ["booking", "confirmed"],
    });
    expect(result).toEqual({
      providerMessageId: "telnyx-message-1",
      providerStatus: "queued",
      costAmount: 0.0075,
      costCurrency: "USD",
      raw: {
        data: {
          id: "telnyx-message-1",
          to: [
            {
              status: "queued",
            },
          ],
          cost: {
            amount: 0.0075,
            currency: "USD",
          },
        },
      },
    });
  });

  it("classifies retryable and permanent provider errors", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519").publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    });

    expect(
      adapter.classifyError(
        Object.assign(new Error("Too many requests"), {
          status: 429,
          code: "RATE_LIMITED",
        }),
      ),
    ).toEqual({
      category: "transient",
      code: "RATE_LIMITED",
      message: "Too many requests",
      retryable: true,
    });

    expect(
      adapter.classifyError(
        Object.assign(new Error("Invalid destination"), {
          status: 400,
          code: "INVALID_TO",
        }),
      ),
    ).toEqual({
      category: "permanent",
      code: "INVALID_TO",
      message: "Invalid destination",
      retryable: false,
    });
  });

  it("verifies Telnyx webhook signatures using the raw body and timestamp", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const adapter = new TelnyxSmsAdapter({
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    const rawBody = JSON.stringify(createWebhookPayload("message.sent"));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signPayload(
      null,
      Buffer.from(`${timestamp}|${rawBody}`, "utf8"),
      privateKey,
    ).toString("base64");

    expect(
      adapter.verifyWebhookSignature(rawBody, {
        signatureEd25519: signature,
        timestamp,
      }),
    ).toEqual({
      isValid: true,
      eventId: "event-message.sent",
      eventType: "message.sent",
      payload: JSON.parse(rawBody),
      reason: undefined,
    });
  });

  it("parses supported sent, finalized, and received webhook events", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519").publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    });

    expect(adapter.parseWebhookEvent(JSON.stringify(createWebhookPayload("message.sent")))).toMatchObject({
      eventId: "event-message.sent",
      eventType: "message.sent",
      direction: "outbound",
      messageId: "msg-1",
      fromPhoneNumber: "+14165550199",
      toPhoneNumbers: ["+14165550100"],
      deliveryStatus: "queued",
      errors: [],
    });

    expect(adapter.parseWebhookEvent(JSON.stringify(createWebhookPayload("message.finalized")))).toMatchObject({
      eventId: "event-message.finalized",
      eventType: "message.finalized",
      deliveryStatus: "delivered",
      errors: [
        {
          code: "30007",
          title: "Carrier filtered",
          detail: "Carrier rejected the message.",
        },
      ],
    });

    expect(adapter.parseWebhookEvent(JSON.stringify(createWebhookPayload("message.received")))).toMatchObject({
      eventId: "event-message.received",
      eventType: "message.received",
      direction: "inbound",
    });
  });
});
