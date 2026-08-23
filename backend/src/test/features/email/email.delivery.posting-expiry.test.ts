import type { BookingMessageEmailComposer } from "@/features/bookings/messages/booking-message-email.composer";
import { EmailDeliveryService } from "@/features/email/email.delivery.service";
import type { PostingExpiryEmailComposer } from "@/features/postings/posting-expiry-email.composer";

function createTransporterMock() {
  return {
    sendMail: jest.fn(),
    verify: jest.fn(),
  };
}

function createComposerMock() {
  return {
    compose: jest.fn(),
  };
}

function createService(
  transporter: ReturnType<typeof createTransporterMock>,
  postingExpiryComposer: ReturnType<typeof createComposerMock>,
) {
  return new EmailDeliveryService({
    bookingMessageEmailComposer:
      createComposerMock() as unknown as BookingMessageEmailComposer,
    postingExpiryEmailComposer:
      postingExpiryComposer as unknown as PostingExpiryEmailComposer,
    transporter: transporter as never,
    gmailUser: "gmail-user@example.com",
    gmailAppPassword: "app-password",
    fromEmail: "noreply@example.com",
    appBaseUrl: "https://app.example.com",
  });
}

const payload = {
  jobId: "job-1",
  kind: "posting_expiring_soon" as const,
  input: {
    postingId: "posting-1",
    recipientId: "user-1",
    expiresAt: "2026-09-01T23:59:59.999Z",
  },
  attempt: 0,
  occurredAt: "2026-08-29T12:00:00.000Z",
};

describe("EmailDeliveryService posting expiry reminders", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("delivers a hydrated payload that carries no recipient address", async () => {
    const transporter = createTransporterMock();
    transporter.sendMail.mockResolvedValue({ messageId: "smtp-1" });
    const composer = createComposerMock();
    composer.compose.mockResolvedValue({
      to: "owner@example.com",
      firstName: "Ada",
      postingId: "posting-1",
      postingName: "Lakeside cabin",
      expiresAt: "2026-09-01T23:59:59.999Z",
    });
    const service = createService(transporter, composer);

    // The payload deliberately has no `input.to`; delivery must route to the
    // composer before anything dereferences a recipient address.
    await expect(service.deliver(payload)).resolves.toBeUndefined();

    expect(composer.compose).toHaveBeenCalledWith(payload.input);
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);

    const message = transporter.sendMail.mock.calls[0][0];
    expect(message.to).toBe("owner@example.com");
    expect(message.subject).toContain("Lakeside cabin");
    expect(message.subject).toContain("September 1, 2026");
    expect(message.text).toContain("Ada");
    expect(message.text).toContain("https://app.example.com/postings/manage");
    expect(message.html).toContain("Lakeside cabin");
  });

  it("acknowledges without sending when the reminder no longer applies", async () => {
    const transporter = createTransporterMock();
    const composer = createComposerMock();
    composer.compose.mockResolvedValue(null);
    const service = createService(transporter, composer);

    await expect(service.deliver(payload)).resolves.toBeUndefined();

    expect(transporter.sendMail).not.toHaveBeenCalled();
  });

  it("suppresses delivery to a non-deliverable recipient the composer resolved", async () => {
    const transporter = createTransporterMock();
    const composer = createComposerMock();
    composer.compose.mockResolvedValue({
      to: "owner@rentify.local",
      postingId: "posting-1",
      postingName: "Lakeside cabin",
      expiresAt: "2026-09-01T23:59:59.999Z",
    });
    const service = createService(transporter, composer);

    await expect(service.deliver(payload)).resolves.toBeUndefined();

    expect(transporter.sendMail).not.toHaveBeenCalled();
  });
});
