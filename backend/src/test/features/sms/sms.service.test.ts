import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import { SmsService } from "@/features/sms/sms.service";

function createParsedWebhookEvent() {
  return {
    eventId: "event-1",
    eventType: "message.sent" as const,
    occurredAt: "2026-06-21T12:00:00.000Z",
    direction: "outbound" as const,
    messageId: "msg-1",
    fromPhoneNumber: "+14165550199",
    toPhoneNumbers: ["+14165550100"],
    deliveryStatus: "queued",
    payload: {
      data: {
        id: "event-1",
      },
    },
    errors: [],
  };
}

describe("SmsService", () => {
  it("queues outbound SMS jobs instead of delivering inline", async () => {
    const enqueueSmsJob = jest.fn(async () => undefined);
    const service = new SmsService(
      {
        enqueueSmsJob,
      } as any,
      {} as any,
    );

    await service.sendMessage({
      to: "+14165550100",
      text: "Booking confirmed",
      metadata: {
        bookingRequestId: "booking-1",
      },
    });

    expect(enqueueSmsJob).toHaveBeenCalledWith("message", {
      to: "+14165550100",
      text: "Booking confirmed",
      metadata: {
        bookingRequestId: "booking-1",
      },
    });
  });

  it("rejects invalid webhook signatures", async () => {
    const verifyWebhookSignature = jest.fn(() => ({
      isValid: false,
      eventId: "event-1",
      eventType: "message.sent",
      payload: {},
      reason: "signature-mismatch",
    }));
    const parseWebhookEvent = jest.fn();
    const service = new SmsService(
      {} as any,
      {
        verifyWebhookSignature,
        parseWebhookEvent,
      } as any,
    );

    await expect(
      service.processWebhook("{}", {
        signatureEd25519: "bad-signature",
        timestamp: String(Math.floor(Date.now() / 1000)),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(parseWebhookEvent).not.toHaveBeenCalled();
  });

  it("returns parsed webhook events after successful verification", async () => {
    const event = createParsedWebhookEvent();
    const service = new SmsService(
      {} as any,
      {
        verifyWebhookSignature: jest.fn(() => ({
          isValid: true,
          eventId: event.eventId,
          eventType: event.eventType,
          payload: event.payload,
        })),
        parseWebhookEvent: jest.fn(() => event),
      } as any,
    );

    await expect(
      service.processWebhook("{}", {
        signatureEd25519: "good-signature",
        timestamp: String(Math.floor(Date.now() / 1000)),
      }),
    ).resolves.toEqual(event);
  });

  it("normalizes unexpected parse failures into bad-request errors", async () => {
    const service = new SmsService(
      {} as any,
      {
        verifyWebhookSignature: jest.fn(() => ({
          isValid: true,
          eventId: "event-1",
          eventType: "message.sent",
          payload: {},
        })),
        parseWebhookEvent: jest.fn(() => {
          throw new Error("provider exploded");
        }),
      } as any,
    );

    await expect(
      service.processWebhook("{}", {
        signatureEd25519: "good-signature",
        timestamp: String(Math.floor(Date.now() / 1000)),
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("preserves explicit bad-request payload failures from the adapter", async () => {
    const service = new SmsService(
      {} as any,
      {
        verifyWebhookSignature: jest.fn(() => ({
          isValid: true,
          eventId: "event-1",
          eventType: "message.sent",
          payload: {},
        })),
        parseWebhookEvent: jest.fn(() => {
          throw new BadRequestError("SMS webhook payload is invalid.");
        }),
      } as any,
    );

    await expect(
      service.processWebhook("{}", {
        signatureEd25519: "good-signature",
        timestamp: String(Math.floor(Date.now() / 1000)),
      }),
    ).rejects.toMatchObject({
      message: "SMS webhook payload is invalid.",
    });
  });

  it("logs a warning and succeeds for delivery_failed webhook events", async () => {
    const event = {
      ...createParsedWebhookEvent(),
      deliveryStatus: "delivery_failed",
      errors: [{ code: "30007" }],
    };
    const service = new SmsService(
      {} as any,
      {
        verifyWebhookSignature: jest.fn(() => ({
          isValid: true,
          eventId: event.eventId,
          eventType: event.eventType,
          payload: event.payload,
        })),
        parseWebhookEvent: jest.fn(() => event),
      } as any,
    );

    await expect(
      service.processWebhook("{}", {
        signatureEd25519: "good-signature",
        timestamp: String(Math.floor(Date.now() / 1000)),
      }),
    ).resolves.toMatchObject({ deliveryStatus: "delivery_failed" });
  });

  it("logs a warning and succeeds for sending_failed webhook events", async () => {
    const event = {
      ...createParsedWebhookEvent(),
      deliveryStatus: "sending_failed",
      errors: [],
    };
    const service = new SmsService(
      {} as any,
      {
        verifyWebhookSignature: jest.fn(() => ({
          isValid: true,
          eventId: event.eventId,
          eventType: event.eventType,
          payload: event.payload,
        })),
        parseWebhookEvent: jest.fn(() => event),
      } as any,
    );

    await expect(
      service.processWebhook("{}", {
        signatureEd25519: "good-signature",
        timestamp: String(Math.floor(Date.now() / 1000)),
      }),
    ).resolves.toMatchObject({ deliveryStatus: "sending_failed" });
  });

  it("logs a warning and succeeds for unsupported event types", async () => {
    const event = {
      ...createParsedWebhookEvent(),
      eventType: "unsupported" as const,
      deliveryStatus: "queued",
      errors: [],
    };
    const service = new SmsService(
      {} as any,
      {
        verifyWebhookSignature: jest.fn(() => ({
          isValid: true,
          eventId: event.eventId,
          eventType: event.eventType,
          payload: event.payload,
        })),
        parseWebhookEvent: jest.fn(() => event),
      } as any,
    );

    await expect(
      service.processWebhook("{}", {
        signatureEd25519: "good-signature",
        timestamp: String(Math.floor(Date.now() / 1000)),
      }),
    ).resolves.toMatchObject({ eventType: "unsupported" });
  });
});
