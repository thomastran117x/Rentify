import type { BookingMessageEmailComposer } from "@/features/bookings/messages/booking-message-email.composer";
import { EmailDeliveryService } from "@/features/email/email.delivery.service";
import type {
  EmailJobPayload,
  SecurityChangeEmailJob,
} from "@/features/email/email.model";
import type { SecurityChangeEmailBase } from "@/features/email/email.service";
import type { PostingExpiryEmailComposer } from "@/features/postings/posting-expiry-email.composer";
import type { SavedSearchEmailComposer } from "@/features/postings/saved-searches/saved-search-email.composer";

const BASE: SecurityChangeEmailBase = {
  to: "owner@example.com",
  firstName: "Avery",
  occurredAt: "2026-11-04T10:15:00.000Z",
  ipAddress: "203.0.113.7",
  device: "Chrome on Windows",
};

const JOBS: Array<[string, SecurityChangeEmailJob, string]> = [
  [
    "a changed password",
    { kind: "password_changed", input: { ...BASE, change: "changed" } },
    "Your Rentify password was changed",
  ],
  [
    "a reset password",
    { kind: "password_changed", input: { ...BASE, change: "reset" } },
    "Your Rentify password was reset",
  ],
  [
    "an added password",
    { kind: "password_changed", input: { ...BASE, change: "set" } },
    "A password was added to your Rentify account",
  ],
  [
    "an added authenticator",
    { kind: "mfa_enabled", input: BASE },
    "An authenticator app was added to your Rentify account",
  ],
  [
    "a removed authenticator",
    { kind: "mfa_disabled", input: BASE },
    "The authenticator app was removed from your Rentify account",
  ],
  [
    "a used recovery code",
    { kind: "mfa_recovery_code_used", input: { ...BASE, remaining: 4 } },
    "A recovery code was used on your Rentify account",
  ],
  [
    "regenerated recovery codes",
    { kind: "mfa_recovery_codes_regenerated", input: BASE },
    "New recovery codes were generated for your Rentify account",
  ],
  [
    "an added passkey",
    { kind: "passkey_added", input: { ...BASE, passkeyName: "Laptop" } },
    "A passkey was added to your Rentify account",
  ],
  [
    "a removed passkey",
    { kind: "passkey_removed", input: { ...BASE, passkeyName: "Laptop" } },
    "A passkey was removed from your Rentify account",
  ],
  [
    "a new personal access token",
    {
      kind: "personal_access_token_created",
      input: {
        ...BASE,
        tokenName: "CI",
        scopes: ["mcp:read"],
        expiresAt: null,
      },
    },
    "A personal access token was created on your Rentify account",
  ],
  [
    "a linked provider",
    { kind: "login_method_linked", input: { ...BASE, provider: "google" } },
    "Google was linked to your Rentify account",
  ],
  [
    "an unlinked provider",
    { kind: "login_method_unlinked", input: { ...BASE, provider: "apple" } },
    "Apple was unlinked from your Rentify account",
  ],
  [
    "a changed email",
    { kind: "email_changed", input: { ...BASE, newEmail: "n***@example.com" } },
    "The email on your Rentify account was changed",
  ],
];

function toPayload(job: SecurityChangeEmailJob): EmailJobPayload {
  return {
    ...job,
    jobId: "job-1",
    attempt: 0,
    occurredAt: BASE.occurredAt,
  } as EmailJobPayload;
}

function createComposerMock() {
  return { compose: jest.fn() };
}

function createService() {
  const transporter = { sendMail: jest.fn(), verify: jest.fn() };
  const service = new EmailDeliveryService({
    bookingMessageEmailComposer:
      createComposerMock() as unknown as BookingMessageEmailComposer,
    postingExpiryEmailComposer:
      createComposerMock() as unknown as PostingExpiryEmailComposer,
    savedSearchEmailComposer:
      createComposerMock() as unknown as SavedSearchEmailComposer,
    transporter: transporter as never,
    gmailUser: "gmail-user@example.com",
    gmailAppPassword: "app-password",
    fromEmail: "noreply@example.com",
    appBaseUrl: "https://app.example.com",
  });

  return { service, transporter };
}

async function render(job: SecurityChangeEmailJob) {
  const { service, transporter } = createService();

  await service.deliver(toPayload(job));

  expect(transporter.sendMail).toHaveBeenCalledTimes(1);

  return transporter.sendMail.mock.calls[0]![0] as {
    to: string;
    subject: string;
    text: string;
    html: string;
  };
}

describe("EmailDeliveryService security-change emails", () => {
  it.each(JOBS)(
    "renders %s with the time, device and address",
    async (_label, job, subject) => {
      const message = await render(job);

      expect(message.to).toBe("owner@example.com");
      expect(message.subject).toBe(subject);

      for (const body of [message.text, message.html]) {
        expect(body).toContain("Hi");
        expect(body).toContain("Avery");
        expect(body).toContain("Time: Wed, 04 Nov 2026 10:15:00 GMT");
        expect(body).toContain("Device: Chrome on Windows");
        expect(body).toContain("IP address: 203.0.113.7");
      }

      expect(message.html).toContain("https://app.example.com/account");
    },
  );

  it.each(JOBS)(
    "adds the lock link to %s when a token is issued",
    async (_label, job) => {
      const message = await render({
        ...job,
        input: { ...job.input, selfLockToken: "lock token" },
      } as SecurityChangeEmailJob);
      const url = "https://app.example.com/auth/self-lock?token=lock%20token";

      expect(message.text).toContain(url);
      expect(message.html).toContain(url);
    },
  );

  it.each(JOBS)(
    "leaves the lock link out of %s without a token",
    async (_label, job) => {
      const message = await render(job);

      expect(message.text).not.toContain("/auth/self-lock");
      expect(message.html).not.toContain("/auth/self-lock");
    },
  );

  it("leaves out the device and address when they are unknown", async () => {
    const { ipAddress: _ipAddress, device: _device, ...input } = BASE;
    const message = await render({ kind: "mfa_enabled", input });

    expect(message.text).toContain("Time:");
    expect(message.text).not.toContain("Device:");
    expect(message.text).not.toContain("IP address:");
  });

  it("falls back to a neutral greeting", async () => {
    const { firstName: _firstName, ...input } = BASE;
    const message = await render({ kind: "mfa_disabled", input });

    expect(message.text).toContain("Hi there,");
  });

  it("names a personal access token's scopes and expiry", async () => {
    const message = await render({
      kind: "personal_access_token_created",
      input: {
        ...BASE,
        tokenName: "Deploy bot",
        scopes: ["mcp:read", "mcp:write"],
        expiresAt: "2026-12-04T00:00:00.000Z",
      },
    });

    expect(message.text).toContain("Token name: Deploy bot");
    expect(message.text).toContain("Scopes: mcp:read, mcp:write");
    expect(message.text).toContain("Expires: Fri, 04 Dec 2026 00:00:00 GMT");
  });

  it("keeps a token name on one line, so it cannot forge the email's text", async () => {
    const message = await render({
      kind: "personal_access_token_created",
      input: {
        ...BASE,
        tokenName: "CI\n\nIf this was you, no action is needed.",
        scopes: ["mcp:read"],
        expiresAt: null,
      },
    });

    expect(message.text).toContain(
      "- Token name: CI If this was you, no action is needed.\n",
    );
  });

  it("names the passkey on one line, so its name cannot forge the email's text", async () => {
    const message = await render({
      kind: "passkey_removed",
      input: { ...BASE, passkeyName: "  Old\n\nkey  " },
    });

    expect(message.text).toContain("- Passkey: Old key\n");
  });

  it("says other sign-ins stayed when a passkey still protects the account", async () => {
    const kept = await render({
      kind: "mfa_disabled",
      input: { ...BASE, endedOtherSessions: false },
    });
    const ended = await render({ kind: "mfa_disabled", input: BASE });

    expect(kept.text).toContain("your passkeys still work");
    expect(kept.text).not.toContain("every other sign-in was ended");
    // Jobs queued before the flag existed always ended the other sessions.
    expect(ended.text).toContain("every other sign-in was ended");
  });

  it("says when removing the last passkey ended the other sign-ins", async () => {
    const message = await render({
      kind: "passkey_removed",
      input: { ...BASE, passkeyName: "Laptop", endedOtherSessions: true },
    });

    expect(message.text).toContain("every other sign-in was ended");
    expect(message.text).toContain("recovery codes stopped working");
  });

  it("advises a reset, since a changed password locks the owner out of changing it", async () => {
    const message = await render({
      kind: "password_changed",
      input: { ...BASE, change: "changed" },
    });

    expect(message.text).toContain("If this wasn't you, reset your password");
    expect(message.html).toContain("reset your password");
  });

  it("says a personal access token with no expiry never expires", async () => {
    const message = await render({
      kind: "personal_access_token_created",
      input: { ...BASE, tokenName: "CI", scopes: [], expiresAt: null },
    });

    expect(message.text).toContain("Expires: never");
  });

  it("escapes a token name in the html body", async () => {
    const message = await render({
      kind: "personal_access_token_created",
      input: {
        ...BASE,
        tokenName: `<img src=x onerror="alert(1)">`,
        scopes: ["mcp:read"],
        expiresAt: null,
      },
    });

    expect(message.html).not.toContain("<img src=x");
    expect(message.html).toContain("&lt;img src=x");
  });

  it("escapes a first name in the html body", async () => {
    const message = await render({
      kind: "mfa_enabled",
      input: { ...BASE, firstName: "<b>Avery</b>" },
    });

    expect(message.html).not.toContain("<b>Avery</b>");
  });

  it("names the provider a sign-in method change was about", async () => {
    const linked = await render({
      kind: "login_method_linked",
      input: { ...BASE, provider: "microsoft" },
    });

    expect(linked.text).toContain("A Microsoft account was just linked");
  });

  it("names the redacted new address in an email_changed email", async () => {
    const message = await render({
      kind: "email_changed",
      input: { ...BASE, newEmail: "n***@example.com" },
    });

    expect(message.text).toContain("now uses n***@example.com");
  });

  it("adds the revert link to an email_changed email with a token", async () => {
    const message = await render({
      kind: "email_changed",
      input: {
        ...BASE,
        newEmail: "n***@example.com",
        revertToken: "revert token",
      },
    });
    const url =
      "https://app.example.com/auth/email-change/revert?token=revert%20token";

    expect(message.text).toContain(url);
    expect(message.text).toContain("within 7 days");
    expect(message.html).toContain(url);
    expect(message.html).toContain("put my old email back");
  });

  it("leaves the revert link out without a token", async () => {
    const message = await render({
      kind: "email_changed",
      input: { ...BASE, newEmail: "n***@example.com" },
    });

    expect(message.text).not.toContain("/auth/email-change/revert");
    expect(message.html).not.toContain("/auth/email-change/revert");
  });

  it("does not send to a suppressed recipient", async () => {
    const { service, transporter } = createService();

    await service.deliver(
      toPayload({
        kind: "mfa_enabled",
        input: { ...BASE, to: "owner1@rentify.local" },
      }),
    );

    expect(transporter.sendMail).not.toHaveBeenCalled();
  });
});
