import BadRequestError from "@/errors/http/bad-request.error";
import { NoopSmsAdapter } from "@/features/sms/noop.adapter";

describe("NoopSmsAdapter", () => {
  describe("sendMessage", () => {
    it("returns a noop provider result without contacting any external service", async () => {
      const adapter = new NoopSmsAdapter();

      const result = await adapter.sendMessage({
        to: "+14165550100",
        text: "Booking confirmed",
        metadata: { bookingId: "booking-1" },
        webhookContext: { webhookUrl: "http://example.com/webhook" },
      });

      expect(result.providerMessageId).toMatch(/^noop-sms-/);
      expect(result.providerStatus).toBe("noop");
      expect(result.raw).toMatchObject({
        provider: "noop",
        to: "+14165550100",
        text: "Booking confirmed",
        metadata: { bookingId: "booking-1" },
        webhookContext: { webhookUrl: "http://example.com/webhook" },
      });
    });
  });

  describe("verifyWebhookSignature", () => {
    it("always returns valid and reads event ID and type from the body", () => {
      const adapter = new NoopSmsAdapter();
      const body = JSON.stringify({
        data: { id: "event-1", event_type: "message.sent" },
      });

      const result = adapter.verifyWebhookSignature(body, {
        signatureEd25519: "any",
        timestamp: "any",
      });

      expect(result.isValid).toBe(true);
      expect(result.eventId).toBe("event-1");
      expect(result.eventType).toBe("message.sent");
      expect(result.reason).toBe("noop-provider");
    });

    it("falls back to noop defaults for invalid JSON bodies", () => {
      const adapter = new NoopSmsAdapter();

      const result = adapter.verifyWebhookSignature("{bad json", {});

      expect(result.isValid).toBe(true);
      expect(result.eventId).toBe("noop-event");
      expect(result.eventType).toBe("unsupported");
    });

    it("falls back to noop defaults when the payload is a non-object JSON value", () => {
      const adapter = new NoopSmsAdapter();

      const result = adapter.verifyWebhookSignature(
        JSON.stringify([1, 2, 3]),
        {},
      );

      expect(result.isValid).toBe(true);
      expect(result.eventId).toBe("noop-event");
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses a complete noop webhook body and returns structured event fields", () => {
      const adapter = new NoopSmsAdapter();
      const body = JSON.stringify({
        data: {
          id: "event-1",
          occurred_at: "2026-06-21T12:00:00.000Z",
          payload: {
            id: "msg-1",
            direction: "outbound",
            from: { phone_number: "+14165550199" },
            to: [{ phone_number: "+14165550100", status: "queued" }],
          },
        },
      });

      const event = adapter.parseWebhookEvent(body);

      expect(event.eventId).toBe("event-1");
      expect(event.eventType).toBe("unsupported");
      expect(event.occurredAt).toBe("2026-06-21T12:00:00.000Z");
      expect(event.direction).toBe("outbound");
      expect(event.messageId).toBe("msg-1");
      expect(event.fromPhoneNumber).toBe("+14165550199");
      expect(event.toPhoneNumbers).toEqual(["+14165550100"]);
      expect(event.deliveryStatus).toBe("queued");
      expect(event.errors).toEqual([]);
    });

    it("throws BadRequestError when the data field is absent", () => {
      const adapter = new NoopSmsAdapter();

      expect(() => adapter.parseWebhookEvent("{}")).toThrow(BadRequestError);
    });

    it("throws BadRequestError when the nested payload field is absent", () => {
      const adapter = new NoopSmsAdapter();
      const body = JSON.stringify({ data: { id: "e1" } });

      expect(() => adapter.parseWebhookEvent(body)).toThrow(BadRequestError);
    });

    it("returns empty phone numbers when recipients is not an array", () => {
      const adapter = new NoopSmsAdapter();
      const body = JSON.stringify({
        data: { id: "event-1", payload: { to: "not-an-array" } },
      });

      const event = adapter.parseWebhookEvent(body);

      expect(event.toPhoneNumbers).toEqual([]);
      expect(event.deliveryStatus).toBeUndefined();
    });

    it("returns undefined deliveryStatus for an empty recipients array", () => {
      const adapter = new NoopSmsAdapter();
      const body = JSON.stringify({
        data: { id: "event-1", payload: { to: [] } },
      });

      const event = adapter.parseWebhookEvent(body);

      expect(event.toPhoneNumbers).toEqual([]);
      expect(event.deliveryStatus).toBeUndefined();
    });

    it("normalizes unknown direction values to undefined", () => {
      const adapter = new NoopSmsAdapter();
      const body = JSON.stringify({
        data: {
          id: "event-1",
          payload: { direction: "sideways", to: [] },
        },
      });

      const event = adapter.parseWebhookEvent(body);

      expect(event.direction).toBeUndefined();
    });

    it("parses inbound direction correctly", () => {
      const adapter = new NoopSmsAdapter();
      const body = JSON.stringify({
        data: {
          id: "event-1",
          payload: {
            direction: "inbound",
            to: [{ phone_number: "+14165550100" }],
          },
        },
      });

      const event = adapter.parseWebhookEvent(body);

      expect(event.direction).toBe("inbound");
      expect(event.toPhoneNumbers).toEqual(["+14165550100"]);
    });

    it("filters out recipients without a string phone_number", () => {
      const adapter = new NoopSmsAdapter();
      const body = JSON.stringify({
        data: {
          id: "event-1",
          payload: {
            to: [
              { phone_number: "+14165550100" },
              { phone_number: 12345 },
              { other: "field" },
            ],
          },
        },
      });

      const event = adapter.parseWebhookEvent(body);

      expect(event.toPhoneNumbers).toEqual(["+14165550100"]);
    });
  });

  describe("classifyError", () => {
    it("classifies all errors as unknown and retryable", () => {
      const adapter = new NoopSmsAdapter();

      expect(
        adapter.classifyError(new Error("something went wrong")),
      ).toMatchObject({
        category: "unknown",
        message: "something went wrong",
        retryable: true,
      });
    });

    it("uses a default message for non-Error failures", () => {
      const adapter = new NoopSmsAdapter();

      expect(adapter.classifyError("not an error")).toMatchObject({
        category: "unknown",
        message: "SMS delivery failed.",
        retryable: true,
      });
    });
  });
});
