import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import type { EmailChangeRevertRepository } from "@/features/auth/email-change/email-change-revert.repository";
import type { EmailChangeStore } from "@/features/auth/email-change/email-change.store";
import type { EmailJobPayload } from "@/features/email/email.model";
import { peekRabbitMqMessages } from "../../../support/live-rabbitmq";
import { waitForRabbitMqPayload } from "../../../support/live-rabbitmq-assertions";
import { completeEmailStepUp } from "../../../support/mfa-step-up";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type AuthenticatedRequestContext,
  type PersistenceTestApp,
} from "../../../support/persistence-test-app";

const ORIGIN = "http://localhost:3040";
const QUEUE = "email.delivery.main";
const PASSWORD = "Rentify123!";
// On the harness's MFA bypass list, so starting a change needs no step-up.
const RENTER_EMAIL = "user1@rentify.local";
const RENTER_USERNAME = "renter-one";
const OWNER_EMAIL = "owner1@rentify.local";
const OAUTH_ONLY_EMAIL = "oauth1@rentify.local";
const MOVED_EMAIL = "taken-over@rentify.local";
const MOVED_AGAIN_EMAIL = "taken-over-again@rentify.local";

describe("Email change revert (POST /auth/email/change/revert) integration", () => {
  let persistenceApp: PersistenceTestApp;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  function revert(token: unknown) {
    return request("/auth/email/change/revert", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ token }),
    });
  }

  function startChange(session: AuthenticatedRequestContext, email: string) {
    return request("/auth/email/change", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({ email }),
    });
  }

  function pendingChange(session: AuthenticatedRequestContext) {
    return request("/auth/email/change", { headers: session.headers() });
  }

  /** Moves the session's account to `email`; returns the queued email's job. */
  async function changeEmail(
    session: AuthenticatedRequestContext,
    email: string,
  ) {
    expect((await startChange(session, email)).status).toBe(202);

    const preview = await request("/auth/email/change/dev/otp", {
      headers: session.headers(),
    });
    expect(preview.status).toBe(200);
    const { data } = (await preview.json()) as { data: { code: string } };

    const confirm = await request("/auth/email/change/confirm", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({ code: data.code }),
    });
    expect(confirm.status).toBe(200);

    return waitForRabbitMqPayload<EmailJobPayload>(
      persistenceApp.infra.rabbitMq,
      QUEUE,
      (payload) =>
        payload.kind === "email_changed" && payload.input.to === session.email,
      { count: 200 },
    );
  }

  /**
   * A session on the moved account, stepped up: the bypass list goes by
   * address, so an account that has left it needs a real step-up to go further.
   */
  async function movedSession() {
    const session = await createAuthenticatedRequestContext({
      email: MOVED_EMAIL,
    });
    await completeEmailStepUp(persistenceApp.app, session.headers());

    return session;
  }

  async function revertTokenOf(job: EmailJobPayload): Promise<string> {
    if (job.kind !== "email_changed" || !job.input.revertToken) {
      throw new Error("The job carries no revert link.");
    }

    return job.input.revertToken;
  }

  function userById(id: string) {
    return persistenceApp.prisma.user.findUniqueOrThrow({ where: { id } });
  }

  async function bodyOf(response: Response) {
    return (await response.json()) as {
      data: Record<string, unknown> | null;
      error: { code?: string } | null;
    };
  }

  function login(username = RENTER_USERNAME) {
    return request("/auth/local/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-device-id": "revert-device",
      },
      body: JSON.stringify({
        username,
        password: PASSWORD,
        captchaToken: "captcha-ok-login",
      }),
    });
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await persistenceApp.prisma.authAuditEvent.deleteMany({});
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  describe("with a valid link", () => {
    let renter: AuthenticatedRequestContext;

    beforeEach(async () => {
      renter = await createAuthenticatedRequestContext({ email: RENTER_EMAIL });
    });

    it("restores the address, ends every session, holds the account and audits it", async () => {
      const token = await revertTokenOf(await changeEmail(renter, MOVED_EMAIL));
      const session = await createAuthenticatedRequestContext({
        email: MOVED_EMAIL,
      });

      const response = await revert(token);

      expect(response.status).toBe(200);
      expect((await bodyOf(response)).data).toEqual({
        reverted: true,
        nextStep: "reset_password",
      });
      expect(await userById(renter.userId)).toMatchObject({
        email: RENTER_EMAIL,
        emailVerified: true,
        status: "locked",
        statusReason: "Email change reverted by user",
      });

      // A session made after the change, as whoever made it would hold.
      expect((await pendingChange(session)).status).toBe(401);
      expect((await login()).status).toBe(423);

      const [changed] = await persistenceApp.prisma.authAuditEvent.findMany({
        where: { eventType: "email.changed", userId: renter.userId },
      });
      const [reverted] = await persistenceApp.prisma.authAuditEvent.findMany({
        where: { eventType: "email.change_reverted", userId: renter.userId },
      });

      expect(reverted?.metadata).toEqual({
        oldEmailMasked: "u***@rentify.local",
        newEmailMasked: "t***@rentify.local",
        sourceEventId: changed?.id,
      });
      expect(JSON.stringify(reverted)).not.toContain(RENTER_EMAIL);
    });

    it("confirms the hold at the restored address, not the one the account left", async () => {
      const token = await revertTokenOf(await changeEmail(renter, MOVED_EMAIL));

      expect((await revert(token)).status).toBe(200);

      await waitForRabbitMqPayload<EmailJobPayload>(
        persistenceApp.infra.rabbitMq,
        QUEUE,
        (payload) =>
          payload.kind === "account_self_locked" &&
          payload.input.to === RENTER_EMAIL,
        { count: 200 },
      );
    });

    it("works once", async () => {
      const token = await revertTokenOf(await changeEmail(renter, MOVED_EMAIL));

      expect((await revert(token)).status).toBe(200);

      const replay = await revert(token);

      expect(replay.status).toBe(410);
      expect((await bodyOf(replay)).error?.code).toBe("GONE");
    });

    it("acts once when two requests race", async () => {
      const token = await revertTokenOf(await changeEmail(renter, MOVED_EMAIL));

      const statuses = (await Promise.all([revert(token), revert(token)])).map(
        (response) => response.status,
      );

      expect(statuses.sort()).toEqual([200, 410]);
      expect(
        await persistenceApp.prisma.authAuditEvent.count({
          where: { eventType: "email.change_reverted" },
        }),
      ).toBe(1);
    });

    it("still puts the address back after the owner self-locked from the same email", async () => {
      const job = await changeEmail(renter, MOVED_EMAIL);

      const lock = await request("/auth/account/self-lock", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          token: job.kind === "email_changed" && job.input.selfLockToken,
        }),
      });
      expect(lock.status).toBe(200);

      const response = await revert(await revertTokenOf(job));

      expect(response.status).toBe(200);
      expect(await userById(renter.userId)).toMatchObject({
        email: RENTER_EMAIL,
        status: "locked",
      });
    });

    it("restores a suspended account without downgrading it to a hold", async () => {
      const token = await revertTokenOf(await changeEmail(renter, MOVED_EMAIL));
      await persistenceApp.prisma.user.update({
        where: { id: renter.userId },
        data: { status: "suspended", statusReason: "Terms of service" },
      });

      const response = await revert(token);

      expect((await bodyOf(response)).data).toEqual({
        reverted: true,
        nextStep: "sign_in",
      });
      expect(await userById(renter.userId)).toMatchObject({
        email: RENTER_EMAIL,
        status: "suspended",
        statusReason: "Terms of service",
      });
    });

    it("recovers through a password reset sent to the restored address", async () => {
      const token = await revertTokenOf(await changeEmail(renter, MOVED_EMAIL));

      expect((await revert(token)).status).toBe(200);

      const forgot = await request("/auth/local/password/forgot", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          username: RENTER_USERNAME,
          captchaToken: "captcha-ok-forgot",
        }),
      });
      expect(forgot.status).toBe(202);

      await waitForRabbitMqPayload<EmailJobPayload>(
        persistenceApp.infra.rabbitMq,
        QUEUE,
        (payload) =>
          payload.kind === "password_reset" &&
          payload.input.to === RENTER_EMAIL,
        { count: 200 },
      );
    });

    it("discards a change still pending when the link is used", async () => {
      const token = await revertTokenOf(await changeEmail(renter, MOVED_EMAIL));
      const session = await movedSession();
      expect((await startChange(session, MOVED_AGAIN_EMAIL)).status).toBe(202);

      expect((await revert(token)).status).toBe(200);

      // Read from the store: the account is on hold, so no session can ask.
      const store = persistenceApp.container.resolve<EmailChangeStore>(
        containerTokens.emailChangeStore,
      );

      await expect(store.read(renter.userId)).resolves.toBeNull();
      await expect(
        store.readAddressHolder(MOVED_AGAIN_EMAIL),
      ).resolves.toBeNull();
    });
  });

  describe("for an account with no password", () => {
    it("ends its sessions without a hold, so it can still sign in with its provider", async () => {
      const session = await createAuthenticatedRequestContext({
        email: OAUTH_ONLY_EMAIL,
      });
      await completeEmailStepUp(persistenceApp.app, session.headers());
      const token = await revertTokenOf(
        await changeEmail(session, MOVED_EMAIL),
      );
      const later = await createAuthenticatedRequestContext({
        email: MOVED_EMAIL,
      });

      const response = await revert(token);

      expect(response.status).toBe(200);
      expect((await bodyOf(response)).data).toEqual({
        reverted: true,
        nextStep: "sign_in",
      });
      expect(await userById(session.userId)).toMatchObject({
        email: OAUTH_ONLY_EMAIL,
        status: "active",
      });
      expect((await pendingChange(later)).status).toBe(401);
    });
  });

  describe("a link that must not work", () => {
    let renter: AuthenticatedRequestContext;

    beforeEach(async () => {
      renter = await createAuthenticatedRequestContext({ email: RENTER_EMAIL });
    });

    it("stops once the account has changed its email again", async () => {
      const first = await revertTokenOf(await changeEmail(renter, MOVED_EMAIL));
      const moved = await movedSession();
      const second = await revertTokenOf(
        await changeEmail(moved, MOVED_AGAIN_EMAIL),
      );

      expect((await revert(first)).status).toBe(410);
      expect(await userById(renter.userId)).toMatchObject({
        email: MOVED_AGAIN_EMAIL,
        status: "active",
      });

      // The newer link undoes the newer change, one step back.
      expect((await revert(second)).status).toBe(200);
      expect((await userById(renter.userId)).email).toBe(MOVED_EMAIL);
    });

    it("stops once the account has moved back of its own accord", async () => {
      const first = await revertTokenOf(await changeEmail(renter, MOVED_EMAIL));
      const moved = await movedSession();
      await changeEmail(moved, RENTER_EMAIL);

      expect((await revert(first)).status).toBe(410);
      expect(await userById(renter.userId)).toMatchObject({
        email: RENTER_EMAIL,
        status: "active",
      });
    });

    it("stops after seven days", async () => {
      const token = await revertTokenOf(await changeEmail(renter, MOVED_EMAIL));
      await persistenceApp.prisma.emailChangeRevert.updateMany({
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      expect((await revert(token)).status).toBe(410);
      expect((await userById(renter.userId)).email).toBe(MOVED_EMAIL);
    });

    it("answers an unknown token the same way", async () => {
      const response = await revert("not-a-real-token");

      expect(response.status).toBe(410);
      expect((await bodyOf(response)).error?.code).toBe("GONE");
    });

    it("rejects a malformed request", async () => {
      expect((await revert("")).status).toBe(400);
      expect((await revert(123)).status).toBe(400);
    });
  });

  describe("while a link is open", () => {
    let renter: AuthenticatedRequestContext;
    let token: string;

    beforeEach(async () => {
      renter = await createAuthenticatedRequestContext({ email: RENTER_EMAIL });
      token = await revertTokenOf(await changeEmail(renter, MOVED_EMAIL));
    });

    it("keeps the old address from another account's email change", async () => {
      const owner = await createAuthenticatedRequestContext({
        email: OWNER_EMAIL,
      });
      await completeEmailStepUp(persistenceApp.app, owner.headers());

      const response = await startChange(owner, RENTER_EMAIL);

      expect(response.status).toBe(409);
      expect((await revert(token)).status).toBe(200);
    });

    it("sends no signup code to the old address", async () => {
      const response = await request("/auth/local/signup", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          username: "new-held-user",
          email: RENTER_EMAIL,
          password: "SecurityEmails1!",
          dateOfBirth: "1990-06-15",
          captchaToken: "captcha-ok-signup",
        }),
      });

      expect(response.status).toBeLessThan(300);

      // Queued before the response, so nothing can still be on its way.
      const queued = await peekRabbitMqMessages<EmailJobPayload>(
        persistenceApp.infra.rabbitMq,
        QUEUE,
        200,
      );

      expect(
        queued.filter(({ payload }) => payload.kind === "verification"),
      ).toHaveLength(0);
    });

    it("lets the account itself move back", async () => {
      const moved = await movedSession();

      expect((await startChange(moved, RENTER_EMAIL)).status).toBe(202);
    });

    it("answers 409 and keeps the link if the address went regardless", async () => {
      const owner = await persistenceApp.prisma.user.update({
        where: { email: OWNER_EMAIL },
        data: { email: RENTER_EMAIL },
      });

      const response = await revert(token);

      expect(response.status).toBe(409);
      expect((await userById(renter.userId)).email).toBe(MOVED_EMAIL);

      await persistenceApp.prisma.user.update({
        where: { id: owner.id },
        data: { email: OWNER_EMAIL },
      });

      expect((await revert(token)).status).toBe(200);
    });

    it("frees the old address once the link has expired", async () => {
      await persistenceApp.prisma.emailChangeRevert.updateMany({
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const repository =
        persistenceApp.container.resolve<EmailChangeRevertRepository>(
          containerTokens.emailChangeRevertRepository,
        );

      await expect(repository.isAddressHeld(RENTER_EMAIL)).resolves.toBe(false);
    });

    it("prunes only links that have expired", async () => {
      const repository =
        persistenceApp.container.resolve<EmailChangeRevertRepository>(
          containerTokens.emailChangeRevertRepository,
        );

      await expect(repository.deleteExpired(new Date())).resolves.toBe(0);

      await persistenceApp.prisma.emailChangeRevert.updateMany({
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      await expect(repository.deleteExpired(new Date())).resolves.toBe(1);
      expect(await persistenceApp.prisma.emailChangeRevert.count()).toBe(0);
    });
  });
});
