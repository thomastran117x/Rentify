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

describe("Sensitive action step-up integration", () => {
  let persistenceApp: PersistenceTestApp;

  function request(path: string, init: RequestInit = {}) {
    return persistenceApp.app.request(
      `http://rent.test${buildApiPath(path)}`,
      init,
    );
  }

  function post(
    path: string,
    session: AuthenticatedRequestContext,
    body: unknown = {},
  ) {
    return request(path, {
      method: "POST",
      headers: session.headers(),
      body: JSON.stringify(body),
    });
  }

  function createSession(email = ACCOUNT_EMAIL) {
    return createAuthenticatedRequestContext({ email });
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

    const begin = await post("/auth/mfa/totp/begin", session, {
      accountName: session.email,
    });
    expect(begin.status).toBe(200);
    const { secret } = (await bodyOf(begin)).data as { secret: string };

    const confirm = await post("/auth/mfa/totp/confirm", session, {
      code: generateTotpCode(secret),
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

  describe("with an authenticator active", () => {
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

        const disabled = await post("/auth/mfa/totp/disable", caller);
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
