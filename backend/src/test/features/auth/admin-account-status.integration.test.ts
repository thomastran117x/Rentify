import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import { LOCAL_PASSWORD_RESET_OTP_PURPOSE } from "@/features/auth/otp/otp-purposes";
import type { OtpService } from "@/features/auth/otp/otp.service";
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
const ADMIN_EMAIL = "admin1@rentify.local";
const RENTER_EMAIL = "user1@rentify.local";
// renter-one is on the harness's MFA bypass list, so a sign-in that passes the
// status check goes straight to a session.
const RENTER_USERNAME = "renter-one";
const REASON = "Reported account takeover";

describe("Admin account status (POST /admin/users/:id/lock|suspend|reinstate) integration", () => {
  let persistenceApp: PersistenceTestApp;
  let admin: AuthenticatedRequestContext;
  let renterId: string;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  function changeStatus(
    action: "lock" | "suspend" | "reinstate",
    userId: string,
    body: unknown = { reason: REASON },
    headers: Record<string, string> = admin.headers({ origin: ORIGIN }),
  ) {
    return request(`/admin/users/${userId}/${action}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  function login(username = RENTER_USERNAME, password = PASSWORD) {
    return request("/auth/local/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-device-id": "admin-account-status-device",
      },
      body: JSON.stringify({
        username,
        password,
        captchaToken: "captcha-ok-login",
      }),
    });
  }

  function readProfile(context: AuthenticatedRequestContext) {
    return request("/profile/me", { headers: context.headers() });
  }

  async function errorOf(response: Response) {
    return ((await response.json()) as { error: Record<string, unknown> })
      .error;
  }

  function statusEvents() {
    return persistenceApp.prisma.authAuditEvent.findMany({
      where: { eventType: { startsWith: "account." } },
      orderBy: { createdAt: "asc" },
    });
  }

  function waitForStatusEmail(kind: EmailJobPayload["kind"]) {
    return waitForRabbitMqPayload<EmailJobPayload>(
      persistenceApp.infra.rabbitMq,
      "email.delivery.main",
      (payload) =>
        payload.kind === kind &&
        "to" in payload.input &&
        payload.input.to === RENTER_EMAIL,
    );
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await persistenceApp.prisma.authAuditEvent.deleteMany({});
    admin = await createAuthenticatedRequestContext({ email: ADMIN_EMAIL });
    renterId = (
      await persistenceApp.prisma.user.findUniqueOrThrow({
        where: { email: RENTER_EMAIL },
      })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  describe("lock", () => {
    it("ends the user's sessions, refuses sign-in with recovery details, audits and emails", async () => {
      const renter = await createAuthenticatedRequestContext({
        email: RENTER_EMAIL,
      });
      expect((await readProfile(renter)).status).toBe(200);

      const response = await changeStatus("lock", renterId);

      expect(response.status).toBe(200);
      expect(((await response.json()) as { data: unknown }).data).toMatchObject(
        {
          userId: renterId,
          status: "locked",
          statusReason: REASON,
          statusChangedBy: admin.userId,
          changed: true,
        },
      );
      expect((await readProfile(renter)).status).toBe(401);

      const loginResponse = await login();
      expect(loginResponse.status).toBe(423);
      expect(await errorOf(loginResponse)).toMatchObject({
        code: "ACCOUNT_LOCKED",
        details: { reason: "security_hold", recovery: "password_reset" },
      });

      const user = await persistenceApp.prisma.user.findUniqueOrThrow({
        where: { id: renterId },
      });
      expect(user).toMatchObject({
        status: "locked",
        statusReason: REASON,
        statusChangedBy: admin.userId,
      });
      expect(await statusEvents()).toEqual([
        expect.objectContaining({
          eventType: "account.locked",
          userId: renterId,
          actorUserId: admin.userId,
          metadata: {
            source: "admin",
            previousStatus: "active",
            reason: REASON,
          },
        }),
      ]);
      const email = await waitForStatusEmail("account_locked");
      expect(JSON.stringify(email.input)).not.toContain(REASON);
    });

    it("refuses to downgrade a suspended account to a security hold", async () => {
      expect((await changeStatus("suspend", renterId)).status).toBe(200);

      const response = await changeStatus("lock", renterId);

      expect(response.status).toBe(409);
      expect(
        (
          await persistenceApp.prisma.user.findUniqueOrThrow({
            where: { id: renterId },
          })
        ).status,
      ).toBe("suspended");
    });
  });

  describe("suspend and reinstate", () => {
    it("suspends with a 403 at sign-in and at password reset, then reinstates", async () => {
      expect((await changeStatus("suspend", renterId)).status).toBe(200);

      const loginResponse = await login();
      expect(loginResponse.status).toBe(403);
      expect(await errorOf(loginResponse)).toMatchObject({
        code: "ACCOUNT_SUSPENDED",
      });
      await waitForStatusEmail("account_suspended");

      const reinstated = await changeStatus("reinstate", renterId, {
        reason: "Appeal upheld",
      });
      expect(reinstated.status).toBe(200);
      expect((await login()).status).toBe(200);
      await waitForStatusEmail("account_reinstated");

      expect((await statusEvents()).map((event) => event.eventType)).toEqual([
        "account.suspended",
        "account.reinstated",
      ]);
    });

    it("reinstating an active account changes and records nothing", async () => {
      const response = await changeStatus("reinstate", renterId);

      expect(response.status).toBe(200);
      expect(((await response.json()) as { data: unknown }).data).toMatchObject(
        { status: "active", changed: false },
      );
      expect(await statusEvents()).toEqual([]);
    });
  });

  describe("password reset recovery", () => {
    async function resetPassword(newPassword: string) {
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

      return request("/auth/local/password/reset", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          username: RENTER_USERNAME,
          code: otp!.code,
          newPassword,
          deviceId: "admin-account-status-reset",
        }),
      });
    }

    it("lifts a security hold and signs the user in", async () => {
      expect((await changeStatus("lock", renterId)).status).toBe(200);

      const reset = await resetPassword("RecoveredPassword1!");

      expect(reset.status).toBe(200);
      expect(
        (
          await persistenceApp.prisma.user.findUniqueOrThrow({
            where: { id: renterId },
          })
        ).status,
      ).toBe("active");
      expect((await login(RENTER_USERNAME, "RecoveredPassword1!")).status).toBe(
        200,
      );
      expect(await statusEvents()).toEqual([
        expect.objectContaining({ eventType: "account.locked" }),
        expect.objectContaining({
          eventType: "account.reinstated",
          actorUserId: null,
          metadata: expect.objectContaining({
            source: "user",
            previousStatus: "locked",
          }),
        }),
      ]);
    });

    it("refuses a suspended account without changing the password", async () => {
      expect((await changeStatus("suspend", renterId)).status).toBe(200);

      const reset = await resetPassword("NeverApplied1!");

      expect(reset.status).toBe(403);
      expect(await errorOf(reset)).toMatchObject({ code: "ACCOUNT_SUSPENDED" });
      await changeStatus("reinstate", renterId);
      expect((await login(RENTER_USERNAME, PASSWORD)).status).toBe(200);
    });
  });

  describe("access", () => {
    it("rejects an unauthenticated request", async () => {
      const response = await changeStatus("lock", renterId, undefined, {
        "content-type": "application/json",
        origin: ORIGIN,
      });

      expect(response.status).toBe(401);
    });

    it.each([
      "user1@rentify.local",
      "owner1@rentify.local",
      "moderator1@rentify.local",
    ])("forbids %s", async (email) => {
      const caller = await createAuthenticatedRequestContext({ email });
      const target = (
        await persistenceApp.prisma.user.findUniqueOrThrow({
          where: { email: ADMIN_EMAIL },
        })
      ).id;

      for (const action of ["lock", "suspend", "reinstate"] as const) {
        const response = await changeStatus(
          action,
          target,
          { reason: REASON },
          caller.headers({ origin: ORIGIN }),
        );
        expect(response.status).toBe(403);
      }
      expect(await statusEvents()).toEqual([]);
    });

    it("forbids an admin from changing their own status", async () => {
      const response = await changeStatus("suspend", admin.userId);

      expect(response.status).toBe(403);
      expect(
        (
          await persistenceApp.prisma.user.findUniqueOrThrow({
            where: { id: admin.userId },
          })
        ).status,
      ).toBe("active");
    });

    it("lets one admin change another admin's status", async () => {
      // Only one admin is seeded, so promote another account for this.
      const otherAdmin = await persistenceApp.prisma.user.update({
        where: { email: "moderator1@rentify.local" },
        data: { role: "admin" },
      });

      expect((await changeStatus("lock", otherAdmin.id)).status).toBe(200);
    });

    it("rejects an admin's personal access token", async () => {
      const created = await request("/auth/personal-access-tokens", {
        method: "POST",
        headers: admin.headers({ origin: ORIGIN }),
        body: JSON.stringify({
          name: "Account status suite",
          scopes: ["mcp:read", "mcp:write"],
          expiresInDays: 30,
        }),
      });
      expect(created.status).toBe(201);
      const { data } = (await created.json()) as { data: { token: string } };

      const response = await changeStatus(
        "lock",
        renterId,
        { reason: REASON },
        {
          authorization: `Bearer ${data.token}`,
          "content-type": "application/json",
          origin: ORIGIN,
        },
      );

      expect(response.status).toBe(403);
    });

    it.each([
      ["a missing reason", {}],
      ["a reason under five characters", { reason: "nope" }],
      ["a reason over 255 characters", { reason: "x".repeat(256) }],
    ])("rejects %s", async (_label, body) => {
      const response = await changeStatus("lock", renterId, body);

      expect(response.status).toBe(400);
      expect(await errorOf(response)).toMatchObject({
        code: "VALIDATION_ERROR",
        details: { reason: [expect.any(String)] },
      });
    });

    it("is a 404 for an unknown account", async () => {
      const response = await changeStatus(
        "lock",
        "00000000-0000-0000-0000-00000000dead",
      );

      expect(response.status).toBe(404);
    });
  });

  describe("security summary", () => {
    it("reports the status, reason and acting admin", async () => {
      await changeStatus("lock", renterId);

      const response = await request(`/admin/users/${renterId}/security`, {
        headers: admin.headers(),
      });

      expect(response.status).toBe(200);
      const { data } = (await response.json()) as {
        data: { accountStatus: string; accountStatusChange: unknown };
      };
      expect(data.accountStatus).toBe("locked");
      expect(data.accountStatusChange).toMatchObject({
        reason: REASON,
        changedBy: { id: admin.userId, email: ADMIN_EMAIL },
      });
    });
  });
});
