import { buildApiPath } from "@/configuration/http/api-path";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type AuthenticatedRequestContext,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import {
  completeEmailStepUp,
  completeTotpStepUp,
} from "../../support/mfa-step-up";
import { generateTotpCode } from "../../support/totp-client";

// Off the harness's MFA bypass list, unlike renter-one, so every guard here is
// the real one rather than the bypass.
const ACCOUNT_EMAIL = "owner1@rentify.local";
const UNUSED_ID = "00000000-0000-4000-8000-0000000d0002";

describe("Sensitive action step-up integration", () => {
  let persistenceApp: PersistenceTestApp;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  function createSession(email = ACCOUNT_EMAIL) {
    return createAuthenticatedRequestContext({ email });
  }

  async function expectStepUpRequired(response: Response) {
    expect(response.status).toBe(401);
    expect((await bodyOf(response)).error).toMatchObject({
      code: "MFA_VERIFICATION_REQUIRED",
      details: { scope: "mfa-management", availableFactors: ["email"] },
    });
  }

  function createPat(session: AuthenticatedRequestContext) {
    return request("/auth/personal-access-tokens", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({
        name: "Step-up suite",
        scopes: ["mcp:read", "mcp:write"],
        expiresInDays: 30,
      }),
    });
  }

  function revokePat(session: AuthenticatedRequestContext, tokenId: string) {
    return request(`/auth/personal-access-tokens/${tokenId}`, {
      method: "DELETE",
      headers: session.headers(),
    });
  }

  function stepUp(session: AuthenticatedRequestContext) {
    return completeEmailStepUp(persistenceApp.app, session.headers());
  }

  async function bodyOf(response: Response) {
    return (await response.json()) as {
      data: Record<string, unknown> | null;
      error: { code?: string; details?: Record<string, unknown> } | null;
    };
  }

  /** Enrolls an authenticator on the session and returns its secret. */
  async function enrollAuthenticator(session: AuthenticatedRequestContext) {
    await completeEmailStepUp(persistenceApp.app, session.headers());

    const begin = await request("/auth/mfa/totp/begin", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({
        accountName: session.email,
      }),
    });
    expect(begin.status).toBe(200);
    const { secret } = (await bodyOf(begin)).data as { secret: string };

    const confirm = await request("/auth/mfa/totp/confirm", {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify({
        code: generateTotpCode(secret),
      }),
    });
    expect(confirm.status).toBe(200);

    return secret;
  }

  /**
   * Moves the clock one TOTP step on and returns that step's code, since replay
   * protection refuses a code from the step the enrollment used.
   */
  function useNextTotpCode(secret: string) {
    const realNow = Date.now.bind(Date);
    const spy = jest
      .spyOn(Date, "now")
      .mockImplementation(() => realNow() + 30_000);

    return {
      code: generateTotpCode(secret, { timestampMs: Date.now() }),
      restore: () => spy.mockRestore(),
    };
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

  describe("personal access tokens", () => {
    it("creates and revokes a token only with a recent proof", async () => {
      const session = await createSession();

      await expectStepUpRequired(await createPat(session));
      await expect(
        persistenceApp.prisma.personalAccessToken.count({
          where: { userId: session.userId },
        }),
      ).resolves.toBe(0);

      await stepUp(session);
      const created = await createPat(session);
      expect(created.status).toBe(201);
      const { id } = (await bodyOf(created)).data as { id: string };

      const fresh = await createSession();
      await expectStepUpRequired(await revokePat(fresh, id));

      expect((await revokePat(session, id)).status).toBe(200);
    });

    it("still lists tokens without one", async () => {
      const session = await createSession();

      const listed = await request("/auth/personal-access-tokens", {
        headers: session.headers(),
      });

      expect(listed.status).toBe(200);
    });
  });

  describe("OAuth providers", () => {
    async function startLink(session: AuthenticatedRequestContext) {
      const started = await request("/auth/oauth/google/start", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({
          intent: "link",
          deviceId: "link-device",
        }),
      });
      expect(started.status).toBe(200);
      return (await bodyOf(started)).data as { state: string };
    }

    function linkBody(flow: { state: string }) {
      return {
        state: flow.state,
        code: "google-code",
        deviceId: "link-device",
      };
    }

    it("keeps the state usable, so the same link can be sent after verifying", async () => {
      const session = await createSession();
      const flow = await startLink(session);

      await expectStepUpRequired(
        await request("/auth/oauth/google/link", {
          method: "POST",
          headers: session.headers(),
          body: JSON.stringify(linkBody(flow)),
        }),
      );

      await stepUp(session);

      const linked = await request("/auth/oauth/google/link", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify(linkBody(flow)),
      });
      expect(linked.status).toBe(200);
    });

    it("unlinks a provider only with a recent proof", async () => {
      const session = await createSession();
      const flow = await startLink(session);
      await stepUp(session);
      expect(
        (
          await request("/auth/oauth/google/link", {
            method: "POST",
            headers: session.headers(),
            body: JSON.stringify(linkBody(flow)),
          })
        ).status,
      ).toBe(200);

      const fresh = await createSession();
      await expectStepUpRequired(
        await request("/auth/oauth/google", {
          method: "DELETE",
          headers: fresh.headers(),
        }),
      );

      const unlinked = await request("/auth/oauth/google", {
        method: "DELETE",
        headers: session.headers(),
      });
      expect(unlinked.status).toBe(200);
    });
  });

  describe("marking a device known", () => {
    function verifyDevice(session: AuthenticatedRequestContext) {
      return request("/auth/device/verify", {
        method: "POST",
        headers: session.headers(),
        body: "{}",
      });
    }

    function knownDevices(session: AuthenticatedRequestContext) {
      return persistenceApp.prisma.device.count({
        where: { userId: session.userId, deviceId: session.deviceId },
      });
    }

    // Seeded accounts already know their default device.
    function createSessionOnNewDevice() {
      return createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
        deviceId: "brand-new-device",
      });
    }

    it("refuses without a proof and registers nothing", async () => {
      const session = await createSessionOnNewDevice();

      await expectStepUpRequired(await verifyDevice(session));

      await expect(knownDevices(session)).resolves.toBe(0);
    });

    it("accepts the device-login proof sign-in's new-device check leaves", async () => {
      const session = await createSessionOnNewDevice();
      await completeEmailStepUp(
        persistenceApp.app,
        session.headers(),
        "device-login",
      );

      expect((await verifyDevice(session)).status).toBe(200);
      await expect(knownDevices(session)).resolves.toBe(1);
    });

    it("accepts an mfa-management proof", async () => {
      const session = await createSessionOnNewDevice();
      await stepUp(session);

      expect((await verifyDevice(session)).status).toBe(200);
      await expect(knownDevices(session)).resolves.toBe(1);
    });
  });

  // Each route exists to be refused, so the ids in these paths need not exist.
  it.each([
    ["POST", "/auth/personal-access-tokens"],
    ["DELETE", `/auth/personal-access-tokens/${UNUSED_ID}`],
    ["POST", "/auth/oauth/google/link"],
    ["DELETE", "/auth/oauth/google"],
    ["POST", "/auth/device/verify"],
    ["PATCH", `/organizations/${UNUSED_ID}/members/${UNUSED_ID}`],
    ["DELETE", `/organizations/${UNUSED_ID}/members/${UNUSED_ID}`],
  ])("refuses personal access tokens on %s %s", async (method, path) => {
    const session = await createSession();
    await stepUp(session);
    const created = await createPat(session);
    const { token } = (await bodyOf(created)).data as { token: string };

    const response = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: method === "DELETE" ? undefined : "{}",
      },
    );

    expect(response.status).toBe(403);
  });

  describe("with an authenticator active", () => {
    it("refuses an email challenge", async () => {
      const session = await createSession();
      await enrollAuthenticator(session);

      const challenge = await request("/auth/mfa/verify/challenge", {
        method: "POST",
        headers: session.headers(),
        body: JSON.stringify({
          scope: "mfa-management",
          factor: "email",
        }),
      });

      expect(challenge.status).toBe(400);
      expect((await bodyOf(challenge)).error?.code).toBe(
        "MFA_FACTOR_UNAVAILABLE",
      );

      const options = await request(
        "/auth/mfa/verify/options?scope=mfa-management",
        { headers: session.headers() },
      );
      expect((await bodyOf(options)).data).toMatchObject({
        availableFactors: ["totp"],
        recommendedFactor: "totp",
      });
    }, 60_000);

    it("ends the other sessions when it is disabled, and records why", async () => {
      const caller = await createSession();
      const other = await createSession();
      const secret = await enrollAuthenticator(caller);
      const clock = useNextTotpCode(secret);

      try {
        await completeTotpStepUp(
          persistenceApp.app,
          caller.headers(),
          clock.code,
        );

        const disabled = await request("/auth/mfa/totp/disable", {
          method: "POST",
          headers: caller.headers(),
          body: "{}",
        });
        expect(disabled.status).toBe(200);
      } finally {
        clock.restore();
      }

      const otherSession = await request("/auth/mfa/totp/status", {
        headers: other.headers(),
      });
      expect(otherSession.status).toBe(401);

      const callerSession = await request("/auth/mfa/totp/status", {
        headers: caller.headers(),
      });
      expect(callerSession.status).toBe(200);
      expect((await bodyOf(callerSession)).data).toEqual({ enabled: false });

      await expect(
        persistenceApp.prisma.authAuditEvent.findMany({
          where: {
            userId: caller.userId,
            eventType: { in: ["session.revoked", "mfa.totp_disabled"] },
          },
          select: { eventType: true, sessionId: true },
        }),
      ).resolves.toEqual(
        expect.arrayContaining([
          { eventType: "session.revoked", sessionId: other.sessionId },
          { eventType: "mfa.totp_disabled", sessionId: caller.sessionId },
        ]),
      );
    }, 60_000);
  });
});
