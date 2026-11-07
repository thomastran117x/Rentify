import { buildApiPath } from "@/configuration/http/api-path";
import { asUuid } from "@/configuration/validation/uuid";
import { RECOVERY_CODE_COUNT } from "@/features/auth/mfa/recovery/mfa-recovery-code.model";
import {
  completeEmailStepUp,
  completeTotpStepUp,
} from "../../support/mfa-step-up";
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
const RECOVERY_CODE_FORMAT = /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;

interface Envelope<T> {
  data: T;
  error: { code?: string; details?: Record<string, unknown> } | null;
}

describe("MFA recovery codes integration", () => {
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

  function statusOf(session: AuthenticatedRequestContext) {
    return request("/auth/mfa/recovery-codes/status", {
      headers: session.headers(),
    });
  }

  function regenerate(session: AuthenticatedRequestContext) {
    return request("/auth/mfa/recovery-codes/regenerate", {
      method: "POST",
      headers: session.headers(),
      body: "{}",
    });
  }

  /** Enrolls an authenticator, returning its secret and the codes shown. */
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
    expect(confirm.headers.get("cache-control")).toBe("no-store");
    const { recoveryCodes } = (
      await bodyOf<{ recoveryCodes: string[] }>(confirm)
    ).data;

    return { secret, recoveryCodes };
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

  function storedCodes(userId: string) {
    return persistenceApp.prisma.userMfaRecoveryCode.findMany({
      where: { userId: asUuid(userId) },
    });
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

  describe("enrollment", () => {
    it("shows ten codes once and stores only their hashes", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });

      const { recoveryCodes } = await enroll(session);

      expect(recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(new Set(recoveryCodes).size).toBe(RECOVERY_CODE_COUNT);
      for (const code of recoveryCodes) {
        expect(code).toMatch(RECOVERY_CODE_FORMAT);
      }

      const stored = await storedCodes(session.userId);
      const hashes = stored.map((row) => row.codeHash);
      expect(stored).toHaveLength(RECOVERY_CODE_COUNT);
      expect(stored.every((row) => row.usedAt === null)).toBe(true);
      for (const code of recoveryCodes) {
        expect(hashes.join()).not.toContain(code.replace("-", ""));
      }

      const status = await statusOf(session);
      expect(status.status).toBe(200);
      expect(
        (await bodyOf<{ remaining: number; createdAt: string }>(status)).data,
      ).toEqual({
        remaining: RECOVERY_CODE_COUNT,
        createdAt: stored[0]!.createdAt.toISOString(),
      });
    });

    it("reports nothing for an account that never enrolled", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });

      const status = await statusOf(session);

      expect((await bodyOf(status)).data).toEqual({
        remaining: 0,
        createdAt: null,
      });
    });
  });

  describe("regeneration", () => {
    it("needs a recent proof", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const { secret } = await enroll(session);
      const fresh = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const before = await storedCodes(session.userId);

      const refused = await regenerate(fresh);

      expect(refused.status).toBe(401);
      expect((await bodyOf(refused)).error).toMatchObject({
        code: "MFA_VERIFICATION_REQUIRED",
        details: { scope: "mfa-management" },
      });
      expect(await storedCodes(session.userId)).toEqual(before);

      await withNextTotpCode(secret, (code) =>
        completeTotpStepUp(persistenceApp.app, fresh.headers(), code),
      );
      expect((await regenerate(fresh)).status).toBe(200);
    });

    it("replaces every code and records the change", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const { secret } = await enroll(session);
      const before = await storedCodes(session.userId);
      await withNextTotpCode(secret, (code) =>
        completeTotpStepUp(persistenceApp.app, session.headers(), code),
      );

      const response = await regenerate(session);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const { codes, remaining } = (
        await bodyOf<{ codes: string[]; remaining: number }>(response)
      ).data;
      expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(remaining).toBe(RECOVERY_CODE_COUNT);

      const after = await storedCodes(session.userId);
      expect(after).toHaveLength(RECOVERY_CODE_COUNT);
      const oldHashes = new Set(before.map((row) => row.codeHash));
      expect(after.some((row) => oldHashes.has(row.codeHash))).toBe(false);

      const [event] = await persistenceApp.prisma.authAuditEvent.findMany({
        where: {
          userId: asUuid(session.userId),
          eventType: "mfa.recovery_codes_regenerated",
        },
      });
      expect(event).toMatchObject({
        outcome: "success",
        sessionId: session.sessionId,
        metadata: expect.objectContaining({ remaining: RECOVERY_CODE_COUNT }),
      });
    });

    it("leaves one full set when two requests race", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const { secret } = await enroll(session);
      await withNextTotpCode(secret, (code) =>
        completeTotpStepUp(persistenceApp.app, session.headers(), code),
      );

      const responses = await Promise.all([
        regenerate(session),
        regenerate(session),
      ]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      await expect(storedCodes(session.userId)).resolves.toHaveLength(
        RECOVERY_CODE_COUNT,
      );
    });

    it("is refused without an active authenticator", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      await completeEmailStepUp(persistenceApp.app, session.headers());

      const response = await regenerate(session);

      expect(response.status).toBe(409);
      await expect(storedCodes(session.userId)).resolves.toHaveLength(0);
    });
  });

  it("deletes the codes when the authenticator is turned off", async () => {
    const session = await createAuthenticatedRequestContext({
      email: ACCOUNT_EMAIL,
    });
    const { secret } = await enroll(session);
    await withNextTotpCode(secret, (code) =>
      completeTotpStepUp(persistenceApp.app, session.headers(), code),
    );

    const disabled = await request("/auth/mfa/totp/disable", {
      method: "POST",
      headers: session.headers(),
      body: "{}",
    });

    expect(disabled.status).toBe(200);
    await expect(storedCodes(session.userId)).resolves.toHaveLength(0);
    expect((await bodyOf(await statusOf(session))).data).toEqual({
      remaining: 0,
      createdAt: null,
    });
  });
});
