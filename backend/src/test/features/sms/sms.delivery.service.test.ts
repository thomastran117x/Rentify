import { SmsDeliveryService } from "@/features/sms/sms.delivery.service";

describe("SmsDeliveryService", () => {
  it("delegates message delivery to the SMS provider", async () => {
    const sendMessage = jest.fn(async () => ({
      providerMessageId: "msg-1",
      providerStatus: "queued",
      raw: { ok: true },
    }));
    const service = new SmsDeliveryService({ sendMessage } as never);

    const result = await service.deliver({
      jobId: "job-1",
      kind: "message",
      input: { to: "+14165550100", text: "Hello" },
      attempt: 0,
      occurredAt: "2026-06-21T12:00:00.000Z",
    });

    expect(sendMessage).toHaveBeenCalledWith({
      to: "+14165550100",
      text: "Hello",
    });
    expect(result).toMatchObject({ providerMessageId: "msg-1" });
  });

  it("delegates error classification to the SMS provider", () => {
    const classifyError = jest.fn(() => ({
      category: "transient" as const,
      code: "ECONNRESET",
      message: "connection reset",
      retryable: true,
    }));
    const service = new SmsDeliveryService({ classifyError } as never);
    const error = new Error("connection reset");

    const result = service.classifyError(error);

    expect(classifyError).toHaveBeenCalledWith(error);
    expect(result).toMatchObject({ category: "transient", retryable: true });
  });
});
