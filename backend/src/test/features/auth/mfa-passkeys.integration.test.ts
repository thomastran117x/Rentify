import { buildApiPath } from "@/configuration/http/api-path";
import { getRedisClient } from "@/configuration/resources/redis";
import { asUuid, newUuid } from "@/configuration/validation/uuid";
import { MAX_PASSKEYS_PER_USER } from "@/features/auth/mfa/passkey/passkey.model";
import type {
  EmailJobPayload,
  SecurityChangeEmailJob,
} from "@/features/email/email.model";
import { waitForRabbitMqPayloads } from "../../support/live-rabbitmq-assertions";
import { completeEmailStepUp } from "../../support/mfa-step-up";
import { generateTotpCode } from "../../support/totp-client";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type AuthenticatedRequestContext,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import {
  SoftwareAuthenticator,
  TEST_WEBAUTHN_ORIGIN,
  TEST_WEBAUTHN_RP_ID,
} from "../../support/webauthn-authenticator";

// Off the harness's MFA bypass list, so every step-up here is the real one.
const ACCOUNT_EMAIL = "owner1@rentify.local";
const OTHER_ACCOUNT_EMAIL = "owner2@rentify.local";
const EMAIL_QUEUE = "email.delivery.main";

interface Envelope<T> {
  data: T;
  error: { code?: string; details?: Record<string, unknown> } | null;
}

interface PasskeySummaryBody {
  id: string;
  name: string;
  backedUp: boolean;
  deviceType: string;
  transports: string[];
  lastUsedAt: string | null;
}

type QueuedChange = SecurityChangeEmailJob & EmailJobPayload;

describe("MFA passkeys integration", () => {
  let persistenceApp: PersistenceTestApp;
  let session: AuthenticatedRequestContext;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  async function bodyOf<T>(response: Response) {
    return (await response.json()) as Envelope<T>;
  }

  async function registrationChallenge(): Promise<string> {
    const response = await request("/auth/mfa/passkeys/register/options", {
      method: "POST",
      headers: session.headers(),
      body: "{}",
    });
    expect(response.status).toBe(200);

    return (await bodyOf<{ options: { challenge: string } }>(response)).data
      .options.challenge;
  }

  /** Registers `authenticator` and returns the stored passkey. */
  async function register(
    authenticator: SoftwareAuthenticator,
    name?: string,
  ): Promise<PasskeySummaryBody> {
    const challenge = await registrationChallenge();
    const response = await request("/auth/mfa/passkeys/register/verify", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({
        credential: authenticator.createRegistrationResponse({ challenge }),
        name,
      }),
    });
    expect(response.status).toBe(201);

    return (await bodyOf<{ passkey: PasskeySummaryBody }>(response)).data
      .passkey;
  }

  async function listPasskeys(): Promise<PasskeySummaryBody[]> {
    const response = await request("/auth/mfa/passkeys", {
      headers: session.headers(),
    });
    expect(response.status).toBe(200);

    return (await bodyOf<{ passkeys: PasskeySummaryBody[] }>(response)).data
      .passkeys;
  }

  /**
   * A step-up with `authenticator`'s passkey. Adding an account's first
   * passkey voids the email proof it was added under, so tests that go on
   * managing passkeys step up with it first.
   */
  async function stepUpWithPasskey(authenticator: SoftwareAuthenticator) {
    const challengeResponse = await request("/auth/mfa/verify/challenge", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({ scope: "mfa-management", factor: "passkey" }),
    });
    expect(challengeResponse.status).toBe(200);
    const { options } = (
      await bodyOf<{ options: { challenge: string } }>(challengeResponse)
    ).data;
    const confirm = await request("/auth/mfa/verify/confirm", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({
        scope: "mfa-management",
        factor: "passkey",
        credential: authenticator.createAssertionResponse({
          challenge: options.challenge,
        }),
      }),
    });
    expect(confirm.status).toBe(200);
  }

  /** Registers the account's first passkey and steps up with it. */
  async function registerFirst(name?: string) {
    const authenticator = new SoftwareAuthenticator();
    const passkey = await register(authenticator, name);
    await stepUpWithPasskey(authenticator);
    return { authenticator, passkey };
  }

  function auditEvents(eventType: string) {
    return persistenceApp.prisma.authAuditEvent.findMany({
      where: { userId: asUuid(session.userId), eventType },
    });
  }

  function queuedEmails(
    kind: "passkey_added" | "passkey_removed",
    name: string,
  ) {
    return waitForRabbitMqPayloads<QueuedChange>(
      persistenceApp.infra.rabbitMq,
      EMAIL_QUEUE,
      (payload) =>
        payload.kind === kind &&
        (payload.input as { passkeyName?: string }).passkeyName === name,
      { count: 200, minMatches: 1 },
    );
  }

  async function insertPasskeyFor(userId: string, name = "Seeded key") {
    const id = newUuid();
    await persistenceApp.prisma.userWebAuthnCredential.create({
      data: {
        id,
        userId,
        credentialId: Uint8Array.from(Buffer.from(id)),
        publicKey: Uint8Array.from([1, 2, 3]),
        aaguid: "00000000-0000-0000-0000-000000000000",
        backedUp: false,
        deviceType: "single_device",
        name,
      },
    });
    return id;
  }

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 120_000);

  beforeEach(async () => {
    await resetPersistenceState();
    session = await createAuthenticatedRequestContext({ email: ACCOUNT_EMAIL });
  }, 120_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 120_000);

  describe("without a step-up", () => {
    it("refuses to start a registration", async () => {
      const response = await request("/auth/mfa/passkeys/register/options", {
        method: "POST",
        headers: session.headers(),
        body: "{}",
      });

      expect(response.status).toBe(401);
      expect((await bodyOf(response)).error?.code).toBe(
        "MFA_VERIFICATION_REQUIRED",
      );
    });

    it("refuses to finish a registration", async () => {
      const response = await request("/auth/mfa/passkeys/register/verify", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({
          credential: new SoftwareAuthenticator().createRegistrationResponse({
            challenge: "dW51c2Vk",
          }),
        }),
      });

      expect(response.status).toBe(401);
      expect((await bodyOf(response)).error?.code).toBe(
        "MFA_VERIFICATION_REQUIRED",
      );
    });

    it("refuses to list, rename or remove passkeys", async () => {
      const id = await insertPasskeyFor(session.userId);

      const list = await request("/auth/mfa/passkeys", {
        headers: session.headers(),
      });
      const rename = await request(`/auth/mfa/passkeys/${id}`, {
        method: "PATCH",
        headers: session.headers(),
        body: JSON.stringify({ name: "Renamed" }),
      });
      const remove = await request(`/auth/mfa/passkeys/${id}`, {
        method: "DELETE",
        headers: session.headers(),
      });

      for (const response of [list, rename, remove]) {
        expect(response.status).toBe(401);
        expect((await bodyOf(response)).error?.code).toBe(
          "MFA_VERIFICATION_REQUIRED",
        );
      }
      await expect(
        persistenceApp.prisma.userWebAuthnCredential.findUnique({
          where: { id },
        }),
      ).resolves.toMatchObject({ name: "Seeded key" });
    });
  });

  describe("registration", () => {
    beforeEach(async () => {
      await completeEmailStepUp(persistenceApp.app, session.headers());
    });

    it("issues options for the configured relying party, uncached", async () => {
      const response = await request("/auth/mfa/passkeys/register/options", {
        method: "POST",
        headers: session.headers(),
        body: "{}",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(
        (await bodyOf<{ options: Record<string, unknown> }>(response)).data
          .options,
      ).toMatchObject({
        rp: { id: TEST_WEBAUTHN_RP_ID, name: "Rentify" },
        attestation: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
        excludeCredentials: [],
      });
    });

    it("stores the passkey, audits it and emails the owner", async () => {
      const passkey = await register(new SoftwareAuthenticator(), "Laptop");

      expect(passkey).toMatchObject({
        name: "Laptop",
        backedUp: false,
        deviceType: "single_device",
        transports: ["internal"],
        lastUsedAt: null,
      });
      await expect(
        persistenceApp.prisma.userWebAuthnCredential.count({
          where: { userId: asUuid(session.userId) },
        }),
      ).resolves.toBe(1);

      const [event] = await auditEvents("mfa.passkey_added");
      expect(event).toMatchObject({
        outcome: "success",
        sessionId: session.sessionId,
        metadata: expect.objectContaining({
          passkeyId: passkey.id,
          emailNotification: "sent",
        }),
      });
      const [email] = await queuedEmails("passkey_added", "Laptop");
      expect(email.input).toMatchObject({ to: ACCOUNT_EMAIL });
    });

    it("records a synced passkey as backed up", async () => {
      const passkey = await register(
        new SoftwareAuthenticator({ synced: true }),
      );

      expect(passkey).toMatchObject({
        name: "Passkey 1",
        backedUp: true,
        deviceType: "multi_device",
      });
    });

    it("lists existing passkeys as excluded on the next registration", async () => {
      const { authenticator } = await registerFirst();

      const response = await request("/auth/mfa/passkeys/register/options", {
        method: "POST",
        headers: session.headers(),
        body: "{}",
      });

      expect(
        (
          await bodyOf<{ options: { excludeCredentials: { id: string }[] } }>(
            response,
          )
        ).data.options.excludeCredentials,
      ).toEqual([expect.objectContaining({ id: authenticator.id })]);
    });

    it("refuses a replayed attestation", async () => {
      await registerFirst();
      const challenge = await registrationChallenge();
      const body = JSON.stringify({
        credential: new SoftwareAuthenticator().createRegistrationResponse({
          challenge,
        }),
      });

      const first = await request("/auth/mfa/passkeys/register/verify", {
        method: "POST",
        headers: session.headers(),
        body,
      });
      const replay = await request("/auth/mfa/passkeys/register/verify", {
        method: "POST",
        headers: session.headers(),
        body,
      });

      expect(first.status).toBe(201);
      expect(replay.status).toBe(400);
      expect((await bodyOf(replay)).error?.code).toBe(
        "PASSKEY_REGISTRATION_FAILED",
      );
      await expect(listPasskeys()).resolves.toHaveLength(2);
    });

    it("refuses an expired challenge", async () => {
      const challenge = await registrationChallenge();
      const keys = await getRedisClient().keys("auth:webauthn:register:*");
      expect(keys).toHaveLength(1);
      await getRedisClient().del(keys);

      const response = await request("/auth/mfa/passkeys/register/verify", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({
          credential: new SoftwareAuthenticator().createRegistrationResponse({
            challenge,
          }),
        }),
      });

      expect(response.status).toBe(400);
      expect((await bodyOf(response)).error?.code).toBe(
        "PASSKEY_REGISTRATION_FAILED",
      );
    });

    it("refuses an attestation made for another origin", async () => {
      const challenge = await registrationChallenge();

      const response = await request("/auth/mfa/passkeys/register/verify", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({
          credential: new SoftwareAuthenticator().createRegistrationResponse({
            challenge,
            origin: "https://rentify.example.evil",
          }),
        }),
      });

      expect(response.status).toBe(400);
      expect((await bodyOf(response)).error?.code).toBe(
        "PASSKEY_REGISTRATION_FAILED",
      );
      await expect(listPasskeys()).resolves.toEqual([]);
    });

    it("refuses a passkey that is already registered", async () => {
      const { authenticator } = await registerFirst();
      const challenge = await registrationChallenge();

      const response = await request("/auth/mfa/passkeys/register/verify", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({
          credential: authenticator.createRegistrationResponse({ challenge }),
        }),
      });

      expect(response.status).toBe(409);
    });

    it("refuses a name that would break a line of the email", async () => {
      const challenge = await registrationChallenge();

      const response = await request("/auth/mfa/passkeys/register/verify", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({
          credential: new SoftwareAuthenticator().createRegistrationResponse({
            challenge,
          }),
          name: "Laptop\nIf this was you, ignore this email.",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("stops at the per-account cap", async () => {
      await registerFirst();
      for (let index = 1; index < MAX_PASSKEYS_PER_USER; index += 1) {
        await insertPasskeyFor(session.userId, `Key ${index}`);
      }

      const response = await request("/auth/mfa/passkeys/register/options", {
        method: "POST",
        headers: session.headers(),
        body: "{}",
      });

      expect(response.status).toBe(409);
    });
  });

  describe("management", () => {
    beforeEach(async () => {
      await completeEmailStepUp(persistenceApp.app, session.headers());
    });

    it("renames a passkey and audits it", async () => {
      const { passkey } = await registerFirst("Laptop");

      const response = await request(`/auth/mfa/passkeys/${passkey.id}`, {
        method: "PATCH",
        headers: session.headers(),
        body: JSON.stringify({ name: "  Desk key  " }),
      });

      expect(response.status).toBe(200);
      expect(
        (await bodyOf<{ passkey: PasskeySummaryBody }>(response)).data.passkey,
      ).toMatchObject({ id: passkey.id, name: "Desk key" });
      await expect(listPasskeys()).resolves.toEqual([
        expect.objectContaining({ name: "Desk key" }),
      ]);
      await expect(auditEvents("mfa.passkey_renamed")).resolves.toHaveLength(1);
    });

    it("removes a passkey, audits it and emails the owner", async () => {
      const { passkey } = await registerFirst("Old key");

      const response = await request(`/auth/mfa/passkeys/${passkey.id}`, {
        method: "DELETE",
        headers: session.headers(),
      });

      expect(response.status).toBe(204);
      await expect(
        persistenceApp.prisma.userWebAuthnCredential.count({
          where: { userId: asUuid(session.userId) },
        }),
      ).resolves.toBe(0);
      const [event] = await auditEvents("mfa.passkey_removed");
      expect(event?.metadata).toMatchObject({
        passkeyId: passkey.id,
        emailNotification: "sent",
      });
      await expect(
        queuedEmails("passkey_removed", "Old key"),
      ).resolves.toHaveLength(1);
    });

    it("cannot see, rename or remove another account's passkey", async () => {
      const other = await persistenceApp.prisma.user.findUniqueOrThrow({
        where: { email: OTHER_ACCOUNT_EMAIL },
      });
      const otherId = await insertPasskeyFor(other.id, "Not yours");

      await expect(listPasskeys()).resolves.toEqual([]);
      const rename = await request(`/auth/mfa/passkeys/${otherId}`, {
        method: "PATCH",
        headers: session.headers(),
        body: JSON.stringify({ name: "Mine now" }),
      });
      const remove = await request(`/auth/mfa/passkeys/${otherId}`, {
        method: "DELETE",
        headers: session.headers(),
      });

      expect(rename.status).toBe(404);
      expect(remove.status).toBe(404);
      await expect(
        persistenceApp.prisma.userWebAuthnCredential.findUnique({
          where: { id: otherId },
        }),
      ).resolves.toMatchObject({ name: "Not yours" });
    });

    it("refuses an id that is not a UUID", async () => {
      const response = await request("/auth/mfa/passkeys/not-a-uuid", {
        method: "DELETE",
        headers: session.headers(),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("as a step-up factor", () => {
    let authenticator: SoftwareAuthenticator;

    /** Asks for a passkey challenge and answers it; returns the confirm response. */
    async function passkeyStepUp(
      answer: (challenge: string) => unknown,
      headers = session.headers(),
    ) {
      const challengeResponse = await request("/auth/mfa/verify/challenge", {
        method: "POST",
        headers,
        body: JSON.stringify({ scope: "mfa-management", factor: "passkey" }),
      });
      expect(challengeResponse.status).toBe(200);
      const { options } = (
        await bodyOf<{ options: { challenge: string } }>(challengeResponse)
      ).data;

      return request("/auth/mfa/verify/confirm", {
        method: "POST",
        headers,
        body: JSON.stringify({
          scope: "mfa-management",
          factor: "passkey",
          credential: answer(options.challenge),
        }),
      });
    }

    async function storedPasskey() {
      return persistenceApp.prisma.userWebAuthnCredential.findFirstOrThrow({
        where: { userId: asUuid(session.userId) },
      });
    }

    beforeEach(async () => {
      authenticator = new SoftwareAuthenticator();
      await completeEmailStepUp(persistenceApp.app, session.headers());
      await register(authenticator);
    });

    it("replaces email, and adding the first passkey asks for it at once", async () => {
      const options = await request(
        "/auth/mfa/verify/options?scope=mfa-management",
        { headers: session.headers() },
      );
      expect(
        (
          await bodyOf<{
            verified: boolean;
            availableFactors: string[];
            recommendedFactor: string;
          }>(options)
        ).data,
      ).toMatchObject({
        verified: false,
        availableFactors: ["passkey", "recovery_code"],
        recommendedFactor: "passkey",
      });

      const email = await request("/auth/mfa/verify/challenge", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({ scope: "mfa-management", factor: "email" }),
      });
      expect(email.status).toBe(400);
      expect((await bodyOf(email)).error?.code).toBe("MFA_FACTOR_UNAVAILABLE");
    });

    it("steps up with an assertion and records the passkey's use", async () => {
      const response = await passkeyStepUp((challenge) =>
        authenticator.createAssertionResponse({ challenge }),
      );

      expect(response.status).toBe(200);
      expect(
        (await bodyOf<{ verified: boolean; factor: string }>(response)).data,
      ).toMatchObject({ verified: true, factor: "passkey" });
      await expect(listPasskeys()).resolves.toEqual([
        expect.objectContaining({ lastUsedAt: expect.any(String) }),
      ]);
      expect((await storedPasskey()).signCount).toBe(2n);
    });

    it("refuses a replayed assertion", async () => {
      let first: unknown;
      const accepted = await passkeyStepUp((challenge) => {
        first = authenticator.createAssertionResponse({ challenge });
        return first;
      });
      expect(accepted.status).toBe(200);

      const replay = await request("/auth/mfa/verify/confirm", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({
          scope: "mfa-management",
          factor: "passkey",
          credential: first,
        }),
      });

      expect(replay.status).toBe(400);
      expect((await bodyOf(replay)).error?.code).toBe("INVALID_MFA_CODE");
    });

    it("refuses an answer to an expired challenge", async () => {
      const challengeResponse = await request("/auth/mfa/verify/challenge", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({ scope: "mfa-management", factor: "passkey" }),
      });
      const { options } = (
        await bodyOf<{ options: { challenge: string } }>(challengeResponse)
      ).data;
      await getRedisClient().del(
        await getRedisClient().keys("auth:webauthn:step-up:*"),
      );

      const confirm = await request("/auth/mfa/verify/confirm", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({
          scope: "mfa-management",
          factor: "passkey",
          credential: authenticator.createAssertionResponse({
            challenge: options.challenge,
          }),
        }),
      });

      expect(confirm.status).toBe(400);
      expect((await bodyOf(confirm)).error?.code).toBe("INVALID_MFA_CODE");
    });

    it("refuses an assertion made on another origin", async () => {
      const response = await passkeyStepUp((challenge) =>
        authenticator.createAssertionResponse({
          challenge,
          origin: "https://rentify.example.evil",
        }),
      );

      expect(response.status).toBe(400);
      expect((await storedPasskey()).lastUsedAt).toBeNull();
    });

    it("refuses and audits a counter that went backwards", async () => {
      const response = await passkeyStepUp((challenge) =>
        authenticator.createAssertionResponse({ challenge, counter: 1 }),
      );

      expect(response.status).toBe(400);
      const [event] = await auditEvents("mfa.passkey_assertion_rejected");
      expect(event).toMatchObject({
        outcome: "failure",
        reasonCode: "mfa_invalid",
        sessionId: session.sessionId,
        metadata: expect.objectContaining({
          reason: "counter_regressed",
          storedCounter: 1,
          receivedCounter: 1,
          stage: "step_up",
        }),
      });
    });

    it("accepts a synced passkey whose counter stays at zero", async () => {
      const synced = new SoftwareAuthenticator({ synced: true });
      const other = await createAuthenticatedRequestContext({
        email: OTHER_ACCOUNT_EMAIL,
      });
      await completeEmailStepUp(persistenceApp.app, other.headers());
      const challengeResponse = await request(
        "/auth/mfa/passkeys/register/options",
        { method: "POST", headers: other.headers(), body: "{}" },
      );
      const { options } = (
        await bodyOf<{ options: { challenge: string } }>(challengeResponse)
      ).data;
      const registered = await request("/auth/mfa/passkeys/register/verify", {
        method: "POST",
        headers: other.headers(),
        body: JSON.stringify({
          credential: synced.createRegistrationResponse({
            challenge: options.challenge,
          }),
        }),
      });
      expect(registered.status).toBe(201);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await passkeyStepUp(
          (challenge) => synced.createAssertionResponse({ challenge }),
          other.headers(),
        );
        expect(response.status).toBe(200);
      }
    });
  });

  describe("recovery codes and the last strong factor", () => {
    async function recoveryStatus(headers = session.headers()) {
      const response = await request("/auth/mfa/recovery-codes/status", {
        headers,
      });
      expect(response.status).toBe(200);
      return (
        await bodyOf<{ remaining: number; createdAt: string | null }>(response)
      ).data;
    }

    async function passkeyStepUpWith(authenticator: SoftwareAuthenticator) {
      const challengeResponse = await request("/auth/mfa/verify/challenge", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({ scope: "mfa-management", factor: "passkey" }),
      });
      const { options } = (
        await bodyOf<{ options: { challenge: string } }>(challengeResponse)
      ).data;
      const confirm = await request("/auth/mfa/verify/confirm", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({
          scope: "mfa-management",
          factor: "passkey",
          credential: authenticator.createAssertionResponse({
            challenge: options.challenge,
          }),
        }),
      });
      expect(confirm.status).toBe(200);
    }

    /** Registers a passkey and returns the response body. */
    async function registerReturningCodes(
      authenticator: SoftwareAuthenticator,
    ) {
      const challenge = await registrationChallenge();
      const response = await request("/auth/mfa/passkeys/register/verify", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({
          credential: authenticator.createRegistrationResponse({ challenge }),
        }),
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return (
        await bodyOf<{ passkey: PasskeySummaryBody; recoveryCodes?: string[] }>(
          response,
        )
      ).data;
    }

    async function otherSessionStatus(other: AuthenticatedRequestContext) {
      return (
        await request("/auth/mfa/totp/status", { headers: other.headers() })
      ).status;
    }

    beforeEach(async () => {
      await completeEmailStepUp(persistenceApp.app, session.headers());
    });

    it("issues codes with the first passkey, and none with the second", async () => {
      const first = new SoftwareAuthenticator();
      const { recoveryCodes } = await registerReturningCodes(first);

      expect(recoveryCodes).toHaveLength(10);
      await expect(recoveryStatus()).resolves.toMatchObject({ remaining: 10 });

      await passkeyStepUpWith(first);
      const second = await registerReturningCodes(new SoftwareAuthenticator());
      expect(second.recoveryCodes).toBeUndefined();
      const [event] = await auditEvents("mfa.passkey_added");
      expect(event?.metadata).toMatchObject({ recoveryCodesIssued: true });
    });

    it("keeps the codes and other sessions when one of several is removed", async () => {
      const first = new SoftwareAuthenticator();
      const { passkey } = await registerReturningCodes(first);
      await passkeyStepUpWith(first);
      await registerReturningCodes(new SoftwareAuthenticator());
      const other = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });

      const response = await request(`/auth/mfa/passkeys/${passkey.id}`, {
        method: "DELETE",
        headers: session.headers(),
      });

      expect(response.status).toBe(204);
      await expect(otherSessionStatus(other)).resolves.toBe(200);
      await expect(recoveryStatus()).resolves.toMatchObject({ remaining: 10 });
    });

    it("ends other sessions and deletes the codes with the last strong factor", async () => {
      const only = new SoftwareAuthenticator();
      const { passkey } = await registerReturningCodes(only);
      await passkeyStepUpWith(only);
      const other = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      await expect(otherSessionStatus(other)).resolves.toBe(200);

      const response = await request(`/auth/mfa/passkeys/${passkey.id}`, {
        method: "DELETE",
        headers: session.headers(),
      });

      expect(response.status).toBe(204);
      await expect(otherSessionStatus(other)).resolves.toBe(401);
      await expect(recoveryStatus()).resolves.toEqual({
        remaining: 0,
        createdAt: null,
      });
      const [event] = await auditEvents("mfa.passkey_removed");
      expect(event?.metadata).toMatchObject({
        lastStrongFactor: true,
        otherSessionsSignedOut: true,
      });

      const options = await request(
        "/auth/mfa/verify/options?scope=mfa-management",
        { headers: session.headers() },
      );
      expect(
        (await bodyOf<{ availableFactors: string[] }>(options)).data
          .availableFactors,
      ).toEqual(["email"]);
    });

    it("gives no second set to an authenticator added after a passkey", async () => {
      const passkey = new SoftwareAuthenticator();
      await registerReturningCodes(passkey);
      await passkeyStepUpWith(passkey);

      const begin = await request("/auth/mfa/totp/begin", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({ accountName: ACCOUNT_EMAIL }),
      });
      const { secret } = (await bodyOf<{ secret: string }>(begin)).data;
      const confirm = await request("/auth/mfa/totp/confirm", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({ code: generateTotpCode(secret) }),
      });
      expect(confirm.status).toBe(200);
      expect(
        (await bodyOf<{ recoveryCodes: string[] }>(confirm)).data.recoveryCodes,
      ).toEqual([]);
      await expect(recoveryStatus()).resolves.toMatchObject({ remaining: 10 });
    });

    it("keeps the codes and other sessions when the authenticator goes and a passkey stays", async () => {
      const passkey = new SoftwareAuthenticator();
      await registerReturningCodes(passkey);
      // Turned on directly, to stay under the auth-sensitive rate limit.
      await persistenceApp.prisma.userMfaTotp.create({
        data: {
          id: newUuid(),
          userId: session.userId,
          secretEncrypted: "unused",
          status: "active",
          confirmedAt: new Date(),
        },
      });
      await passkeyStepUpWith(passkey);
      const other = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const disable = await request("/auth/mfa/totp/disable", {
        method: "POST",
        headers: session.headers(),
        body: "{}",
      });

      expect(disable.status).toBe(200);
      expect(await bodyOf(disable)).toMatchObject({
        message: "Authenticator app disabled.",
        data: { disabled: true, otherSessionsSignedOut: false },
      });
      await expect(otherSessionStatus(other)).resolves.toBe(200);
      await expect(recoveryStatus()).resolves.toMatchObject({ remaining: 10 });
    });

    it("regenerates codes for an account whose only factor is a passkey", async () => {
      const passkey = new SoftwareAuthenticator();
      await registerReturningCodes(passkey);
      await passkeyStepUpWith(passkey);

      const response = await request("/auth/mfa/recovery-codes/regenerate", {
        method: "POST",
        headers: session.headers(),
        body: "{}",
      });

      expect(response.status).toBe(200);
      expect(
        (await bodyOf<{ codes: string[] }>(response)).data.codes,
      ).toHaveLength(10);
    });
  });

  describe("at sign-in", () => {
    const ACCOUNT_USERNAME = "owner-one";
    const ACCOUNT_PASSWORD = "Rentify123!";
    const DEVICE_ID = "passkey-sign-in-device";
    let authenticator: SoftwareAuthenticator;

    function browserHeaders() {
      return {
        "content-type": "application/json",
        origin: TEST_WEBAUTHN_ORIGIN,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      };
    }

    /** The first step of a sign-in, which an account with a passkey must fail. */
    async function startSignIn() {
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

      return (await bodyOf(response)).error?.details as {
        mfaChallengeToken: string;
        availableFactors: string[];
      };
    }

    async function passkeyOptions(mfaChallengeToken: string) {
      const response = await request("/auth/login/mfa/passkey/options", {
        method: "POST",
        headers: browserHeaders(),
        body: JSON.stringify({ mfaChallengeToken, deviceId: DEVICE_ID }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");

      return (
        await bodyOf<{
          options: { challenge: string; allowCredentials: { id: string }[] };
        }>(response)
      ).data.options;
    }

    function finishSignIn(mfaChallengeToken: string, credential: unknown) {
      return request("/auth/login/mfa", {
        method: "POST",
        headers: browserHeaders(),
        body: JSON.stringify({
          mfaChallengeToken,
          factor: "passkey",
          credential,
          deviceId: DEVICE_ID,
        }),
      });
    }

    function failedSignIns() {
      return persistenceApp.prisma.authAuditEvent.findMany({
        where: {
          userId: asUuid(session.userId),
          eventType: "login.failed",
          reasonCode: "mfa_invalid",
        },
      });
    }

    beforeEach(async () => {
      authenticator = new SoftwareAuthenticator();
      await completeEmailStepUp(persistenceApp.app, session.headers());
      await register(authenticator);
    });

    it("finishes the sign-in with a passkey and counts it as the device check", async () => {
      const { mfaChallengeToken, availableFactors } = await startSignIn();
      expect(availableFactors).toEqual(["passkey", "recovery_code"]);

      const options = await passkeyOptions(mfaChallengeToken);
      expect(options.allowCredentials).toEqual([
        expect.objectContaining({ id: authenticator.id }),
      ]);
      const response = await finishSignIn(
        mfaChallengeToken,
        authenticator.createAssertionResponse({ challenge: options.challenge }),
      );

      expect(response.status).toBe(200);
      const { accessToken } = (await bodyOf<{ accessToken: string }>(response))
        .data;
      const deviceCheck = await request(
        "/auth/mfa/verify/options?scope=device-login",
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
        },
      );
      expect(
        (await bodyOf<{ verified: boolean }>(deviceCheck)).data.verified,
      ).toBe(true);
    });

    it("refuses the answer to a challenge that was replaced", async () => {
      const { mfaChallengeToken } = await startSignIn();
      const first = await passkeyOptions(mfaChallengeToken);
      const stale = authenticator.createAssertionResponse({
        challenge: first.challenge,
      });
      await passkeyOptions(mfaChallengeToken);

      const response = await finishSignIn(mfaChallengeToken, stale);

      expect(response.status).toBe(400);
      expect((await bodyOf(response)).error?.code).toBe("INVALID_MFA_CODE");
      await expect(failedSignIns()).resolves.toHaveLength(1);
    });

    it("refuses an assertion made on another origin, counting it as a failure", async () => {
      const { mfaChallengeToken } = await startSignIn();
      const options = await passkeyOptions(mfaChallengeToken);

      const response = await finishSignIn(
        mfaChallengeToken,
        authenticator.createAssertionResponse({
          challenge: options.challenge,
          origin: "https://rentify.example.evil",
        }),
      );

      expect(response.status).toBe(400);
      await expect(failedSignIns()).resolves.toHaveLength(1);
    });

    it("refuses an answer once its challenge has expired", async () => {
      const { mfaChallengeToken } = await startSignIn();
      const options = await passkeyOptions(mfaChallengeToken);
      await getRedisClient().del(
        await getRedisClient().keys("auth:webauthn:login:*"),
      );

      const response = await finishSignIn(
        mfaChallengeToken,
        authenticator.createAssertionResponse({ challenge: options.challenge }),
      );

      expect(response.status).toBe(400);
      expect((await bodyOf(response)).error?.code).toBe("INVALID_MFA_CODE");
    });

    it("gives no options to another device or an unknown sign-in", async () => {
      const { mfaChallengeToken } = await startSignIn();

      const otherDevice = await request("/auth/login/mfa/passkey/options", {
        method: "POST",
        headers: browserHeaders(),
        body: JSON.stringify({ mfaChallengeToken, deviceId: "another-device" }),
      });
      const unknown = await request("/auth/login/mfa/passkey/options", {
        method: "POST",
        headers: browserHeaders(),
        body: JSON.stringify({
          mfaChallengeToken: "not-a-real-token",
          deviceId: DEVICE_ID,
        }),
      });

      for (const response of [otherDevice, unknown]) {
        expect(response.status).toBe(401);
        expect((await bodyOf(response)).error?.code).toBe(
          "MFA_CHALLENGE_INVALID",
        );
      }
    });
  });
});
