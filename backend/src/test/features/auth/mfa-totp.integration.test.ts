import { buildApiPath } from "@/configuration/http/api-path";
import { asUuid } from "@/configuration/validation/uuid";
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

// Off the harness's MFA bypass list, so every step here is the real one.
const ACCOUNT_EMAIL = "owner1@rentify.local";
const ACCOUNT_USERNAME = "owner-one";
const ACCOUNT_PASSWORD = "Rentify123!";
const ORIGIN = "http://localhost:3040";
const DEVICE_ID = "totp-replay-device";

interface Envelope<T> {
  data: T;
  error: { code?: string; details?: Record<string, unknown> } | null;
}

/**
 * An authenticator code is good for one use. The replay check is a
 * conditional update on `last_used_counter`, so two requests racing with the
 * same code cannot both get past it.
 */
describe("TOTP replay protection integration", () => {
  let persistenceApp: PersistenceTestApp;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  async function bodyOf<T>(response: Response) {
    return (await response.json()) as Envelope<T>;
  }

  function browserHeaders() {
    return {
      "content-type": "application/json",
      origin: ORIGIN,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    };
  }

  async function enroll(session: AuthenticatedRequestContext) {
    await completeEmailStepUp(persistenceApp.app, session.headers());

    const begin = await request("/auth/mfa/totp/begin", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({ accountName: session.email }),
    });
    expect(begin.status).toBe(200);
    const { secret } = (await bodyOf<{ secret: string }>(begin)).data;

    const confirm = await request("/auth/mfa/totp/confirm", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({ code: generateTotpCode(secret) }),
    });
    expect(confirm.status).toBe(200);

    return secret;
  }

  /** The next TOTP step's code, since the enrollment spent the current one. */
  async function withNextTotpCode<T>(
    secret: string,
    run: (code: string) => Promise<T>,
  ): Promise<T> {
    const realNow = Date.now.bind(Date);
    const spy = jest
      .spyOn(Date, "now")
      .mockImplementation(() => realNow() + 30_000);

    try {
      return await run(generateTotpCode(secret, { timestampMs: Date.now() }));
    } finally {
      spy.mockRestore();
    }
  }

  async function startSignIn(): Promise<string> {
    const response = await request("/auth/local/login", {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify({
        username: ACCOUNT_USERNAME,
        password: ACCOUNT_PASSWORD,
        captchaToken: "captcha-ok-login",
        deviceId: DEVICE_ID,
      }),
    });
    expect(response.status).toBe(401);
    const { error } = await bodyOf(response);

    return (error?.details as { mfaChallengeToken: string }).mfaChallengeToken;
  }

  function finishSignIn(mfaChallengeToken: string, code: string) {
    return request("/auth/login/mfa", {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify({
        mfaChallengeToken,
        factor: "totp",
        code,
        deviceId: DEVICE_ID,
      }),
    });
  }

  async function lastUsedCounter(userId: string) {
    const record = await persistenceApp.prisma.userMfaTotp.findUniqueOrThrow({
      where: { userId: asUuid(userId) },
    });

    return record.lastUsedCounter;
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 120_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 120_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 120_000);

  it("lets only one of two concurrent sign-ins use a code", async () => {
    const session = await createAuthenticatedRequestContext({
      email: ACCOUNT_EMAIL,
    });
    const secret = await enroll(session);
    const enrolledCounter = await lastUsedCounter(session.userId);
    const [first, second] = [await startSignIn(), await startSignIn()];

    const responses = await withNextTotpCode(secret, (code) =>
      Promise.all([finishSignIn(first, code), finishSignIn(second, code)]),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    const rejected = responses.find((response) => response.status === 400)!;
    expect((await bodyOf(rejected)).error?.code).toBe("INVALID_MFA_CODE");
    expect(await lastUsedCounter(session.userId)).toBe(enrolledCounter! + 1n);
  });

  it("lets only one of two concurrent step-ups use a code", async () => {
    const session = await createAuthenticatedRequestContext({
      email: ACCOUNT_EMAIL,
    });
    const secret = await enroll(session);
    const sessions = await Promise.all([
      createAuthenticatedRequestContext({ email: ACCOUNT_EMAIL }),
      createAuthenticatedRequestContext({ email: ACCOUNT_EMAIL }),
    ]);

    const responses = await withNextTotpCode(secret, (code) =>
      Promise.all(
        sessions.map((each) =>
          request("/auth/mfa/verify/confirm", {
            method: "POST",
            headers: each.headers(),
            body: JSON.stringify({
              scope: "mfa-management",
              factor: "totp",
              code,
            }),
          }),
        ),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
  });

  it("rejects a code that was already used, one request after another", async () => {
    const session = await createAuthenticatedRequestContext({
      email: ACCOUNT_EMAIL,
    });
    const secret = await enroll(session);

    const [accepted, replayed] = await withNextTotpCode(
      secret,
      async (code) => [
        await finishSignIn(await startSignIn(), code),
        await finishSignIn(await startSignIn(), code),
      ],
    );

    expect(accepted.status).toBe(200);
    expect(replayed.status).toBe(400);
  });
});
