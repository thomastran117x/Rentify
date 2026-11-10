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
      await expect(listPasskeys()).resolves.toEqual([passkey]);

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
      const authenticator = new SoftwareAuthenticator();
      await register(authenticator);

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
      await expect(listPasskeys()).resolves.toHaveLength(1);
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
      const authenticator = new SoftwareAuthenticator();
      await register(authenticator);
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
      for (let index = 0; index < MAX_PASSKEYS_PER_USER; index += 1) {
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
      const passkey = await register(new SoftwareAuthenticator(), "Laptop");

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
      const passkey = await register(new SoftwareAuthenticator(), "Old key");

      const response = await request(`/auth/mfa/passkeys/${passkey.id}`, {
        method: "DELETE",
        headers: session.headers(),
      });

      expect(response.status).toBe(204);
      await expect(listPasskeys()).resolves.toEqual([]);
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
});
