import { generateKeyPairSync, sign as signPayload } from "node:crypto";

const mockGetEnvironment = jest.fn();

jest.mock("@/configuration/environment/index", () => ({
  getEnvironment: () => mockGetEnvironment(),
}));

import BadRequestError from "@/errors/http/bad-request.error";
import { TelnyxSmsAdapter } from "@/features/sms/telnyx.adapter";

function createFetchResponse(options: {
  ok: boolean;
  status: number;
  body?: Record<string, unknown>;
  text?: string;
}) {
  return {
    ok: options.ok,
    status: options.status,
    text: async () =>
      options.text !== undefined
        ? options.text
        : JSON.stringify(options.body ?? {}),
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
            status: eventType === "message.finalized" ? "delivered" : "queued",
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
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
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

  it("classifies retryable, permanent, and ambiguous timeout errors", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
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

    expect(
      adapter.classifyError(
        Object.assign(new Error("Telnyx request timed out."), {
          status: 504,
          code: "ETIMEDOUT",
        }),
      ),
    ).toEqual({
      category: "unknown",
      code: "ETIMEDOUT",
      message: "Telnyx request timed out.",
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
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    expect(
      adapter.parseWebhookEvent(
        JSON.stringify(createWebhookPayload("message.sent")),
      ),
    ).toMatchObject({
      eventId: "event-message.sent",
      eventType: "message.sent",
      direction: "outbound",
      messageId: "msg-1",
      fromPhoneNumber: "+14165550199",
      toPhoneNumbers: ["+14165550100"],
      deliveryStatus: "queued",
      errors: [],
    });

    expect(
      adapter.parseWebhookEvent(
        JSON.stringify(createWebhookPayload("message.finalized")),
      ),
    ).toMatchObject({
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

    expect(
      adapter.parseWebhookEvent(
        JSON.stringify(createWebhookPayload("message.received")),
      ),
    ).toMatchObject({
      eventId: "event-message.received",
      eventType: "message.received",
      direction: "inbound",
    });
  });

  it("accepts hex-encoded and base64-encoded Ed25519 public keys in the constructor", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const rawHex = der.slice(12).toString("hex");
    const rawBase64 = der.slice(12).toString("base64");

    expect(() => new TelnyxSmsAdapter({ publicKey: rawHex })).not.toThrow();
    expect(() => new TelnyxSmsAdapter({ publicKey: rawBase64 })).not.toThrow();
  });

  it("throws when constructed with an invalid public key", () => {
    expect(
      () => new TelnyxSmsAdapter({ publicKey: "not-a-valid-key" }),
    ).toThrow();
  });

  it("omits messaging_profile_id and webhook_url when not configured", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        createFetchResponse({ ok: true, status: 200, body: { data: {} } }),
      );
    mockGetEnvironment.mockReturnValue({
      sms: {
        fromNumber: "+14165550199",
        webhookPublicUrl: undefined,
        telnyx: {
          apiKey: "telnyx-api-key",
          publicKey: generateKeyPairSync("ed25519")
            .publicKey.export({ type: "spki", format: "pem" })
            .toString(),
          messagingProfileId: undefined,
        },
      },
    });
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
      messagingProfileId: undefined,
      webhookPublicUrl: undefined,
    });

    await adapter.sendMessage({ to: "+14165550100", text: "Hello" });

    const body = JSON.parse(
      ((globalThis.fetch as jest.Mock).mock.calls[0]?.[1] as RequestInit)
        .body as string,
    ) as Record<string, unknown>;

    expect(body).not.toHaveProperty("messaging_profile_id");
    expect(body).not.toHaveProperty("webhook_url");
    expect(body).not.toHaveProperty("tags");
  });

  it("throws with a detailed API error message when Telnyx returns a 4xx response", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      createFetchResponse({
        ok: false,
        status: 422,
        body: {
          errors: [
            {
              code: "10004",
              detail: "Destination number is not valid.",
            },
          ],
        },
      }),
    );
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    await expect(
      adapter.sendMessage({ to: "+14165550100", text: "Hello" }),
    ).rejects.toMatchObject({
      message: "Destination number is not valid.",
      status: 422,
      code: "10004",
    });
  });

  it("throws a generic error when Telnyx returns an error response without a detail message", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        createFetchResponse({ ok: false, status: 500, body: {} }),
      );
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    await expect(
      adapter.sendMessage({ to: "+14165550100", text: "Hello" }),
    ).rejects.toMatchObject({ message: "Telnyx request failed with 500." });
  });

  it("maps an AbortError to a timeout transport error", async () => {
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    jest.spyOn(globalThis, "fetch").mockRejectedValue(abortError);
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
      requestTimeoutMs: 1,
    });

    await expect(
      adapter.sendMessage({ to: "+14165550100", text: "Hello" }),
    ).rejects.toMatchObject({
      message: "Telnyx request timed out.",
      status: 504,
      code: "ETIMEDOUT",
    });
  });

  it("maps a network error with a code on cause to a transport error", async () => {
    const networkError = Object.assign(new Error("network failure"), {
      cause: { code: "ECONNREFUSED" },
    });
    jest.spyOn(globalThis, "fetch").mockRejectedValue(networkError);
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    await expect(
      adapter.sendMessage({ to: "+14165550100", text: "Hello" }),
    ).rejects.toMatchObject({
      message: "Telnyx request failed before receiving a response.",
      status: 503,
      code: "ECONNREFUSED",
    });
  });

  it("throws INVALID_PROVIDER_RESPONSE when the Telnyx response body is not valid JSON", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        createFetchResponse({ ok: true, status: 200, text: "not-json" }),
      );
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    await expect(
      adapter.sendMessage({ to: "+14165550100", text: "Hello" }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  it("returns undefined fields when the Telnyx response body is empty", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        createFetchResponse({ ok: true, status: 200, text: "" }),
      );
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    const result = await adapter.sendMessage({
      to: "+14165550100",
      text: "Hello",
    });

    expect(result.providerMessageId).toBeUndefined();
    expect(result.providerStatus).toBeUndefined();
  });

  it("rejects webhook signatures when the signature header is absent", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    const result = adapter.verifyWebhookSignature(
      JSON.stringify({ data: { id: "e1", event_type: "message.sent" } }),
      { timestamp: "1718971200" },
    );

    expect(result.isValid).toBe(false);
    expect(result.reason).toBe("missing-signature");
  });

  it("rejects webhook signatures when the timestamp header is absent", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    const result = adapter.verifyWebhookSignature(
      JSON.stringify({ data: { id: "e1", event_type: "message.sent" } }),
      { signatureEd25519: "sig" },
    );

    expect(result.isValid).toBe(false);
    expect(result.reason).toBe("missing-timestamp");
  });

  it("rejects webhook signatures with a non-numeric timestamp", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    const result = adapter.verifyWebhookSignature(
      JSON.stringify({ data: { id: "e1", event_type: "message.sent" } }),
      { signatureEd25519: "sig", timestamp: "not-a-number" },
    );

    expect(result.isValid).toBe(false);
    expect(result.reason).toBe("invalid-timestamp");
  });

  it("rejects webhook signatures with a stale timestamp", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
      timestampToleranceMs: 1,
    });
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 300);

    const result = adapter.verifyWebhookSignature(
      JSON.stringify({ data: { id: "e1", event_type: "message.sent" } }),
      { signatureEd25519: "sig", timestamp: staleTimestamp },
    );

    expect(result.isValid).toBe(false);
    expect(result.reason).toBe("stale-timestamp");
  });

  it("rejects a valid-timestamp signature that does not match the body", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const adapter = new TelnyxSmsAdapter({
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const originalBody = JSON.stringify(createWebhookPayload("message.sent"));
    const tamperedBody = JSON.stringify(
      createWebhookPayload("message.received"),
    );
    const signature = signPayload(
      null,
      Buffer.from(`${timestamp}|${originalBody}`, "utf8"),
      privateKey,
    ).toString("base64");

    const result = adapter.verifyWebhookSignature(tamperedBody, {
      signatureEd25519: signature,
      timestamp,
    });

    expect(result.isValid).toBe(false);
    expect(result.reason).toBe("signature-mismatch");
  });

  it("normalizes unknown Telnyx event types to 'unsupported'", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    expect(
      adapter.parseWebhookEvent(
        JSON.stringify({
          data: {
            id: "event-1",
            event_type: "message.unknown",
            payload: { to: [], errors: [] },
          },
        }),
      ),
    ).toMatchObject({ eventType: "unsupported" });
  });

  it("throws BadRequestError for invalid JSON webhook bodies", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    expect(() => adapter.parseWebhookEvent("{bad json")).toThrow(
      BadRequestError,
    );
  });

  it("throws BadRequestError when required webhook fields are missing", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    expect(() => adapter.parseWebhookEvent("{}")).toThrow(BadRequestError);
    expect(() =>
      adapter.parseWebhookEvent(
        JSON.stringify({ data: { id: "e1", event_type: "message.sent" } }),
      ),
    ).toThrow(BadRequestError);
  });

  it("classifies ABORT_ERR as unknown and non-retryable", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    expect(
      adapter.classifyError(
        Object.assign(new Error("aborted"), { code: "ABORT_ERR" }),
      ),
    ).toMatchObject({
      category: "unknown",
      code: "ABORT_ERR",
      retryable: false,
    });
  });

  it("classifies 5xx status as transient and retryable", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    expect(
      adapter.classifyError(
        Object.assign(new Error("server error"), { status: 503 }),
      ),
    ).toMatchObject({ category: "transient", retryable: true });
  });

  it("classifies ECONNRESET as transient and retryable", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    expect(
      adapter.classifyError(
        Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
      ),
    ).toMatchObject({
      category: "transient",
      code: "ECONNRESET",
      retryable: true,
    });
  });

  it("classifies unknown errors without a status or code as unknown and retryable", () => {
    const adapter = new TelnyxSmsAdapter({
      publicKey: generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    });

    expect(
      adapter.classifyError(new Error("unexpected failure")),
    ).toMatchObject({
      category: "unknown",
      retryable: true,
    });
    expect(adapter.classifyError("plain string error")).toMatchObject({
      category: "unknown",
      retryable: true,
    });
  });
});
