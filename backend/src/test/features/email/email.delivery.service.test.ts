import type { BookingMessageEmailComposer } from "@/features/bookings/messages/booking-message-email.composer";
import { EmailDeliveryService } from "@/features/email/email.delivery.service";

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
  overrides: Record<string, unknown> = {},
  composer: ReturnType<typeof createComposerMock> = createComposerMock(),
) {
  return new EmailDeliveryService({
    bookingMessageEmailComposer:
      composer as unknown as BookingMessageEmailComposer,
    transporter: transporter as any,
    gmailUser: "gmail-user@example.com",
    gmailAppPassword: "app-password",
    fromEmail: "noreply@example.com",
    appBaseUrl: "https://app.example.com",
    ...overrides,
  });
}

describe("EmailDeliveryService", () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("routes queued payload kinds to the matching delivery methods", async () => {
    const transporter = createTransporterMock();
    const service = createService(transporter);

    const verificationSpy = jest
      .spyOn(service, "sendVerificationEmail")
      .mockResolvedValue(undefined);
    const deviceSpy = jest
      .spyOn(service, "sendNewDeviceEmail")
      .mockResolvedValue(undefined);
    const unlockSpy = jest
      .spyOn(service, "sendLoginUnlockEmail")
      .mockResolvedValue(undefined);
    const resetSpy = jest
      .spyOn(service, "sendPasswordResetEmail")
      .mockResolvedValue(undefined);
    const usernameReminderSpy = jest
      .spyOn(service, "sendUsernameReminderEmail")
      .mockResolvedValue(undefined);
    const inviteSpy = jest
      .spyOn(service, "sendOrganizationInviteEmail")
      .mockResolvedValue(undefined);

    await service.deliver({
      jobId: "job-1",
      kind: "verification",
      input: {
        to: "user@example.com",
        verificationCode: "111222",
      },
      attempt: 1,
      occurredAt: "2026-06-11T00:00:00.000Z",
    });
    await service.deliver({
      jobId: "job-2",
      kind: "new_device",
      input: {
        to: "user@example.com",
      },
      attempt: 1,
      occurredAt: "2026-06-11T00:00:00.000Z",
    });
    await service.deliver({
      jobId: "job-3",
      kind: "login_unlock",
      input: {
        to: "user@example.com",
        unlockCode: "333444",
      },
      attempt: 1,
      occurredAt: "2026-06-11T00:00:00.000Z",
    });
    await service.deliver({
      jobId: "job-4",
      kind: "password_reset",
      input: {
        to: "user@example.com",
        resetCode: "555666",
      },
      attempt: 1,
      occurredAt: "2026-06-11T00:00:00.000Z",
    });
    await service.deliver({
      jobId: "job-5b",
      kind: "username_reminder",
      input: {
        to: "user@example.com",
        username: "owner-one",
      },
      attempt: 1,
      occurredAt: "2026-06-11T00:00:00.000Z",
    });
    await service.deliver({
      jobId: "job-5",
      kind: "organization_invite",
      input: {
        to: "invitee@example.com",
        organizationName: "Northwind",
        inviterName: "Owner",
        role: "primary_manager",
        token: "invite-1",
      },
      attempt: 1,
      occurredAt: "2026-06-11T00:00:00.000Z",
    });

    expect(verificationSpy).toHaveBeenCalledWith({
      to: "user@example.com",
      verificationCode: "111222",
    });
    expect(deviceSpy).toHaveBeenCalledWith({
      to: "user@example.com",
    });
    expect(unlockSpy).toHaveBeenCalledWith({
      to: "user@example.com",
      unlockCode: "333444",
    });
    expect(resetSpy).toHaveBeenCalledWith({
      to: "user@example.com",
      resetCode: "555666",
    });
    expect(usernameReminderSpy).toHaveBeenCalledWith({
      to: "user@example.com",
      username: "owner-one",
    });
    expect(inviteSpy).toHaveBeenCalledWith({
      to: "invitee@example.com",
      organizationName: "Northwind",
      inviterName: "Owner",
      role: "primary_manager",
      token: "invite-1",
    });
  });

  it("suppresses delivery to non-deliverable seeded recipients without sending", async () => {
    const transporter = createTransporterMock();
    const service = createService(transporter);
    const verificationSpy = jest.spyOn(service, "sendVerificationEmail");

    await service.deliver({
      jobId: "job-suppressed",
      kind: "verification",
      input: {
        to: "owner1@rentify.local",
        verificationCode: "111222",
      },
      attempt: 1,
      occurredAt: "2026-06-11T00:00:00.000Z",
    });

    expect(verificationSpy).not.toHaveBeenCalled();
    expect(transporter.sendMail).not.toHaveBeenCalled();
  });

  it("delivers to real recipients that are not suppressed", async () => {
    const transporter = createTransporterMock();
    const service = createService(transporter);
    const verificationSpy = jest
      .spyOn(service, "sendVerificationEmail")
      .mockResolvedValue(undefined);

    await service.deliver({
      jobId: "job-delivered",
      kind: "verification",
      input: {
        to: "real-user@example.com",
        verificationCode: "111222",
      },
      attempt: 1,
      occurredAt: "2026-06-11T00:00:00.000Z",
    });

    expect(verificationSpy).toHaveBeenCalledWith({
      to: "real-user@example.com",
      verificationCode: "111222",
    });
  });

  it("renders verification emails with escaped HTML and default greeting text", async () => {
    const transporter = createTransporterMock();
    transporter.sendMail.mockResolvedValue(undefined);
    const service = createService(transporter, {
      fromName: "Rent Team",
      appBaseUrl: "https://app.example.com/",
    });

    await service.sendVerificationEmail({
      to: "user@example.com",
      firstName: "  <Mia>  ",
      verificationCode: `12<&"'34`,
      expiresInMinutes: 10,
    });
    await service.sendVerificationEmail({
      to: "second@example.com",
      verificationCode: "ABC123",
      firstName: "   ",
    });

    expect(transporter.sendMail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        from: "Rent Team <noreply@example.com>",
        to: "user@example.com",
        subject: "Verify your email address",
        text: expect.stringContaining("Hi <Mia>,"),
        html: expect.stringContaining("Hi &lt;Mia&gt;"),
      }),
    );
    expect(transporter.sendMail.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        html: expect.stringContaining("12&lt;&amp;&quot;&#39;34"),
      }),
    );
    expect(transporter.sendMail.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("This code expires in 10 minutes."),
        html: expect.stringContaining("This code expires in 10 minutes."),
      }),
    );
    expect(transporter.sendMail.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("Hi there,"),
      }),
    );
    // Falls back to non-specific copy when no expiry is provided.
    expect(transporter.sendMail.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("This code expires soon."),
      }),
    );
  });

  it("renders new-device and organization-invite emails with optional details and encoded URLs", async () => {
    const transporter = createTransporterMock();
    transporter.sendMail.mockResolvedValue(undefined);
    const service = createService(transporter, {
      appBaseUrl: "https://app.example.com///",
    });

    await service.sendNewDeviceEmail({
      to: "user@example.com",
      firstName: "Mia",
      deviceLabel: "Chrome on macOS",
      platform: "macOS",
      ipAddress: "127.0.0.1",
      userAgent: "Mozilla/5.0",
      detectedAt: "2026-06-10T12:34:56.000Z" as any,
    });
    await service.sendOrganizationInviteEmail({
      to: "invitee@example.com",
      organizationName: "North & Co",
      inviterName: "Ava <Owner>",
      role: "primary_manager",
      token: "invite token/with spaces",
    });

    expect(transporter.sendMail.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        subject: "New device sign-in detected",
        text: expect.stringContaining("Detected at: 2026-06-10T12:34:56.000Z"),
        html: expect.stringContaining("IP address: 127.0.0.1"),
      }),
    );
    expect(transporter.sendMail.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        subject: "Join North & Co on Rent",
        text: expect.stringContaining("Role: primary manager"),
        html: expect.stringContaining(
          "https://app.example.com/organizations/invitations/invite%20token%2Fwith%20spaces",
        ),
      }),
    );
  });

  it("renders login-unlock and password-reset emails", async () => {
    const transporter = createTransporterMock();
    transporter.sendMail.mockResolvedValue(undefined);
    const service = createService(transporter);

    await service.sendLoginUnlockEmail({
      to: "user@example.com",
      firstName: "Kai",
      unlockCode: "777888",
    });
    await service.sendPasswordResetEmail({
      to: "user@example.com",
      firstName: "Kai",
      resetCode: "999000",
      expiresInMinutes: 10,
    });

    expect(transporter.sendMail.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        subject: "Unlock your Rent sign-in",
        text: expect.stringContaining("Unlock code: 777888"),
      }),
    );
    expect(transporter.sendMail.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        subject: "Reset your Rent password",
        text: expect.stringContaining("Reset code: 999000"),
        html: expect.stringContaining("This code expires in 10 minutes."),
      }),
    );
  });

  it("renders the username inside the reminder email", async () => {
    const transporter = createTransporterMock();
    transporter.sendMail.mockResolvedValue(undefined);
    const service = createService(transporter);

    await service.sendUsernameReminderEmail({
      to: "user@example.com",
      firstName: "Kai",
      username: "kai-owner",
    });

    expect(transporter.sendMail.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        subject: "Your Rentify username",
        text: expect.stringContaining("Username: kai-owner"),
        html: expect.stringContaining("kai-owner"),
      }),
    );
  });

  it("verifies the underlying transporter connection", async () => {
    const transporter = createTransporterMock();
    transporter.verify.mockResolvedValue(undefined);
    const service = createService(transporter);

    await service.verifyConnection();

    expect(transporter.verify).toHaveBeenCalledTimes(1);
  });

  it("retries transient transport errors before succeeding", async () => {
    jest.useFakeTimers();
    const transporter = createTransporterMock();
    const transientError = Object.assign(new Error("temporary connection"), {
      code: "ECONNRESET",
    });
    transporter.sendMail
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(undefined);
    const service = createService(transporter, {
      initialDelayMs: 1,
      maxDelayMs: 1,
    });

    const promise = service.sendVerificationEmail({
      to: "user@example.com",
      verificationCode: "123456",
    });

    await jest.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(transporter.sendMail).toHaveBeenCalledTimes(2);
  });

  it("throws non-transient and unknown delivery failures after the final attempt", async () => {
    const firstTransporter = createTransporterMock();
    firstTransporter.sendMail.mockRejectedValue(new Error("permanent failure"));
    const firstService = createService(firstTransporter, {
      maxRetries: 0,
    });

    await expect(
      firstService.sendVerificationEmail({
        to: "user@example.com",
        verificationCode: "123456",
      }),
    ).rejects.toThrow("permanent failure");

    const secondTransporter = createTransporterMock();
    secondTransporter.sendMail.mockRejectedValue("nope");
    const secondService = createService(secondTransporter, {
      maxRetries: 0,
    });

    await expect(
      secondService.sendVerificationEmail({
        to: "user@example.com",
        verificationCode: "123456",
      }),
    ).rejects.toThrow("Email delivery failed.");
  });

  it("classifies transient failures and calculates bounded retry delays", () => {
    const transporter = createTransporterMock();
    const service = createService(transporter, {
      initialDelayMs: 100,
      maxDelayMs: 250,
      backoffMultiplier: 3,
    });
    const helper = service as unknown as {
      isTransientError(error: unknown): boolean;
      calculateDelayMs(attempt: number): number;
    };

    expect(
      helper.isTransientError(
        Object.assign(new Error("irrelevant"), { code: "ESOCKET" }),
      ),
    ).toBe(true);
    expect(
      helper.isTransientError(
        Object.assign(new Error("SMTP greeting timeout"), {
          command: "MAIL",
        }),
      ),
    ).toBe(true);
    expect(helper.isTransientError(new Error("permanent failure"))).toBe(false);
    expect(helper.isTransientError("oops")).toBe(false);

    const originalRandom = Math.random;
    Math.random = () => 0.5;

    try {
      expect(helper.calculateDelayMs(0)).toBeGreaterThanOrEqual(100);
      expect(helper.calculateDelayMs(1)).toBeGreaterThanOrEqual(250);
      expect(helper.calculateDelayMs(1)).toBeLessThan(300);
    } finally {
      Math.random = originalRandom;
    }
  });

  describe("booking message notifications", () => {
    const payload = {
      jobId: "job-1",
      kind: "booking_message" as const,
      input: {
        bookingRequestId: "booking-1",
        recipientId: "user-1",
        messageId: "message-1",
      },
      attempt: 0,
      occurredAt: "2026-08-10T12:00:00.000Z",
    };

    it("delivers a hydrated payload that carries no recipient address", async () => {
      const transporter = createTransporterMock();
      transporter.sendMail.mockResolvedValue({ messageId: "smtp-1" });
      const composer = createComposerMock();
      composer.compose.mockResolvedValue({
        to: "owner@example.com",
        firstName: "Ada",
        postingName: "Cargo van",
        authorName: "Jordan Lee",
        snippet: "Is the van available early?",
        bookingRequestId: "booking-1",
      });
      const service = createService(transporter, {}, composer);

      // The payload deliberately has no `input.to`; delivery must not
      // dereference one before the composer resolves the recipient.
      await expect(service.deliver(payload)).resolves.toBeUndefined();

      expect(composer.compose).toHaveBeenCalledWith(payload.input);
      expect(transporter.sendMail).toHaveBeenCalledTimes(1);

      const message = transporter.sendMail.mock.calls[0][0];
      expect(message.to).toBe("owner@example.com");
      expect(message.subject).toBe("New message about Cargo van");
      expect(message.html).toContain("https://app.example.com/bookings/booking-1");
      expect(message.html).toContain("Jordan Lee");
      expect(message.text).toContain("Is the van available early?");
    });

    it("skips delivery when the referenced records no longer exist", async () => {
      const transporter = createTransporterMock();
      const composer = createComposerMock();
      composer.compose.mockResolvedValue(null);
      const service = createService(transporter, {}, composer);

      await expect(service.deliver(payload)).resolves.toBeUndefined();
      expect(transporter.sendMail).not.toHaveBeenCalled();
    });

    it("suppresses non-deliverable composed recipients", async () => {
      const transporter = createTransporterMock();
      const composer = createComposerMock();
      composer.compose.mockResolvedValue({
        to: "owner1@rentify.local",
        postingName: "Cargo van",
        authorName: "Jordan Lee",
        snippet: "Hello",
        bookingRequestId: "booking-1",
      });
      const service = createService(transporter, {}, composer);

      await expect(service.deliver(payload)).resolves.toBeUndefined();
      expect(transporter.sendMail).not.toHaveBeenCalled();
    });

    it("escapes composed content in the rendered html", async () => {
      const transporter = createTransporterMock();
      transporter.sendMail.mockResolvedValue({ messageId: "smtp-1" });
      const composer = createComposerMock();
      composer.compose.mockResolvedValue({
        to: "owner@example.com",
        postingName: "<script>alert(1)</script>",
        authorName: "Jordan & Co",
        snippet: "<b>bold</b>",
        bookingRequestId: "booking-1",
      });
      const service = createService(transporter, {}, composer);

      await service.deliver(payload);

      const message = transporter.sendMail.mock.calls[0][0];
      expect(message.html).not.toContain("<script>");
      expect(message.html).toContain("&lt;script&gt;");
      expect(message.html).toContain("Jordan &amp; Co");
      expect(message.html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    });
  });
});
