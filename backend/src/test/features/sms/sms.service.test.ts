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
      } as never,
      {} as never,
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
      {} as never,
      {
        verifyWebhookSignature,
        parseWebhookEvent,
      } as never,
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
      {} as never,
      {
        verifyWebhookSignature: jest.fn(() => ({
          isValid: true,
          eventId: event.eventId,
          eventType: event.eventType,
          payload: event.payload,
        })),
        parseWebhookEvent: jest.fn(() => event),
      } as never,
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
      {} as never,
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
      } as never,
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
      {} as never,
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
      } as never,
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
});
