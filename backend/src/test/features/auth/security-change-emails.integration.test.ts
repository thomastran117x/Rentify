import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import { asUuid } from "@/configuration/validation/uuid";
import type { AuthAuditEventType } from "@/features/auth/audit/auth-audit.model";
import { LOCAL_PASSWORD_RESET_OTP_PURPOSE } from "@/features/auth/otp/otp-purposes";
import type { OtpService } from "@/features/auth/otp/otp.service";
import { SECURITY_EMAIL_LIMIT } from "@/features/auth/security-notification/security-notification.service";
import type {
  EmailJobPayload,
  SecurityChangeEmailJob,
} from "@/features/email/email.model";
import type {
  EmailService,
  SecurityChangeEmailKind,
} from "@/features/email/email.service";
import { peekRabbitMqMessages } from "../../support/live-rabbitmq";
import { waitForRabbitMqPayloads } from "../../support/live-rabbitmq-assertions";
import { completeEmailStepUp } from "../../support/mfa-step-up";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type AuthenticatedRequestContext,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { generateTotpCode } from "../../support/totp-client";

const ORIGIN = "http://localhost:3040";
const QUEUE = "email.delivery.main";
const PASSWORD = "Rentify123!";
const NEW_PASSWORD = "SecurityEmails1!";
// On the harness's MFA bypass list, so guarded actions need no step-up.
const RENTER_EMAIL = "user1@rentify.local";
const RENTER_USERNAME = "renter-one";
const OAUTH_ONLY_EMAIL = "oauth1@rentify.local";
const MOVED_EMAIL = "renter-one-moved@rentify.local";

type QueuedChange = SecurityChangeEmailJob & EmailJobPayload;

describe("Security change emails integration", () => {
  let persistenceApp: PersistenceTestApp;
  let renter: AuthenticatedRequestContext;
  let renterId: string;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  function createPat(name = "Security emails suite") {
    return request("/auth/personal-access-tokens", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({
        name,
        scopes: ["mcp:read"],
        expiresInDays: 30,
      }),
    });
  }

  /** Every queued email of a kind; waits for at least `minMatches` of them. */
  async function queuedEmails(
    kind: SecurityChangeEmailKind,
    minMatches = 1,
  ): Promise<QueuedChange[]> {
    return waitForRabbitMqPayloads<QueuedChange>(
      persistenceApp.infra.rabbitMq,
      QUEUE,
      (payload) => payload.kind === kind,
      { count: 200, minMatches },
    );
  }

  /** Exactly one email, addressed and linked to the event recorded for it. */
  async function expectOneEmail(
    kind: SecurityChangeEmailKind,
    eventType: AuthAuditEventType,
    userId = renterId,
  ) {
    const emails = await queuedEmails(kind);
    expect(emails).toHaveLength(1);

    const [event] = await persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType, userId },
    });
    expect(event?.metadata).toMatchObject({ emailNotification: "sent" });

    return emails[0]!;
  }

  async function enrollAuthenticator() {
    const begin = await request("/auth/mfa/totp/begin", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({ accountName: RENTER_EMAIL }),
    });
    expect(begin.status).toBe(200);
    const { data } = (await begin.json()) as { data: { secret: string } };

    const confirm = await request("/auth/mfa/totp/confirm", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({ code: generateTotpCode(data.secret) }),
    });
    expect(confirm.status).toBe(200);
  }

  async function linkGoogle() {
    const start = await request("/auth/oauth/google/start", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({ intent: "link", deviceId: renter.deviceId }),
    });
    expect(start.status).toBe(200);
    const { data } = (await start.json()) as { data: { state: string } };

    const link = await request("/auth/oauth/google/link", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({
        state: data.state,
        code: "google-code",
        deviceId: renter.deviceId,
      }),
    });
    expect(link.status).toBe(200);
  }

  async function changeEmail() {
    const change = await request("/auth/email/change", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({ email: MOVED_EMAIL }),
    });
    expect(change.status).toBe(202);

    const preview = await request("/auth/email/change/dev/otp", {
      headers: renter.headers(),
    });
    expect(preview.status).toBe(200);
    const { data } = (await preview.json()) as { data: { code: string } };

    const confirm = await request("/auth/email/change/confirm", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({ code: data.code }),
    });
    expect(confirm.status).toBe(200);
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await persistenceApp.prisma.authAuditEvent.deleteMany({});
    renter = await createAuthenticatedRequestContext({ email: RENTER_EMAIL });
    renterId = (
      await persistenceApp.prisma.user.findUniqueOrThrow({
        where: { email: RENTER_EMAIL },
      })
    ).id;
  }, 180_000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("queues password_changed when a password is changed", async () => {
    const response = await request("/auth/local/password/change", {
      method: "POST",
      headers: renter.headers(),
      body: JSON.stringify({
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    });

    expect(response.status).toBe(200);

    const email = await expectOneEmail("password_changed", "password.changed");

    expect(email.input).toMatchObject({
      to: RENTER_EMAIL,
      change: "changed",
      selfLockToken: expect.any(String),
    });
  });

  it("queues password_changed when a password is reset", async () => {
    const otpService = persistenceApp.container.resolve<OtpService>(
      containerTokens.otpService,
    );
    const { code } = await otpService.issue({
      purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
      subject: RENTER_EMAIL,
    });

    const response = await request("/auth/local/password/reset", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        username: RENTER_USERNAME,
        code,
        newPassword: NEW_PASSWORD,
        deviceId: "security-emails-device",
        captchaToken: "captcha-ok-reset",
      }),
    });

    expect(response.status).toBe(200);

    const email = await expectOneEmail("password_changed", "password.reset");

    expect(email.input).toMatchObject({ to: RENTER_EMAIL, change: "reset" });
  });

  it("queues password_changed when a first password is set", async () => {
    const session = await createAuthenticatedRequestContext({
      email: OAUTH_ONLY_EMAIL,
    });
    const { id } = await persistenceApp.prisma.user.findUniqueOrThrow({
      where: { email: OAUTH_ONLY_EMAIL },
    });
    await completeEmailStepUp(persistenceApp.app, session.headers());

    const response = await request("/auth/local/password/set", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({ newPassword: NEW_PASSWORD }),
    });

    expect(response.status).toBe(200);

    const email = await expectOneEmail("password_changed", "password.set", id);

    // The account can reset the password it just gained, so it can be locked.
    expect(email.input).toMatchObject({
      to: OAUTH_ONLY_EMAIL,
      change: "set",
      selfLockToken: expect.any(String),
    });
  });

  it("queues mfa_enabled and mfa_disabled as the authenticator comes and goes", async () => {
    await enrollAuthenticator();

    const enabled = await expectOneEmail("mfa_enabled", "mfa.totp_enabled");
    expect(enabled.input).toMatchObject({
      to: RENTER_EMAIL,
      selfLockToken: expect.any(String),
    });

    const disable = await request("/auth/mfa/totp/disable", {
      method: "POST",
      headers: renter.headers(),
      body: "{}",
    });
    expect(disable.status).toBe(200);

    const disabled = await expectOneEmail("mfa_disabled", "mfa.totp_disabled");
    expect(disabled.input).toMatchObject({
      to: RENTER_EMAIL,
      selfLockToken: expect.any(String),
    });
  });

  it("queues personal_access_token_created with the token's name, scopes and expiry", async () => {
    const response = await createPat("Deploy bot");
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as {
      data: { token: string; expiresAt: string };
    };

    const email = await expectOneEmail(
      "personal_access_token_created",
      "pat.created",
    );

    expect(email.input).toMatchObject({
      to: RENTER_EMAIL,
      tokenName: "Deploy bot",
      scopes: ["mcp:read"],
      expiresAt: data.expiresAt,
      selfLockToken: expect.any(String),
    });
    expect(JSON.stringify(email)).not.toContain(data.token);
  });

  it("queues login_method_linked and login_method_unlinked with the provider", async () => {
    await linkGoogle();

    const linked = await expectOneEmail("login_method_linked", "oauth.linked");
    expect(linked.input).toMatchObject({
      to: RENTER_EMAIL,
      provider: "google",
      selfLockToken: expect.any(String),
    });

    const unlink = await request("/auth/oauth/google", {
      method: "DELETE",
      headers: renter.headers(),
    });
    expect(unlink.status).toBe(200);

    const unlinked = await expectOneEmail(
      "login_method_unlinked",
      "oauth.unlinked",
    );
    expect(unlinked.input).toMatchObject({
      to: RENTER_EMAIL,
      provider: "google",
      selfLockToken: expect.any(String),
    });
  });

  it("queues email_changed to the address the account left", async () => {
    await changeEmail();

    const email = await expectOneEmail("email_changed", "email.changed");

    expect(email.input).toMatchObject({
      to: RENTER_EMAIL,
      newEmail: "r***@rentify.local",
      selfLockToken: expect.any(String),
    });
  });

  it("gives every email a working lock link that names its event", async () => {
    await createPat();

    const email = await expectOneEmail(
      "personal_access_token_created",
      "pat.created",
    );
    const [event] = await persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: "pat.created" },
    });

    const lock = await request("/auth/account/self-lock", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ token: email.input.selfLockToken }),
    });

    expect(lock.status).toBe(200);

    const [locked] = await persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: "account.locked", userId: renterId },
    });

    expect(locked?.metadata).toMatchObject({ sourceEventId: event?.id });
  });

  it("leaves the lock link off an account that could not recover from a lock", async () => {
    const session = await createAuthenticatedRequestContext({
      email: OAUTH_ONLY_EMAIL,
    });
    const { id } = await persistenceApp.prisma.user.findUniqueOrThrow({
      where: { email: OAUTH_ONLY_EMAIL },
    });
    await completeEmailStepUp(persistenceApp.app, session.headers());

    const response = await request("/auth/personal-access-tokens", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({
        name: "Social account",
        scopes: ["mcp:read"],
        expiresInDays: 30,
      }),
    });
    expect(response.status).toBe(201);

    const email = await expectOneEmail(
      "personal_access_token_created",
      "pat.created",
      id,
    );

    expect(email.input).not.toHaveProperty("selfLockToken");
  });

  it("skips an unverified address, and records that it did", async () => {
    await persistenceApp.prisma.user.update({
      where: { id: renterId },
      data: { emailVerified: false },
    });

    expect((await createPat()).status).toBe(201);

    const [event] = await persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: "pat.created", userId: asUuid(renterId) },
    });

    expect(event?.metadata).toMatchObject({ emailNotification: "skipped" });
    // Queued before the response, so nothing can still be on its way.
    const queued = await peekRabbitMqMessages<EmailJobPayload>(
      persistenceApp.infra.rabbitMq,
      QUEUE,
      200,
    );

    expect(
      queued.filter(
        ({ payload }) => payload.kind === "personal_access_token_created",
      ),
    ).toHaveLength(0);
  });

  it("stops at the limit per kind, always sending the first ones", async () => {
    for (let attempt = 0; attempt < SECURITY_EMAIL_LIMIT + 2; attempt += 1) {
      expect((await createPat(`Token ${attempt}`)).status).toBe(201);
    }

    await enrollAuthenticator();

    expect(await queuedEmails("mfa_enabled")).toHaveLength(1);
    expect(
      await queuedEmails("personal_access_token_created", SECURITY_EMAIL_LIMIT),
    ).toHaveLength(SECURITY_EMAIL_LIMIT);

    const events = await persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: "pat.created", userId: renterId },
    });
    const outcomes = events.map(
      (event) =>
        (event.metadata as { emailNotification: string }).emailNotification,
    );

    expect(outcomes.filter((outcome) => outcome === "sent")).toHaveLength(
      SECURITY_EMAIL_LIMIT,
    );
    expect(outcomes.filter((outcome) => outcome === "suppressed")).toHaveLength(
      2,
    );
  });

  it("still makes the change when the email cannot be queued, and records that", async () => {
    jest
      .spyOn(
        persistenceApp.container.resolve<EmailService>(
          containerTokens.emailService,
        ),
        "sendSecurityChangeEmail",
      )
      .mockRejectedValue(new Error("RabbitMQ is down"));

    expect((await createPat()).status).toBe(201);

    const [event] = await persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: "pat.created", userId: renterId },
    });

    expect(event?.metadata).toMatchObject({ emailNotification: "failed" });
    expect(
      await persistenceApp.prisma.personalAccessToken.count({
        where: { userId: renterId },
      }),
    ).toBeGreaterThan(0);
  });
});
