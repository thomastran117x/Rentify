import { setTimeout as delay } from "node:timers/promises";
import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import { asUuid } from "@/configuration/validation/uuid";
import type { CacheService } from "@/features/cache/cache.service";
import { LOCAL_PASSWORD_RESET_OTP_PURPOSE } from "@/features/auth/otp/otp-purposes";
import type { OtpService } from "@/features/auth/otp/otp.service";
import { SelfLockTokenStore } from "@/features/auth/self-lock/self-lock-token.store";
import type { EmailJobPayload } from "@/features/email/email.model";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type AuthenticatedRequestContext,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { waitForRabbitMqPayload } from "../../support/live-rabbitmq-assertions";

const ORIGIN = "http://localhost:3040";
const PASSWORD = "Rentify123!";
// renter-one is on the harness's MFA bypass list; owner-one must pass a real
// step-up.
const RENTER_EMAIL = "user1@rentify.local";
const RENTER_USERNAME = "renter-one";
const OWNER_EMAIL = "owner1@rentify.local";
const OAUTH_ONLY_EMAIL = "oauth1@rentify.local";
const SOURCE_EVENT_ID = asUuid("00000000-0000-4000-8000-000000378001");

describe("Self-lock (POST /auth/account/self-lock[/session]) integration", () => {
  let persistenceApp: PersistenceTestApp;
  let renterId: string;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  function lockWithToken(token: unknown) {
    return request("/auth/account/self-lock", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ token }),
    });
  }

  function lockCurrentSession(headers: Record<string, string>) {
    return request("/auth/account/self-lock/session", {
      method: "POST",
      headers,
    });
  }

  function login(username = RENTER_USERNAME, password = PASSWORD) {
    return request("/auth/local/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-device-id": "self-lock-device",
      },
      body: JSON.stringify({
        username,
        password,
        captchaToken: "captcha-ok-login",
      }),
    });
  }

  function tokenStore(ttlSeconds?: number) {
    return new SelfLockTokenStore(
      persistenceApp.container.resolve<CacheService>(
        containerTokens.cacheService,
      ),
      ttlSeconds,
    );
  }

  function issueToken(userId = renterId) {
    return tokenStore().issue({
      userId: asUuid(userId),
      sourceEventId: SOURCE_EVENT_ID,
    });
  }

  async function statusOf(userId: string) {
    return (
      await persistenceApp.prisma.user.findUniqueOrThrow({
        where: { id: userId },
      })
    ).status;
  }

  function lockEvents() {
    return persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: "account.locked" },
    });
  }

  async function bodyOf(response: Response) {
    return (await response.json()) as {
      data: unknown;
      error: Record<string, unknown> | null;
    };
  }

  async function completeMfaStepUp(headers: Record<string, string>) {
    const challenge = await request("/auth/mfa/verify/challenge", {
      method: "POST",
      headers,
      body: JSON.stringify({ scope: "mfa-management", factor: "email" }),
    });
    expect(challenge.status).toBe(200);

    const preview = await request(
      "/auth/mfa/verify/dev/otp?scope=mfa-management",
      { headers },
    );
    expect(preview.status).toBe(200);
    const { data } = (await preview.json()) as { data: { code: string } };

    const confirm = await request("/auth/mfa/verify/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({
        scope: "mfa-management",
        factor: "email",
        code: data.code,
      }),
    });
    expect(confirm.status).toBe(200);
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await persistenceApp.prisma.authAuditEvent.deleteMany({});
    renterId = (
      await persistenceApp.prisma.user.findUniqueOrThrow({
        where: { email: RENTER_EMAIL },
      })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  describe("with an emailed token", () => {
    it("locks the account, ends its sessions, audits the source and confirms by email", async () => {
      const renter = await createAuthenticatedRequestContext({
        email: RENTER_EMAIL,
      });
      const token = await issueToken();

      const response = await lockWithToken(token);

      expect(response.status).toBe(200);
      expect((await bodyOf(response)).data).toEqual({ locked: true });
      expect(await statusOf(renterId)).toBe("locked");
      expect(
        (await request("/profile/me", { headers: renter.headers() })).status,
      ).toBe(401);

      const signIn = await login();
      expect(signIn.status).toBe(423);
      expect((await bodyOf(signIn)).error).toMatchObject({
        code: "ACCOUNT_LOCKED",
        details: { reason: "security_hold", recovery: "password_reset" },
      });

      expect(await lockEvents()).toEqual([
        expect.objectContaining({
          userId: renterId,
          actorUserId: null,
          metadata: {
            source: "user",
            channel: "email_link",
            sourceEventId: SOURCE_EVENT_ID,
            previousStatus: "active",
            reason: "Reported by user",
          },
        }),
      ]);
      await waitForRabbitMqPayload<EmailJobPayload>(
        persistenceApp.infra.rabbitMq,
        "email.delivery.main",
        (payload) =>
          payload.kind === "account_self_locked" &&
          "to" in payload.input &&
          payload.input.to === RENTER_EMAIL,
      );
    });

    it("answers a reused token with the generic 410 and changes nothing", async () => {
      const token = await issueToken();
      expect((await lockWithToken(token)).status).toBe(200);
      await persistenceApp.prisma.authAuditEvent.deleteMany({});

      const reuse = await lockWithToken(token);

      expect(reuse.status).toBe(410);
      expect(await bodyOf(reuse)).toMatchObject({
        message: "This link has expired or was already used.",
        error: { code: "GONE" },
      });
      expect(await lockEvents()).toEqual([]);
    });

    it("answers an expired token the same way", async () => {
      const token = await tokenStore(1).issue({
        userId: asUuid(renterId),
        sourceEventId: SOURCE_EVENT_ID,
      });
      await delay(1_500);

      const response = await lockWithToken(token);

      expect(response.status).toBe(410);
      expect(await statusOf(renterId)).toBe("active");
    });

    it("answers an unknown token the same way", async () => {
      const response = await lockWithToken("never-issued");

      expect(response.status).toBe(410);
      expect(await statusOf(renterId)).toBe("active");
    });

    it("rejects a missing token as a validation error", async () => {
      expect((await lockWithToken("")).status).toBe(400);
    });

    it("never downgrades a suspended account, and answers as if it locked", async () => {
      await persistenceApp.prisma.user.update({
        where: { id: renterId },
        data: { status: "suspended" },
      });

      const response = await lockWithToken(await issueToken());

      expect(response.status).toBe(200);
      expect((await bodyOf(response)).data).toEqual({ locked: true });
      expect(await statusOf(renterId)).toBe("suspended");
      expect(await lockEvents()).toEqual([]);
    });

    it("is recovered by a password reset, after which sign-in works", async () => {
      expect((await lockWithToken(await issueToken())).status).toBe(200);

      const forgot = await request("/auth/local/password/forgot", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          username: RENTER_USERNAME,
          captchaToken: "captcha-ok-forgot",
        }),
      });
      expect(forgot.status).toBe(202);
      const otp = await persistenceApp.container
        .resolve<OtpService>(containerTokens.otpService)
        .peek({
          purpose: LOCAL_PASSWORD_RESET_OTP_PURPOSE,
          subject: RENTER_EMAIL,
        });

      const reset = await request("/auth/local/password/reset", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          username: RENTER_USERNAME,
          code: otp!.code,
          newPassword: "RecoveredPassword1!",
          deviceId: "self-lock-reset",
        }),
      });

      expect(reset.status).toBe(200);
      expect(await statusOf(renterId)).toBe("active");
      expect((await login(RENTER_USERNAME, "RecoveredPassword1!")).status).toBe(
        200,
      );
    });
  });

  describe("from the new-device email", () => {
    it("carries a link whose token locks the account and names the alert's event", async () => {
      // With no registered devices, this sign-in is from an unknown device
      // and IP, which is what sends the alert.
      await persistenceApp.prisma.device.deleteMany({
        where: { userId: renterId },
      });

      expect((await login()).status).toBe(200);

      const alert = await waitForRabbitMqPayload<EmailJobPayload>(
        persistenceApp.infra.rabbitMq,
        "email.delivery.main",
        (payload) =>
          payload.kind === "new_device" && payload.input.to === RENTER_EMAIL,
      );
      const token =
        alert.kind === "new_device" ? alert.input.selfLockToken : undefined;
      expect(token).toEqual(expect.any(String));
      const [detected] = await persistenceApp.prisma.authAuditEvent.findMany({
        where: { eventType: "device.new_detected", userId: renterId },
      });

      expect((await lockWithToken(token)).status).toBe(200);

      expect(await statusOf(renterId)).toBe("locked");
      expect(await lockEvents()).toEqual([
        expect.objectContaining({
          metadata: expect.objectContaining({
            channel: "email_link",
            sourceEventId: detected!.id,
          }),
        }),
      ]);
    });
  });

  describe("from a signed-in session", () => {
    it("requires a recent step-up, then locks and clears the session cookies", async () => {
      const owner = await createAuthenticatedRequestContext({
        email: OWNER_EMAIL,
      });
      const headers = owner.headers({ origin: ORIGIN });

      const refused = await lockCurrentSession(headers);
      expect(refused.status).toBe(401);
      expect((await bodyOf(refused)).error).toMatchObject({
        code: "MFA_VERIFICATION_REQUIRED",
      });
      expect(await statusOf(owner.userId)).toBe("active");

      await completeMfaStepUp(headers);
      const response = await lockCurrentSession(headers);

      expect(response.status).toBe(200);
      expect((await bodyOf(response)).data).toEqual({ locked: true });
      expect(response.headers.get("set-cookie")).toContain("refresh_token=;");
      expect(await statusOf(owner.userId)).toBe("locked");
      expect(
        (await request("/profile/me", { headers: owner.headers() })).status,
      ).toBe(401);
      expect(await lockEvents()).toEqual([
        expect.objectContaining({
          userId: owner.userId,
          metadata: expect.objectContaining({
            source: "user",
            channel: "session",
          }),
        }),
      ]);
    });

    it("refuses an account with no password to reset", async () => {
      const oauthUser = await createAuthenticatedRequestContext({
        email: OAUTH_ONLY_EMAIL,
      });
      const headers = oauthUser.headers({ origin: ORIGIN });
      await completeMfaStepUp(headers);

      const response = await lockCurrentSession(headers);

      expect(response.status).toBe(409);
      expect((await bodyOf(response)).error).toMatchObject({
        code: "CONFLICT",
        details: { reason: "password_reset_unavailable" },
      });
      expect(await statusOf(oauthUser.userId)).toBe("active");
    });

    it("rejects an unauthenticated request", async () => {
      const response = await lockCurrentSession({
        "content-type": "application/json",
        origin: ORIGIN,
      });

      expect(response.status).toBe(401);
    });
  });
});
