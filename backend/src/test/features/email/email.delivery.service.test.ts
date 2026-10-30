import type { BookingMessageEmailComposer } from "@/features/bookings/messages/booking-message-email.composer";
import type { PostingExpiryEmailComposer } from "@/features/postings/posting-expiry-email.composer";
import type { SavedSearchEmailComposer } from "@/features/postings/saved-searches/saved-search-email.composer";
import { EmailDeliveryService } from "@/features/email/email.delivery.service";
import { testUuid } from "../../support/uuid";
const BOOKING_1_ID = testUuid(9200, 996753);
const MESSAGE_1_ID = testUuid(9200, 597033);
const SMTP_1_ID = testUuid(9200, 638718);
const USER_1_ID = testUuid(9200, 994257);

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
  postingExpiryComposer: ReturnType<
    typeof createComposerMock
  > = createComposerMock(),
) {
  return new EmailDeliveryService({
    bookingMessageEmailComposer:
      composer as unknown as BookingMessageEmailComposer,
    postingExpiryEmailComposer:
      postingExpiryComposer as unknown as PostingExpiryEmailComposer,
    savedSearchEmailComposer:
      createComposerMock() as unknown as SavedSearchEmailComposer,
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

  it("adds an encoded self-lock link to the new-device email only when it has a token", async () => {
    const transporter = createTransporterMock();
    transporter.sendMail.mockResolvedValue(undefined);
    const service = createService(transporter, {
      appBaseUrl: "https://app.example.com/",
    });

    await service.sendNewDeviceEmail({
      to: "user@example.com",
      selfLockToken: "abc+/=&<x>",
    });
    await service.sendNewDeviceEmail({ to: "user@example.com" });

    const withLink = transporter.sendMail.mock.calls[0]![0] as {
      text: string;
      html: string;
    };
    const url =
      "https://app.example.com/auth/self-lock?token=abc%2B%2F%3D%26%3Cx%3E";
    expect(withLink.text).toContain(`Lock your account now`);
    expect(withLink.text).toContain(url);
    expect(withLink.html).toContain(`href="${url}"`);
    expect(withLink.html).toContain("Lock your account &rarr;");
    expect(withLink.html).not.toContain("<x>");

    const withoutLink = transporter.sendMail.mock.calls[1]![0] as {
      text: string;
      html: string;
    };
    expect(withoutLink.text).not.toContain("self-lock");
    expect(withoutLink.html).not.toContain("self-lock");
    expect(withoutLink.html).toContain("Go to account security");
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
        bookingRequestId: BOOKING_1_ID,
        recipientId: USER_1_ID,
        messageId: MESSAGE_1_ID,
      },
      attempt: 0,
      occurredAt: "2026-08-10T12:00:00.000Z",
    };

    it("delivers a hydrated payload that carries no recipient address", async () => {
      const transporter = createTransporterMock();
      transporter.sendMail.mockResolvedValue({ messageId: SMTP_1_ID });
      const composer = createComposerMock();
      composer.compose.mockResolvedValue({
        to: "owner@example.com",
        firstName: "Ada",
        postingName: "Cargo van",
        authorName: "Jordan Lee",
        snippet: "Is the van available early?",
        bookingRequestId: BOOKING_1_ID,
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
      expect(message.html).toContain(
        `https://app.example.com/bookings/${BOOKING_1_ID}`,
      );
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
        bookingRequestId: BOOKING_1_ID,
      });
      const service = createService(transporter, {}, composer);

      await expect(service.deliver(payload)).resolves.toBeUndefined();
      expect(transporter.sendMail).not.toHaveBeenCalled();
    });

    it("escapes composed content in the rendered html", async () => {
      const transporter = createTransporterMock();
      transporter.sendMail.mockResolvedValue({ messageId: SMTP_1_ID });
      const composer = createComposerMock();
      composer.compose.mockResolvedValue({
        to: "owner@example.com",
        postingName: "<script>alert(1)</script>",
        authorName: "Jordan & Co",
        snippet: "<b>bold</b>",
        bookingRequestId: BOOKING_1_ID,
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

describe("EmailDeliveryService email change templates", () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("routes both email change kinds to their delivery methods", async () => {
    const transporter = createTransporterMock();
    const service = createService(transporter);

    const codeSpy = jest
      .spyOn(service, "sendEmailChangeCodeEmail")
      .mockResolvedValue(undefined);
    const noticeSpy = jest
      .spyOn(service, "sendEmailChangeNoticeEmail")
      .mockResolvedValue(undefined);

    await service.deliver({
      jobId: "job-change-1",
      kind: "email_change_code",
      input: { to: "new@example.com", verificationCode: "424242" },
      attempt: 1,
      occurredAt: "2026-09-07T00:00:00.000Z",
    });
    await service.deliver({
      jobId: "job-change-2",
      kind: "email_change_notice",
      input: { to: "old@example.com", newEmail: "n***@example.com" },
      attempt: 1,
      occurredAt: "2026-09-07T00:00:00.000Z",
    });

    expect(codeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: "new@example.com" }),
    );
    expect(noticeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: "old@example.com" }),
    );
  });

  it("sends the code to the new address and shows it in the body", async () => {
    const transporter = createTransporterMock();
    const service = createService(transporter);

    await service.sendEmailChangeCodeEmail({
      to: "new@example.com",
      verificationCode: "424242",
      firstName: "Owner",
      expiresInMinutes: 10,
    });

    const [message] = transporter.sendMail.mock.calls[0] as [
      { to: string; subject: string; text: string; html: string },
    ];

    expect(message.to).toBe("new@example.com");
    expect(message.subject).toBe("Confirm your new email address");
    expect(message.text).toContain("424242");
    expect(message.html).toContain("424242");
  });

  /**
   * The service hands this template an already-redacted address. Asserting the
   * full address never appears keeps a future edit from "helpfully" rendering
   * the real target into an inbox that may no longer belong to the owner.
   */
  it("warns the old address without naming a code or a full new address", async () => {
    const transporter = createTransporterMock();
    const service = createService(transporter);

    await service.sendEmailChangeNoticeEmail({
      to: "old@example.com",
      newEmail: "n***@example.com",
      firstName: "Owner",
    });

    const [message] = transporter.sendMail.mock.calls[0] as [
      { to: string; subject: string; text: string; html: string },
    ];

    expect(message.to).toBe("old@example.com");
    expect(message.subject).toBe(
      "Someone requested a change to your account email",
    );
    expect(message.html).toContain("n***@example.com");
    expect(message.html).toContain("https://app.example.com/account");
    expect(message.text).not.toContain("Verification code");
  });

  it("suppresses both kinds for non-deliverable local recipients", async () => {
    const transporter = createTransporterMock();
    const service = createService(transporter);

    await service.deliver({
      jobId: "job-change-3",
      kind: "email_change_code",
      input: { to: "owner1@rentify.local", verificationCode: "424242" },
      attempt: 1,
      occurredAt: "2026-09-07T00:00:00.000Z",
    });

    expect(transporter.sendMail).not.toHaveBeenCalled();
  });
});

describe("EmailDeliveryService account status templates", () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function deliverStatusEmail(
    service: EmailDeliveryService,
    kind:
      | "account_locked"
      | "account_self_locked"
      | "account_suspended"
      | "account_reinstated",
    to = "user@example.com",
  ) {
    return service.deliver({
      jobId: `job-${kind}`,
      kind,
      input: { to, firstName: "Jane" },
      attempt: 1,
      occurredAt: "2026-10-21T00:00:00.000Z",
    });
  }

  function sentMessage(transporter: ReturnType<typeof createTransporterMock>) {
    return transporter.sendMail.mock.calls[0]![0] as {
      to: string;
      subject: string;
      text: string;
      html: string;
    };
  }

  it.each([
    [
      "account_locked",
      "Your Rentify account is on a security hold",
      "https://app.example.com/login?recovery=account",
    ],
    [
      "account_self_locked",
      "You locked your Rentify account",
      "https://app.example.com/login?recovery=account",
    ],
    [
      "account_suspended",
      "Your Rentify account has been suspended",
      "contact Rentify support",
    ],
    [
      "account_reinstated",
      "Your Rentify account is active again",
      "https://app.example.com/login",
    ],
  ] as const)(
    "sends %s with its subject and next step",
    async (kind, subject, nextStep) => {
      const transporter = createTransporterMock();
      const service = createService(transporter);

      await deliverStatusEmail(service, kind);

      const message = sentMessage(transporter);
      expect(message.to).toBe("user@example.com");
      expect(message.subject).toBe(subject);
      expect(message.text).toContain("Hi Jane,");
      expect(message.text).toContain(nextStep);
      expect(message.html).toContain(nextStep);
    },
  );

  it("tells a user who locked their own account how to recover", async () => {
    const transporter = createTransporterMock();
    const service = createService(transporter);

    await deliverStatusEmail(service, "account_self_locked");

    const message = sentMessage(transporter);
    expect(message.text).toContain("signed out everywhere");
    expect(message.text).toContain("1. Reset your password:");
    expect(message.text).toContain("someone may have access to your email");
    expect(message.html).toContain("Reset your password");
    expect(message.html).toContain("<ol");
  });

  it.each([
    ["success_after_failures", "right after several failed attempts"],
    ["refresh_reuse", "We ended the affected sign-ins."],
  ] as const)(
    "sends a suspicious_login email for %s with the details and a lock link",
    async (reason, summary) => {
      const transporter = createTransporterMock();
      const service = createService(transporter);

      await service.deliver({
        jobId: `job-${reason}`,
        kind: "suspicious_login",
        input: {
          to: "user@example.com",
          firstName: "Jane",
          reason,
          ipAddress: "198.51.100.7",
          userAgent: "Mozilla/5.0 <script>",
          detectedAt: "2026-10-26T09:00:00.000Z" as any,
          selfLockToken: "lock token",
        },
        attempt: 1,
        occurredAt: "2026-10-26T09:00:00.000Z",
      });

      const message = sentMessage(transporter);
      const url = "https://app.example.com/auth/self-lock?token=lock%20token";
      expect(message.subject).toBe(
        "Suspicious activity on your Rentify account",
      );
      expect(message.text).toContain("Hi Jane,");
      expect(message.text).toContain(summary);
      expect(message.text).toContain("Detected at: 2026-10-26T09:00:00.000Z");
      expect(message.text).toContain("IP address: 198.51.100.7");
      expect(message.text).toContain(url);
      expect(message.html).toContain(summary);
      expect(message.html).toContain(`href="${url}"`);
      expect(message.html).toContain("Go to account security");
      expect(message.html).not.toContain("<script>");
    },
  );

  it("leaves the lock link out of a suspicious_login email without a token", async () => {
    const transporter = createTransporterMock();
    const service = createService(transporter);

    await service.deliver({
      jobId: "job-no-link",
      kind: "suspicious_login",
      input: { to: "user@example.com", reason: "refresh_reuse" },
      attempt: 1,
      occurredAt: "2026-10-26T09:00:00.000Z",
    });

    const message = sentMessage(transporter);
    expect(message.text).not.toContain("self-lock");
    expect(message.html).not.toContain("self-lock");
    expect(message.text).toContain("Detected at:");
  });

  it("suppresses status emails for non-deliverable local recipients", async () => {
    const transporter = createTransporterMock();
    const service = createService(transporter);

    await deliverStatusEmail(service, "account_locked", "user1@rentify.local");

    expect(transporter.sendMail).not.toHaveBeenCalled();
  });
});
