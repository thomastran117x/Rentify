import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { getRedisClient } from "@/configuration/resources/redis";
import type { EmailJobPayload } from "@/features/email/email.model";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_HEADER_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";
import type { UsersRepository } from "@/features/auth/users/users.repository";
import {
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../../support/persistence-test-app";
import { waitForRabbitMqPayload } from "../../../support/live-rabbitmq-assertions";

const EMAIL_QUEUE_NAME = "email.delivery.main";
const ORIGIN = "http://localhost:3040";
const OWNER_EMAIL = "owner1@rentify.local";
const NEW_EMAIL = "owner-one-moved@rentify.local";

function readCookieValue(setCookieHeader: string, name: string): string | null {
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}

interface LoginSession {
  status: number;
  accessToken: string;
  refreshToken: string | null;
  csrfToken: string | null;
}

/**
 * The step-up gate is only meaningful for an account outside
 * `MFA_BYPASS_EMAILS`, which the harness defaults to `user1@rentify.local`.
 * These cases therefore drive `owner-one`; using `renter-one` would make every
 * assertion about the gate vacuously true.
 *
 * Every request below is spelled out with a literal path and method rather than
 * routed through one generic helper, because `check:openapi-operation-coverage`
 * resolves request sites statically and cannot see through a computed call.
 */
describe("Email change persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  async function login(input: {
    username: string;
    password: string;
  }): Promise<LoginSession> {
    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        body: JSON.stringify({
          username: input.username,
          password: input.password,
          captchaToken: "captcha-ok-login",
          rememberMe: false,
        }),
      },
    );

    const body = (await response.json()) as {
      data?: { accessToken?: string };
    };
    const setCookieHeader = response.headers.get("set-cookie") ?? "";

    return {
      status: response.status,
      accessToken: body.data?.accessToken ?? "",
      refreshToken: readCookieValue(setCookieHeader, REFRESH_TOKEN_COOKIE_NAME),
      csrfToken: readCookieValue(setCookieHeader, CSRF_TOKEN_COOKIE_NAME),
    };
  }

  function sessionHeaders(session: LoginSession): Record<string, string> {
    return {
      authorization: `Bearer ${session.accessToken}`,
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${REFRESH_TOKEN_COOKIE_NAME}=${session.refreshToken}; ${CSRF_TOKEN_COOKIE_NAME}=${session.csrfToken}`,
      [CSRF_TOKEN_HEADER_NAME]: session.csrfToken ?? "",
    };
  }

  function requestEmailChange(session: LoginSession, email: string) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/email/change")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ email }),
      },
    );
  }

  function resendEmailChangeCode(session: LoginSession) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/email/change/resend")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({}),
      },
    );
  }

  function confirmEmailChange(session: LoginSession, code: string) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/email/change/confirm")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ code }),
      },
    );
  }

  function getPendingEmailChange(session: LoginSession) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/email/change")}`,
      {
        method: "GET",
        headers: sessionHeaders(session),
      },
    );
  }

  function cancelEmailChange(session: LoginSession) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/email/change")}`,
      {
        method: "DELETE",
        headers: sessionHeaders(session),
      },
    );
  }

  function previewPendingEmailChangeOtp(session: LoginSession) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/email/change/dev/otp")}`,
      {
        method: "GET",
        headers: sessionHeaders(session),
      },
    );
  }

  async function completeMfaStepUp(session: LoginSession): Promise<void> {
    const challengeResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/challenge")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ scope: "mfa-management", factor: "email" }),
      },
    );
    expect(challengeResponse.status).toBe(200);

    const previewResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/dev/otp?scope=mfa-management")}`,
      { method: "GET", headers: sessionHeaders(session) },
    );
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as {
      data: { code: string };
    };

    const confirmResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/confirm")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({
          scope: "mfa-management",
          factor: "email",
          code: preview.data.code,
        }),
      },
    );
    expect(confirmResponse.status).toBe(200);
  }

  async function readPendingChangeCode(session: LoginSession): Promise<string> {
    const response = await previewPendingEmailChangeOtp(session);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { code: string } };
    return body.data.code;
  }

  async function signInAsOwner(): Promise<LoginSession> {
    const session = await login({
      username: "owner-one",
      password: "Rentify123!",
    });
    expect(session.status).toBe(200);
    return session;
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("refuses to start a change without a recent step-up", async () => {
    const session = await signInAsOwner();

    const response = await requestEmailChange(session, NEW_EMAIL);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MFA_VERIFICATION_REQUIRED" },
    });

    // Nothing was claimed on the way to being rejected.
    const holder = await getRedisClient().get(
      `auth:pending-email-change-address:${NEW_EMAIL}`,
    );
    expect(holder).toBeNull();
  }, 120_000);

  it("moves the account to the new address once the emailed code is confirmed", async () => {
    const session = await signInAsOwner();
    await completeMfaStepUp(session);

    const requestResponse = await requestEmailChange(session, NEW_EMAIL);

    expect(requestResponse.status).toBe(202);
    await expect(requestResponse.json()).resolves.toMatchObject({
      data: { newEmail: "o***@rentify.local", expiresInSeconds: 600 },
    });

    const codeJob = await waitForRabbitMqPayload<EmailJobPayload>(
      persistenceApp.infra.rabbitMq,
      EMAIL_QUEUE_NAME,
      (payload) =>
        payload.kind === "email_change_code" && payload.input.to === NEW_EMAIL,
    );
    expect(codeJob.kind).toBe("email_change_code");

    const noticeJob = await waitForRabbitMqPayload<EmailJobPayload>(
      persistenceApp.infra.rabbitMq,
      EMAIL_QUEUE_NAME,
      (payload) =>
        payload.kind === "email_change_notice" &&
        payload.input.to === OWNER_EMAIL,
    );
    expect(noticeJob.kind).toBe("email_change_notice");

    const pendingResponse = await getPendingEmailChange(session);
    expect(pendingResponse.status).toBe(200);
    await expect(pendingResponse.json()).resolves.toMatchObject({
      data: { pending: true, newEmail: "o***@rentify.local" },
    });

    const wrongCodeResponse = await confirmEmailChange(session, "000000");
    expect(wrongCodeResponse.status).toBe(400);

    const code = await readPendingChangeCode(session);
    const confirmResponse = await confirmEmailChange(session, code);

    expect(confirmResponse.status).toBe(200);
    const confirmed = (await confirmResponse.json()) as {
      data: { accessToken: string; user: { email: string } };
    };
    expect(confirmed.data.user.email).toBe(NEW_EMAIL);

    const usersRepository = persistenceApp.container.resolve<UsersRepository>(
      containerTokens.authUsersRepository,
    );
    const moved = await usersRepository.findUserByEmail(NEW_EMAIL);
    expect(moved?.emailVerified).toBe(true);
    await expect(
      usersRepository.findUserByEmail(OWNER_EMAIL),
    ).resolves.toBeNull();

    // Both cache keys are released, so the address is not left reserved against
    // the very account that now owns it.
    await expect(
      getRedisClient().get(`auth:pending-email-change-address:${NEW_EMAIL}`),
    ).resolves.toBeNull();

    // The old access token dies with the rotated token version; the one handed
    // back by the confirm call keeps working.
    const staleResponse = await getPendingEmailChange(session);
    expect(staleResponse.status).toBe(401);

    const refreshedResponse = await getPendingEmailChange({
      ...session,
      accessToken: confirmed.data.accessToken,
    });
    expect(refreshedResponse.status).toBe(200);
    await expect(refreshedResponse.json()).resolves.toMatchObject({
      data: { pending: false },
    });
  }, 180_000);

  it("re-sends a fresh code for the address already pending", async () => {
    const session = await signInAsOwner();
    await completeMfaStepUp(session);

    await requestEmailChange(session, NEW_EMAIL);
    const firstCode = await readPendingChangeCode(session);

    // The sixty-second resend cooldown is real time, which a test cannot wait
    // out; dropping the key exercises the resend path rather than the limiter.
    await getRedisClient().del(`auth:otp:email-change:${NEW_EMAIL}:cooldown`);

    const resendResponse = await resendEmailChangeCode(session);

    expect(resendResponse.status).toBe(202);
    await expect(resendResponse.json()).resolves.toMatchObject({
      data: { newEmail: "o***@rentify.local" },
    });
    await expect(readPendingChangeCode(session)).resolves.not.toBe(firstCode);
  }, 180_000);

  /**
   * A resent code carries a full TTL, so the record and the reservation have to
   * be pushed out with it. Aged down to a minute first: without the extension
   * they would keep that deadline and the freshly emailed code would stop
   * working long before it expired.
   */
  it("extends the pending record and reservation when a code is resent", async () => {
    const session = await signInAsOwner();
    await completeMfaStepUp(session);

    await requestEmailChange(session, NEW_EMAIL);

    const userId = await getRedisClient().get(
      `auth:pending-email-change-address:${NEW_EMAIL}`,
    );
    expect(userId).not.toBeNull();

    const recordKey = `auth:pending-email-change:${userId}`;
    const addressKey = `auth:pending-email-change-address:${NEW_EMAIL}`;
    await getRedisClient().expire(recordKey, 60);
    await getRedisClient().expire(addressKey, 60);
    await getRedisClient().del(`auth:otp:email-change:${NEW_EMAIL}:cooldown`);

    expect(await getRedisClient().ttl(recordKey)).toBeLessThanOrEqual(60);

    const resendResponse = await resendEmailChangeCode(session);
    expect(resendResponse.status).toBe(202);

    expect(await getRedisClient().ttl(recordKey)).toBeGreaterThan(500);
    expect(await getRedisClient().ttl(addressKey)).toBeGreaterThan(500);

    // Still the same user's claim, not a fresh one handed to somebody else.
    await expect(getRedisClient().get(addressKey)).resolves.toBe(userId);

    // And the extended record still confirms.
    const code = await readPendingChangeCode(session);
    const confirmResponse = await confirmEmailChange(session, code);
    expect(confirmResponse.status).toBe(200);
  }, 180_000);

  it("rate limits a resend inside the cooldown window", async () => {
    const session = await signInAsOwner();
    await completeMfaStepUp(session);

    await requestEmailChange(session, NEW_EMAIL);

    const resendResponse = await resendEmailChangeCode(session);

    expect(resendResponse.status).toBe(429);
  }, 180_000);

  it("refuses to re-send when nothing is pending", async () => {
    const session = await signInAsOwner();

    const response = await resendEmailChangeCode(session);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EMAIL_CHANGE_NOT_PENDING" },
    });
  }, 120_000);

  it("cancels a pending change and releases the address", async () => {
    const session = await signInAsOwner();
    await completeMfaStepUp(session);

    await requestEmailChange(session, NEW_EMAIL);

    const cancelResponse = await cancelEmailChange(session);

    expect(cancelResponse.status).toBe(204);
    await expect(
      getRedisClient().get(`auth:pending-email-change-address:${NEW_EMAIL}`),
    ).resolves.toBeNull();

    const pendingResponse = await getPendingEmailChange(session);
    await expect(pendingResponse.json()).resolves.toMatchObject({
      data: { pending: false },
    });
  }, 180_000);

  it("refuses an address another account already owns", async () => {
    const session = await signInAsOwner();
    await completeMfaStepUp(session);

    const response = await requestEmailChange(session, "user1@rentify.local");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EMAIL_CHANGE_ADDRESS_UNAVAILABLE" },
    });
  }, 180_000);

  it("refuses the address the account already holds", async () => {
    const session = await signInAsOwner();
    await completeMfaStepUp(session);

    const response = await requestEmailChange(session, OWNER_EMAIL);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EMAIL_CHANGE_SAME_ADDRESS" },
    });
  }, 180_000);

  it("stops a second account claiming an address already being claimed", async () => {
    const ownerSession = await signInAsOwner();
    await completeMfaStepUp(ownerSession);
    await requestEmailChange(ownerSession, NEW_EMAIL);

    const renterSession = await login({
      username: "renter-one",
      password: "Rentify123!",
    });
    expect(renterSession.status).toBe(200);

    const response = await requestEmailChange(renterSession, NEW_EMAIL);

    expect(response.status).toBe(409);
  }, 180_000);

  it("refuses to confirm when nothing is pending", async () => {
    const session = await signInAsOwner();

    const response = await confirmEmailChange(session, "123456");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EMAIL_CHANGE_NOT_PENDING" },
    });
  }, 120_000);
});
