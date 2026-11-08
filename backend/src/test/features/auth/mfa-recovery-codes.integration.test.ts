import { containerTokens } from "@/configuration/container/tokens";
import { buildApiPath } from "@/configuration/http/api-path";
import { asUuid } from "@/configuration/validation/uuid";
import { RECOVERY_CODE_COUNT } from "@/features/auth/mfa/recovery/mfa-recovery-code.model";
import type { MfaRecoveryCodeService } from "@/features/auth/mfa/recovery/mfa-recovery-code.service";
import {
  completeEmailStepUp,
  completeRecoveryCodeStepUp,
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
const ACCOUNT_USERNAME = "owner-one";
const ACCOUNT_PASSWORD = "Rentify123!";
const ORIGIN = "http://localhost:3040";
const DEVICE_ID = "recovery-code-device";
const RECOVERY_CODE_FORMAT = /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;
const UNKNOWN_CODE = "ZZZZZ-ZZZZZ";

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

  function browserHeaders() {
    return {
      "content-type": "application/json",
      origin: ORIGIN,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    };
  }

  /** The first step of a sign-in, which an enrolled account must fail. */
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
    const { error } = await bodyOf(response);

    return error?.details as {
      mfaChallengeToken: string;
      availableFactors: string[];
    };
  }

  function finishSignIn(mfaChallengeToken: string, code: string) {
    return request("/auth/login/mfa", {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify({
        mfaChallengeToken,
        factor: "recovery_code",
        code,
        deviceId: DEVICE_ID,
      }),
    });
  }

  async function signInWithCode(code: string) {
    const { mfaChallengeToken } = await startSignIn();
    return finishSignIn(mfaChallengeToken, code);
  }

  async function sessionFrom(response: Response) {
    expect(response.status).toBe(200);
    const { data } = await bodyOf<{
      accessToken: string;
      recoveryCodesRemaining?: number;
    }>(response);

    return {
      remaining: data.recoveryCodesRemaining,
      headers: {
        authorization: `Bearer ${data.accessToken}`,
        "content-type": "application/json",
      },
    };
  }

  function options(
    headers: Record<string, string>,
    scope: "mfa-management" | "device-login",
  ) {
    return request(`/auth/mfa/verify/options?scope=${scope}`, { headers });
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

  describe("signing in", () => {
    it("offers recovery codes and accepts one exactly once", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const { recoveryCodes } = await enroll(session);
      const code = recoveryCodes[0]!;

      const { mfaChallengeToken, availableFactors } = await startSignIn();
      expect(availableFactors).toEqual(["totp", "recovery_code"]);

      // Typed off paper: lower case, with a space for the hyphen.
      const signedIn = await sessionFrom(
        await finishSignIn(
          mfaChallengeToken,
          code.toLowerCase().replace("-", " "),
        ),
      );
      expect(signedIn.remaining).toBe(RECOVERY_CODE_COUNT - 1);

      const stored = await storedCodes(session.userId);
      expect(stored.filter((row) => row.usedAt !== null)).toHaveLength(1);

      const events = await persistenceApp.prisma.authAuditEvent.findMany({
        where: {
          userId: asUuid(session.userId),
          eventType: "mfa.recovery_code_used",
        },
      });
      expect(events).toEqual([
        expect.objectContaining({
          outcome: "success",
          method: "password",
          metadata: expect.objectContaining({
            remaining: RECOVERY_CODE_COUNT - 1,
            stage: "login",
          }),
        }),
      ]);

      const replay = await signInWithCode(code);
      expect(replay.status).toBe(400);
      expect((await bodyOf(replay)).error?.code).toBe("INVALID_MFA_CODE");
    });

    it("lets only one of two concurrent sign-ins spend a code", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const { recoveryCodes } = await enroll(session);
      const code = recoveryCodes[0]!;
      const first = await startSignIn();
      const second = await startSignIn();

      const responses = await Promise.all([
        finishSignIn(first.mfaChallengeToken, code),
        finishSignIn(second.mfaChallengeToken, code),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 400,
      ]);
      const stored = await storedCodes(session.userId);
      expect(stored.filter((row) => row.usedAt !== null)).toHaveLength(1);
      await expect(
        persistenceApp.prisma.authAuditEvent.count({
          where: {
            userId: asUuid(session.userId),
            eventType: "mfa.recovery_code_used",
          },
        }),
      ).resolves.toBe(1);
    });

    it("counts wrong codes towards the lockout, and spends nothing once locked", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      await enroll(session);
      const { mfaChallengeToken } = await startSignIn();

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        statuses.push(
          (await finishSignIn(mfaChallengeToken, UNKNOWN_CODE)).status,
        );
      }

      expect(statuses).toEqual([400, 400, 400, 400, 423]);
      await expect(
        persistenceApp.prisma.authAuditEvent.count({
          where: {
            userId: asUuid(session.userId),
            eventType: "login.failed",
            reasonCode: "mfa_invalid",
          },
        }),
      ).resolves.toBeGreaterThanOrEqual(4);

      // Wrong guesses spend nothing, so the owner's codes all still work.
      const stored = await storedCodes(session.userId);
      expect(stored.every((row) => row.usedAt === null)).toBe(true);
    });

    it("stops offering recovery codes once none are left", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      await enroll(session);
      await persistenceApp.prisma.userMfaRecoveryCode.updateMany({
        where: { userId: asUuid(session.userId) },
        data: { usedAt: new Date() },
      });

      await expect(startSignIn()).resolves.toMatchObject({
        availableFactors: ["totp"],
      });
    });
  });

  describe("stepping up", () => {
    it("offers recovery codes, and accepts one exactly once", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const { recoveryCodes } = await enroll(session);
      const code = recoveryCodes[0]!;
      const fresh = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });

      const offered = await options(fresh.headers(), "mfa-management");
      expect((await bodyOf(offered)).data).toMatchObject({
        verified: false,
        availableFactors: ["totp", "recovery_code"],
        recommendedFactor: "totp",
      });

      await completeRecoveryCodeStepUp(
        persistenceApp.app,
        fresh.headers(),
        code,
      );
      expect((await regenerate(fresh)).status).toBe(200);

      const events = await persistenceApp.prisma.authAuditEvent.findMany({
        where: {
          userId: asUuid(session.userId),
          eventType: "mfa.recovery_code_used",
        },
      });
      expect(events).toEqual([
        expect.objectContaining({
          sessionId: fresh.sessionId,
          metadata: expect.objectContaining({ stage: "step_up" }),
        }),
      ]);
    });

    it("refuses a used code", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const { recoveryCodes } = await enroll(session);
      const code = recoveryCodes[0]!;
      const first = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const second = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      await completeRecoveryCodeStepUp(
        persistenceApp.app,
        first.headers(),
        code,
      );

      const replay = await request("/auth/mfa/verify/confirm", {
        method: "POST",
        headers: second.headers(),
        body: JSON.stringify({
          scope: "mfa-management",
          factor: "recovery_code",
          code,
        }),
      });

      expect(replay.status).toBe(400);
      expect((await bodyOf(replay)).error?.code).toBe("INVALID_MFA_CODE");
    });

    it("lets only one of two concurrent step-ups spend a code", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const { recoveryCodes } = await enroll(session);
      const code = recoveryCodes[0]!;
      const sessions = await Promise.all([
        createAuthenticatedRequestContext({ email: ACCOUNT_EMAIL }),
        createAuthenticatedRequestContext({ email: ACCOUNT_EMAIL }),
      ]);

      const responses = await Promise.all(
        sessions.map((each) =>
          request("/auth/mfa/verify/confirm", {
            method: "POST",
            headers: each.headers(),
            body: JSON.stringify({
              scope: "mfa-management",
              factor: "recovery_code",
              code,
            }),
          }),
        ),
      );

      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 400,
      ]);
    });

    it("never falls back to email once the codes run out", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      await enroll(session);
      await persistenceApp.prisma.userMfaRecoveryCode.updateMany({
        where: { userId: asUuid(session.userId) },
        data: { usedAt: new Date() },
      });
      const fresh = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });

      const offered = await options(fresh.headers(), "mfa-management");
      expect((await bodyOf(offered)).data).toMatchObject({
        availableFactors: ["totp"],
      });

      const email = await request("/auth/mfa/verify/challenge", {
        method: "POST",
        headers: fresh.headers(),
        body: JSON.stringify({ scope: "mfa-management", factor: "email" }),
      });
      expect(email.status).toBe(400);
      expect((await bodyOf(email)).error?.code).toBe("MFA_FACTOR_UNAVAILABLE");
    });
  });

  describe("the last code", () => {
    /** Leaves exactly one unused code, and returns it. */
    async function keepOnlyOneCode(userId: string, codes: string[]) {
      // Through the service: this many requests would hit the rate limit.
      const service = persistenceApp.container.resolve<MfaRecoveryCodeService>(
        containerTokens.mfaRecoveryCodeService,
      );

      for (const code of codes.slice(1)) {
        await service.redeem({
          userId: asUuid(userId),
          code,
          stage: "step_up",
        });
      }

      await expect(
        persistenceApp.prisma.userMfaRecoveryCode.count({
          where: { userId: asUuid(userId), usedAt: null },
        }),
      ).resolves.toBe(1);

      return codes[0]!;
    }

    it("signs in, and that sign-in can replace the codes but do nothing else", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const { recoveryCodes } = await enroll(session);
      const lastCode = await keepOnlyOneCode(session.userId, recoveryCodes);

      const signedIn = await sessionFrom(await signInWithCode(lastCode));
      expect(signedIn.remaining).toBe(0);

      // The code's own proof survives it being the last one, so the new-device
      // check passes rather than asking for the authenticator that was lost.
      const deviceLogin = await options(signedIn.headers, "device-login");
      expect((await bodyOf(deviceLogin)).data).toMatchObject({
        verified: true,
        availableFactors: ["totp"],
      });

      // That proof is not a management step-up.
      const management = await options(signedIn.headers, "mfa-management");
      expect((await bodyOf(management)).data).toMatchObject({
        verified: false,
      });
      const disable = await request("/auth/mfa/totp/disable", {
        method: "POST",
        headers: signedIn.headers,
        body: "{}",
      });
      expect(disable.status).toBe(401);

      const regenerated = await request("/auth/mfa/recovery-codes/regenerate", {
        method: "POST",
        headers: signedIn.headers,
        body: "{}",
      });
      expect(regenerated.status).toBe(200);
      const { codes } = (await bodyOf<{ codes: string[] }>(regenerated)).data;

      // The new set works, and is the way to the authenticator settings.
      await completeRecoveryCodeStepUp(
        persistenceApp.app,
        signedIn.headers,
        codes[0]!,
      );
      const removed = await request("/auth/mfa/totp/disable", {
        method: "POST",
        headers: signedIn.headers,
        body: "{}",
      });
      expect(removed.status).toBe(200);
    }, 60_000);

    it("keeps its proof when spent on a step-up", async () => {
      const session = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });
      const { recoveryCodes } = await enroll(session);
      const lastCode = await keepOnlyOneCode(session.userId, recoveryCodes);
      const fresh = await createAuthenticatedRequestContext({
        email: ACCOUNT_EMAIL,
      });

      await completeRecoveryCodeStepUp(
        persistenceApp.app,
        fresh.headers(),
        lastCode,
      );

      expect((await regenerate(fresh)).status).toBe(200);
    }, 60_000);
  });

  it("refuses the old codes after a regeneration", async () => {
    const session = await createAuthenticatedRequestContext({
      email: ACCOUNT_EMAIL,
    });
    const { recoveryCodes, secret } = await enroll(session);
    await withNextTotpCode(secret, (code) =>
      completeTotpStepUp(persistenceApp.app, session.headers(), code),
    );
    const { codes } = (
      await bodyOf<{ codes: string[] }>(await regenerate(session))
    ).data;

    const old = await signInWithCode(recoveryCodes[0]!);
    expect(old.status).toBe(400);

    await sessionFrom(await signInWithCode(codes[0]!));
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
