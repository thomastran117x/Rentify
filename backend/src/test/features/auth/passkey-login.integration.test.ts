import { environment } from "@/configuration/environment";
import { buildApiPath } from "@/configuration/http/api-path";
import { asUuid, newUuid } from "@/configuration/validation/uuid";
import { REFRESH_TOKEN_COOKIE_NAME } from "@/features/auth/auth.cookies";
import { hashPasskeyCredentialId } from "@/features/auth/audit/auth-audit-identifier";
import {
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import {
  SoftwareAuthenticator,
  TEST_WEBAUTHN_ORIGIN,
} from "../../support/webauthn-authenticator";

// Off the harness's MFA bypass list: a password sign-in for it is challenged
// once it has a passkey, which is what a passkey sign-in must not be.
const ACCOUNT = {
  username: "owner-one",
  email: "owner1@rentify.local",
  password: "Rentify123!",
};

interface Envelope<T> {
  data: T;
  error: { code?: string; details?: Record<string, unknown> } | null;
}

// Every refused assertion and every password check costs real crypto.
jest.setTimeout(60_000);

describe("Passkey sign-in integration", () => {
  let persistenceApp: PersistenceTestApp;
  let userId: string;
  let authenticator: SoftwareAuthenticator;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  function browserHeaders() {
    return {
      "content-type": "application/json",
      origin: TEST_WEBAUTHN_ORIGIN,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "x-device-id": "passkey-sign-in-device",
    };
  }

  async function bodyOf<T>(response: Response) {
    return (await response.json()) as Envelope<T>;
  }

  async function options() {
    const response = await request("/auth/passkey/login/options", {
      method: "POST",
      headers: browserHeaders(),
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    return (
      await bodyOf<{
        options: {
          challenge: string;
          allowCredentials?: unknown[];
          userVerification: string;
        };
      }>(response)
    ).data.options;
  }

  function verify(credential: unknown) {
    return request("/auth/passkey/login/verify", {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify({ credential, rememberMe: true }),
    });
  }

  /** A fresh challenge answered by `signer`, for `owner`'s user handle. */
  async function assertion(
    signer: SoftwareAuthenticator = authenticator,
    overrides: { origin?: string; owner?: string } = {},
  ) {
    const { challenge } = await options();
    return signer.createAssertionResponse({
      challenge,
      origin: overrides.origin,
      userHandle: SoftwareAuthenticator.userHandleFor(
        overrides.owner ?? userId,
      ),
    });
  }

  /** Stores `signer`'s passkey for the account, as a registration would. */
  async function insertPasskey(signer: SoftwareAuthenticator) {
    await persistenceApp.prisma.userWebAuthnCredential.create({
      data: {
        id: newUuid(),
        userId,
        credentialId: signer.credentialId,
        publicKey: signer.cosePublicKey,
        signCount: BigInt(signer.counter),
        transports: ["internal"],
        aaguid: "00000000-0000-0000-0000-000000000000",
        backedUp: false,
        deviceType: "single_device",
        name: "Laptop",
      },
    });
  }

  function auditEvents(where: Record<string, unknown>) {
    return persistenceApp.prisma.authAuditEvent.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
    await persistenceApp.prisma.authAuditEvent.deleteMany({});
    const user = await persistenceApp.prisma.user.findFirstOrThrow({
      where: { email: ACCOUNT.email },
    });
    userId = user.id;
    authenticator = new SoftwareAuthenticator();
    await insertPasskey(authenticator);
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("asks for a discoverable passkey that verifies its user", async () => {
    const result = await options();

    expect(result.userVerification).toBe("required");
    expect(result.allowCredentials ?? []).toEqual([]);
  });

  it("signs in with the passkey alone, with no second step, and audits it as a sign-in", async () => {
    // The same account's password sign-in must now finish with a factor.
    const passwordSignIn = await request("/auth/local/login", {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify({
        username: ACCOUNT.username,
        password: ACCOUNT.password,
        captchaToken: "captcha-ok-login",
      }),
    });
    expect(passwordSignIn.status).toBe(401);
    expect((await bodyOf(passwordSignIn)).error?.details?.mfaRequired).toBe(
      true,
    );

    const response = await verify(await assertion());

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join("; ")).toContain(
      `${REFRESH_TOKEN_COOKIE_NAME}=`,
    );
    const session = (
      await bodyOf<{ accessToken: string; sessionId?: string }>(response)
    ).data;
    expect(session.accessToken).toEqual(expect.any(String));

    const [success] = await auditEvents({
      userId: asUuid(userId),
      eventType: "login.succeeded",
    });
    expect(success).toMatchObject({
      outcome: "success",
      method: "passkey",
      metadata: { passkeyId: expect.any(String) },
    });
    // The device was evaluated as at any sign-in, in the same request.
    const [newDevice] = await auditEvents({
      userId: asUuid(userId),
      eventType: "device.new_detected",
    });
    expect(newDevice?.requestId).toBe(success?.requestId);

    // The passkey was the device-login proof, so no further prompt.
    const deviceCheck = await request(
      "/auth/mfa/verify/options?scope=device-login",
      {
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          "content-type": "application/json",
        },
      },
    );
    expect(
      (await bodyOf<{ verified: boolean }>(deviceCheck)).data.verified,
    ).toBe(true);
    const passkey =
      await persistenceApp.prisma.userWebAuthnCredential.findFirstOrThrow({
        where: { userId },
      });
    expect(passkey.lastUsedAt).toBeInstanceOf(Date);
  });

  it("refuses a passkey that is not registered without saying so, under its hash", async () => {
    const stranger = new SoftwareAuthenticator();

    const response = await verify(await assertion(stranger));

    expect(response.status).toBe(401);
    expect((await bodyOf(response)).error?.code).toBe("PASSKEY_LOGIN_FAILED");
    const [failure] = await auditEvents({ eventType: "login.failed" });
    expect(failure).toMatchObject({
      userId: null,
      outcome: "failure",
      reasonCode: "bad_credentials",
      method: "passkey",
      identifierHash: hashPasskeyCredentialId(
        stranger.id,
        environment.getTokenConfig().authAuditIdentifierSecret,
      ),
    });
  });

  it("refuses the same answer twice", async () => {
    const credential = await assertion();
    expect((await verify(credential)).status).toBe(200);

    const replay = await verify(credential);

    expect(replay.status).toBe(401);
    expect((await bodyOf(replay)).error?.code).toBe("PASSKEY_LOGIN_FAILED");
  });

  it("refuses a passkey that did not verify its user, counting it against the account", async () => {
    const unverified = new SoftwareAuthenticator({ userVerified: false });
    await insertPasskey(unverified);

    const response = await verify(await assertion(unverified));

    expect(response.status).toBe(401);
    expect((await bodyOf(response)).error?.code).toBe("PASSKEY_LOGIN_FAILED");
    await expect(
      auditEvents({
        userId: asUuid(userId),
        eventType: "login.failed",
        reasonCode: "bad_credentials",
        method: "passkey",
      }),
    ).resolves.toHaveLength(1);
  });

  it("locks the username after five refused assertions, then refuses even a good one", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await verify(
        await assertion(authenticator, { origin: "https://phish.example" }),
      );
      expect(response.status).toBe(attempt < 5 ? 401 : 423);
    }

    const good = await verify(await assertion());

    expect(good.status).toBe(423);
    expect((await bodyOf(good)).error).toMatchObject({
      code: "ACCOUNT_LOCKED",
      details: { unlockRequired: true },
    });
    const [locked] = await auditEvents({
      userId: asUuid(userId),
      eventType: "login.locked",
      method: "passkey",
    });
    expect(locked?.metadata).toMatchObject({
      triggered: true,
      failureReason: "bad_credentials",
    });
  });

  it("stops a suspended account at the status check, once the passkey checks out", async () => {
    await persistenceApp.prisma.user.update({
      where: { id: userId },
      data: { status: "suspended" },
    });

    const refused = await verify(await assertion(new SoftwareAuthenticator()));
    expect(refused.status).toBe(401);

    const response = await verify(await assertion());

    expect(response.status).toBe(403);
    expect((await bodyOf(response)).error?.code).toBe("ACCOUNT_SUSPENDED");
    await expect(
      auditEvents({
        userId: asUuid(userId),
        eventType: "login.failed",
        outcome: "blocked",
        reasonCode: "account_suspended",
        method: "passkey",
      }),
    ).resolves.toHaveLength(1);
  });

  it("refuses an options body that names an account", async () => {
    const response = await request("/auth/passkey/login/options", {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify({ username: ACCOUNT.username }),
    });

    expect(response.status).toBe(400);
  });
});
