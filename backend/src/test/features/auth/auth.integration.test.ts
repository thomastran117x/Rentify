import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { getRedisClient } from "@/configuration/resources/redis";
import type { EmailJobPayload } from "@/features/email/email.model";
import {
  CSRF_TOKEN_COOKIE_NAME,
  CSRF_TOKEN_HEADER_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/features/auth/auth.cookies";
import type { OtpService } from "@/features/auth/otp/otp.service";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { waitForRabbitMqPayload } from "../../support/live-rabbitmq-assertions";
import {
  generateTotpCode,
  readSecretFromOtpAuthUri,
} from "../../support/totp-client";

const EMAIL_QUEUE_NAME = "email.delivery.main";
const EMAIL_VERIFICATION_OTP_PURPOSE = "email-verification";
const PASSWORD_RESET_OTP_PURPOSE = "local-password-reset";
const ORIGIN = "http://localhost:3040";

function readCookieValue(setCookieHeader: string, name: string): string | null {
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}

interface LoginSession {
  status: number;
  accessToken: string;
  refreshToken: string | null;
  csrfToken: string | null;
  body: {
    data?: { accessToken?: string };
    error?: { details?: Record<string, unknown> };
  };
}

describe("Auth persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  async function login(input: {
    username: string;
    password: string;
    totpCode?: string;
    rememberMe?: boolean;
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
          rememberMe: input.rememberMe ?? false,
          ...(input.totpCode ? { totpCode: input.totpCode } : {}),
        }),
      },
    );

    const body = (await response.json()) as LoginSession["body"];
    const setCookieHeader = response.headers.get("set-cookie") ?? "";

    return {
      status: response.status,
      accessToken: body.data?.accessToken ?? "",
      refreshToken: readCookieValue(setCookieHeader, REFRESH_TOKEN_COOKIE_NAME),
      csrfToken: readCookieValue(setCookieHeader, CSRF_TOKEN_COOKIE_NAME),
      body,
    };
  }

  function sessionHeaders(
    session: LoginSession,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    return {
      authorization: `Bearer ${session.accessToken}`,
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${REFRESH_TOKEN_COOKIE_NAME}=${session.refreshToken}; ${CSRF_TOKEN_COOKIE_NAME}=${session.csrfToken}`,
      [CSRF_TOKEN_HEADER_NAME]: session.csrfToken ?? "",
      ...extra,
    };
  }

  /**
   * Completes the email-factor step-up that authenticator management requires.
   * Verification is bound to the session, so a newly issued session needs its
   * own step-up before it may change MFA settings.
   */
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
      { headers: sessionHeaders(session) },
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
    await expect(confirmResponse.json()).resolves.toMatchObject({
      data: { verified: true, scope: "mfa-management" },
    });
  }

  async function readOtpCode(
    purpose: string,
    subject: string,
  ): Promise<string> {
    const otpService = persistenceApp.container.resolve<OtpService>(
      containerTokens.otpService,
    );
    const record = await otpService.peek({ purpose, subject });

    if (!record?.code) {
      throw new Error(`No ${purpose} OTP was issued for ${subject}.`);
    }

    return record.code;
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

  it("persists signup verification into a real user record", async () => {
    const email = "new-user@rentify.local";

    const signupResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/signup")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3040",
        },
        body: JSON.stringify({
          email,
          username: "new-user",
          password: "StrongPassword1!",
          firstName: "New",
          lastName: "User",
          captchaToken: "captcha-ok-signup",
        }),
      },
    );

    expect(signupResponse.status).toBe(202);
    expect(
      await persistenceApp.prisma.user.findUnique({
        where: {
          email,
        },
      }),
    ).toBeNull();

    const verificationEmail = await waitForRabbitMqPayload<EmailJobPayload>(
      persistenceApp.infra.rabbitMq,
      EMAIL_QUEUE_NAME,
      (payload) =>
        payload.kind === "verification" && payload.input.to === email,
    );
    expect(verificationEmail).toMatchObject({
      kind: "verification",
      input: {
        to: email,
      },
      attempt: 0,
    });

    const otpService = persistenceApp.container.resolve<OtpService>(
      containerTokens.otpService,
    );
    const verificationCode = await otpService.peek({
      purpose: "email-verification",
      subject: email,
    });

    expect(verificationCode?.code).toBeTruthy();
    expect((verificationEmail.input as any).verificationCode).toBe(
      verificationCode?.code,
    );

    const verifyResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/email/verify")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3040",
        },
        body: JSON.stringify({
          email,
          code: verificationCode?.code,
          deviceId: "verify-device",
        }),
      },
    );

    expect(verifyResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.user.findUniqueOrThrow({
        where: {
          email,
        },
        include: {
          profile: true,
        },
      }),
    ).toMatchObject({
      email,
      emailVerified: true,
      role: "user",
      profile: expect.objectContaining({
        username: "new-user",
      }),
    });
  });

  it("signs up, verifies, and then signs in as the newly created account", async () => {
    const email = "lifecycle-user@rentify.local";
    const username = "lifecycle-user";
    const password = "StrongPassword1!";

    const signupResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/signup")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          email,
          username,
          password,
          firstName: "Life",
          lastName: "Cycle",
          captchaToken: "captcha-ok-signup",
        }),
      },
    );
    expect(signupResponse.status).toBe(202);

    // An unverified signup must not be able to sign in yet.
    expect((await login({ username, password })).status).toBe(401);

    const verifyEmailResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/email/verify")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          email,
          code: await readOtpCode(EMAIL_VERIFICATION_OTP_PURPOSE, email),
          deviceId: "lifecycle-device",
        }),
      },
    );
    expect(verifyEmailResponse.status).toBe(200);

    // The point of this test: the account created above can actually sign in.
    const session = await login({ username, password, rememberMe: true });
    expect(session.status).toBe(200);
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();

    const verifySessionResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/verify")}`,
      { method: "POST", headers: sessionHeaders(session) },
    );
    expect(verifySessionResponse.status).toBe(200);
    await expect(verifySessionResponse.json()).resolves.toMatchObject({
      data: { verified: true, auth: { role: "user" } },
    });

    const refreshResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/refresh")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      },
    );
    expect(refreshResponse.status).toBe(200);
    const refreshed = (await refreshResponse.json()) as {
      data: { accessToken: string; refreshToken: string };
    };
    expect(refreshed.data.accessToken).toBeTruthy();

    const logoutResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/logout")}`,
      { method: "POST", headers: sessionHeaders(session) },
    );
    expect(logoutResponse.status).toBe(200);

    // Revocation must be enforced, not merely recorded.
    const refreshAfterLogout = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/refresh")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ refreshToken: refreshed.data.refreshToken }),
      },
    );
    expect(refreshAfterLogout.status).toBe(401);
  });

  it("resets a forgotten password and only accepts the new one afterwards", async () => {
    const username = "renter-one";
    const email = "user1@rentify.local";
    const oldPassword = "Rentify123!";
    const newPassword = "ResetPassword1!";

    const forgotResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/password/forgot")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          username,
          captchaToken: "captcha-ok-forgot",
        }),
      },
    );
    expect(forgotResponse.status).toBe(202);

    const resetResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/password/reset")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          username,
          code: await readOtpCode(PASSWORD_RESET_OTP_PURPOSE, email),
          newPassword,
          deviceId: "reset-device",
        }),
      },
    );
    expect(resetResponse.status).toBe(200);

    expect((await login({ username, password: oldPassword })).status).toBe(401);
    expect((await login({ username, password: newPassword })).status).toBe(200);
  });

  it("changes a password from a real session and invalidates the old one", async () => {
    const username = "renter-one";
    const oldPassword = "Rentify123!";
    const newPassword = "ChangedPassword1!";

    const session = await login({ username, password: oldPassword });
    expect(session.status).toBe(200);

    const changeResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/password/change")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({
          currentPassword: oldPassword,
          newPassword,
        }),
      },
    );
    expect(changeResponse.status).toBe(200);

    expect((await login({ username, password: oldPassword })).status).toBe(401);

    const newSession = await login({ username, password: newPassword });
    expect(newSession.status).toBe(200);

    // The pre-change refresh token must no longer be usable.
    const staleRefresh = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/refresh")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      },
    );
    expect(staleRefresh.status).toBe(401);
  });

  it("creates and revokes real auth sessions through login and logout", async () => {
    const loginResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/login")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3040",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        body: JSON.stringify({
          username: "renter-one",
          password: "Rentify123!",
          captchaToken: "captcha-ok-login",
          rememberMe: true,
        }),
      },
    );

    expect(loginResponse.status).toBe(200);
    expect(
      await getRedisClient().scan("0", { MATCH: "auth:session:*", COUNT: 100 }),
    ).toBeTruthy();

    const loginPayload = (await loginResponse.json()) as {
      data: {
        accessToken: string;
      };
    };
    const setCookieHeader = loginResponse.headers.get("set-cookie") ?? "";
    const refreshToken = readCookieValue(
      setCookieHeader,
      REFRESH_TOKEN_COOKIE_NAME,
    );
    const csrfToken = readCookieValue(setCookieHeader, CSRF_TOKEN_COOKIE_NAME);

    expect(refreshToken).toBeTruthy();
    expect(csrfToken).toBeTruthy();

    const logoutResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/logout")}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${loginPayload.data.accessToken}`,
          cookie: `${REFRESH_TOKEN_COOKIE_NAME}=${refreshToken}; ${CSRF_TOKEN_COOKIE_NAME}=${csrfToken}`,
          origin: "http://localhost:3040",
          [CSRF_TOKEN_HEADER_NAME]: csrfToken as string,
        },
      },
    );

    expect(logoutResponse.status).toBe(200);
    const sessionKeys = await getRedisClient().keys("auth:session:*");
    expect(sessionKeys).toHaveLength(1);
    const sessionRecord = await getRedisClient().get(sessionKeys[0]!);
    expect(sessionRecord).toContain('"status":"revoked"');
  });

  it("enrolls a TOTP authenticator and enforces it on the next sign in", async () => {
    // Deliberately not renter-one: the harness lists user1@rentify.local in
    // MFA_BYPASS_EMAILS, which would skip the challenge and make this vacuous.
    const username = "owner-one";
    const password = "Rentify123!";

    const session = await login({ username, password });
    expect(session.status).toBe(200);

    // Managing authenticator enrollment is a step-up action: it requires a
    // recent verification in the mfa-management scope before it is allowed.
    const optionsResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/verify/options?scope=mfa-management")}`,
      { headers: sessionHeaders(session) },
    );
    expect(optionsResponse.status).toBe(200);
    await expect(optionsResponse.json()).resolves.toMatchObject({
      data: { scope: "mfa-management", verified: false },
    });

    await completeMfaStepUp(session);

    const statusBefore = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/totp/status")}`,
      { headers: sessionHeaders(session) },
    );
    expect(statusBefore.status).toBe(200);
    await expect(statusBefore.json()).resolves.toMatchObject({
      data: { enabled: false },
    });

    const beginEnrollment = async () => {
      const response = await persistenceApp.app.request(
        `http://rent.test${buildApiPath("/auth/mfa/totp/begin")}`,
        {
          method: "POST",
          headers: sessionHeaders(session),
          body: JSON.stringify({ accountName: `${username}@rentify.local` }),
        },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { secret: string; uri: string };
      };
      expect(readSecretFromOtpAuthUri(body.data.uri)).toBe(body.data.secret);
      return body.data.secret;
    };

    const abandonedSecret = await beginEnrollment();

    const cancelResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/totp/pending")}`,
      { method: "DELETE", headers: sessionHeaders(session) },
    );
    expect(cancelResponse.status).toBe(200);

    // A cancelled enrollment must not be confirmable.
    const confirmCancelled = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/totp/confirm")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ code: generateTotpCode(abandonedSecret) }),
      },
    );
    expect(confirmCancelled.status).toBeGreaterThanOrEqual(400);

    const secret = await beginEnrollment();

    const rejectedConfirm = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/totp/confirm")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ code: "000000" }),
      },
    );
    expect(rejectedConfirm.status).toBeGreaterThanOrEqual(400);

    const enrollmentCode = generateTotpCode(secret);
    const confirmResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/totp/confirm")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ code: enrollmentCode }),
      },
    );
    expect(confirmResponse.status).toBe(200);

    const statusAfter = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/totp/status")}`,
      { headers: sessionHeaders(session) },
    );
    await expect(statusAfter.json()).resolves.toMatchObject({
      data: { enabled: true },
    });

    // Enrollment is observed by a subsequent login, not just by reading status.
    const challenged = await login({ username, password });
    expect(challenged.status).toBe(401);
    expect(challenged.body.error?.details).toMatchObject({ mfaRequired: true });

    // The enrollment code is burned: replaying it must not authenticate.
    const replayed = await login({
      username,
      password,
      totpCode: enrollmentCode,
    });
    expect(replayed.status).toBe(401);

    // A code from the next time step is strictly newer and still inside the
    // verification window, so it is accepted.
    const mfaSession = await login({
      username,
      password,
      totpCode: generateTotpCode(secret, {
        timestampMs: Date.now() + 30_000,
      }),
    });
    expect(mfaSession.status).toBe(200);

    await completeMfaStepUp(mfaSession);

    const disableResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/mfa/totp/disable")}`,
      {
        method: "POST",
        headers: sessionHeaders(mfaSession),
        body: JSON.stringify({}),
      },
    );
    expect(disableResponse.status).toBe(200);

    expect((await login({ username, password })).status).toBe(200);
  }, 120_000);

  it("authenticates through the Google and Apple OAuth providers", async () => {
    for (const [provider, email] of [
      ["google", "google-user@rentify.local"],
      ["apple", "apple-user@rentify.local"],
    ] as const) {
      const response = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/auth/oauth/${provider}`)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify({
            idToken: `${provider}-id-token`,
            nonce: "nonce-value",
            deviceId: `${provider}-device`,
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(
        await persistenceApp.prisma.user.findUnique({ where: { email } }),
      ).toMatchObject({ email, emailVerified: true });
    }
  });

  it("links and unlinks an OAuth provider for a signed-in user", async () => {
    const session = await login({
      username: "renter-one",
      password: "Rentify123!",
    });
    expect(session.status).toBe(200);

    const providersResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/oauth/providers")}`,
      { headers: sessionHeaders(session) },
    );
    expect(providersResponse.status).toBe(200);

    const linkResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/oauth/google/link")}`,
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({
          idToken: "google-id-token",
          nonce: "link-nonce",
          deviceId: "link-device",
        }),
      },
    );
    expect(linkResponse.status).toBe(200);

    const unlinkResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/oauth/google")}`,
      { method: "DELETE", headers: sessionHeaders(session) },
    );
    expect(unlinkResponse.status).toBe(200);
  });

  it("verifies, lists, and removes known devices", async () => {
    const session = await login({
      username: "renter-one",
      password: "Rentify123!",
    });
    expect(session.status).toBe(200);

    const verifyResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/device/verify")}`,
      { method: "POST", headers: sessionHeaders(session) },
    );
    expect(verifyResponse.status).toBe(200);

    const devicesResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/devices")}`,
      { headers: sessionHeaders(session) },
    );
    expect(devicesResponse.status).toBe(200);
    const devices = (await devicesResponse.json()) as {
      data: { devices: Array<{ deviceId: string }> };
    };
    expect(devices.data.devices.length).toBeGreaterThan(0);

    const removeResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/devices/remove")}`,
      {
        method: "DELETE",
        headers: sessionHeaders(session),
        body: JSON.stringify({
          deviceId: devices.data.devices[0]!.deviceId,
        }),
      },
    );
    expect(removeResponse.status).toBe(200);
  });

  it("lists personal access tokens for the signed-in user", async () => {
    const session = await login({
      username: "renter-one",
      password: "Rentify123!",
    });

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/personal-access-tokens")}`,
      { headers: sessionHeaders(session) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: expect.anything(),
    });
  });

  it("recovers a forgotten username and resends recovery codes", async () => {
    const email = "user1@rentify.local";

    const forgotUsernameResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/username/forgot")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email, captchaToken: "captcha-ok-username" }),
      },
    );
    expect(forgotUsernameResponse.status).toBe(202);

    const resendForgotResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/password/forgot/resend")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          username: "renter-one",
          captchaToken: "captcha-ok-resend",
        }),
      },
    );
    expect(resendForgotResponse.status).toBe(202);

    const resendVerificationResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/email/resend")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          email: "unverified-resend@rentify.local",
          captchaToken: "captcha-ok-verify",
        }),
      },
    );
    expect(resendVerificationResponse.status).toBe(202);
  });

  it("reports username availability for free, taken, and malformed values", async () => {
    const free = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/username/available?username=brand-new-name")}`,
      { headers: { origin: ORIGIN } },
    );
    expect(free.status).toBe(200);
    await expect(free.json()).resolves.toMatchObject({
      data: { username: "brand-new-name", available: true, reason: null },
    });

    // Seeded account, and the query is uppercased to prove normalization.
    const taken = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/username/available?username=Renter-One")}`,
      { headers: { origin: ORIGIN } },
    );
    expect(taken.status).toBe(200);
    await expect(taken.json()).resolves.toMatchObject({
      data: { username: "renter-one", available: false, reason: "taken" },
    });

    const malformed = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/username/available?username=no")}`,
      { headers: { origin: ORIGIN } },
    );
    expect(malformed.status).toBe(400);
  });

  it("exempts a signed-in caller's own username from the availability check", async () => {
    const user = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/username/available?username=renter-one")}`,
      { headers: { ...user.headers(), origin: ORIGIN } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { username: "renter-one", available: true, reason: null },
    });
  });

  it("locks a local login after repeated failures and unlocks it with an emailed code", async () => {
    const email = "user1@rentify.local";
    const username = "renter-one";

    // An unlock code is only issued for an account that is actually locked, so
    // the lock is driven through real failed sign-in attempts. The fifth
    // failure is the one that locks and emails the code.
    const failures: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      failures.push(
        (await login({ username, password: "WrongPassword1!" })).status,
      );
    }

    expect(failures.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(failures[4]).toBe(423);

    // While locked, a further wrong password keeps reporting locked rather
    // than a plain rejection.
    expect((await login({ username, password: "StillWrong1!" })).status).toBe(
      423,
    );

    const resendUnlockResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/unlock/resend")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email, captchaToken: "captcha-ok-unlock" }),
      },
    );
    expect(resendUnlockResponse.status).toBe(202);

    const unlockResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/unlock")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          email,
          code: await readOtpCode("local-login-unlock", email),
        }),
      },
    );
    expect(unlockResponse.status).toBe(200);

    // The unlock must restore access, not merely return success.
    expect((await login({ username, password: "Rentify123!" })).status).toBe(
      200,
    );
  });

  it("authenticates through the Microsoft OAuth provider", async () => {
    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/oauth/microsoft")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          idToken: "microsoft-id-token",
          nonce: "nonce-value",
          rememberMe: false,
          deviceId: "microsoft-device",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(
      persistenceApp.stubs.microsoftOAuthService.verify,
    ).toHaveBeenCalled();

    const persistedUser = await persistenceApp.prisma.user.findUnique({
      where: { email: "microsoft-user@rentify.local" },
    });
    expect(persistedUser).toMatchObject({
      email: "microsoft-user@rentify.local",
      emailVerified: true,
    });
  });

  it("persists password changes and personal access token lifecycle changes", async () => {
    const user = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });
    const beforeUser = await persistenceApp.prisma.user.findUniqueOrThrow({
      where: {
        id: user.userId,
      },
    });

    const changePasswordResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/local/password/change")}`,
      {
        method: "POST",
        headers: {
          ...user.headers(),
          origin: "http://localhost:3040",
        },
        body: JSON.stringify({
          currentPassword: "Rentify123!",
          newPassword: "NewPassword1!",
        }),
      },
    );

    expect(changePasswordResponse.status).toBe(200);
    const afterPasswordUser =
      await persistenceApp.prisma.user.findUniqueOrThrow({
        where: {
          id: user.userId,
        },
      });
    expect(afterPasswordUser.tokenVersion).toBeGreaterThan(
      beforeUser.tokenVersion,
    );
    expect(afterPasswordUser.passwordHash).not.toBe(beforeUser.passwordHash);

    const refreshedUser = await createAuthenticatedRequestContext({
      email: "user1@rentify.local",
    });

    const createPatResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/auth/personal-access-tokens")}`,
      {
        method: "POST",
        headers: {
          ...refreshedUser.headers(),
          "content-type": "application/json",
          origin: "http://localhost:3040",
        },
        body: JSON.stringify({
          name: "Rentify MCP",
          scopes: ["mcp:read", "mcp:write"],
          expiresInDays: 30,
        }),
      },
    );

    expect(createPatResponse.status).toBe(201);
    const createdPat =
      await persistenceApp.prisma.personalAccessToken.findFirstOrThrow({
        where: {
          userId: user.userId,
          name: "Rentify MCP",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    const revokePatResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/auth/personal-access-tokens/${createdPat.id}`)}`,
      {
        method: "DELETE",
        headers: refreshedUser.headers(),
      },
    );

    expect(revokePatResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.personalAccessToken.findUniqueOrThrow({
        where: {
          id: createdPat.id,
        },
      }),
    ).toMatchObject({
      revokedAt: expect.any(Date),
    });
  });
});
