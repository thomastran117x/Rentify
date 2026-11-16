import ConflictError from "@/errors/http/conflict.error";
import InvalidMfaCodeError from "@/errors/http/invalid-mfa-code.error";
import LockedError from "@/errors/http/locked.error";
import LoginMfaRequiredError from "@/errors/http/login-mfa-required.error";
import LoginMfaChallengeInvalidError from "@/errors/http/login-mfa-challenge-invalid.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { environment } from "@/configuration/environment";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import type {
  CompleteLoginMfaInput,
  LoginMfaChallengeRecord,
} from "@/features/auth/mfa/login/login-mfa.model";
import { LoginMfaService } from "@/features/auth/mfa/login/login-mfa.service";
import { createSessionResult } from "../../../support/auth-controller-harness";
import { testUuid } from "../../../support/uuid";

const PROFILE_1_ID = testUuid(9000, 548259);
const USER_1_ID = testUuid(9000, 994257);
const AUDIT_CONTEXT = { ipAddress: "127.0.0.1", requestId: "request-1" };
const TOKEN = "challenge-token";

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: USER_1_ID,
    email: "user@example.com",
    passwordHash: "",
    tokenVersion: 1,
    firstName: "Test",
    role: "user",
    status: "active",
    emailVerified: true,
    oauthIdentities: [],
    organizationMemberships: [],
    profile: {
      avatarVariants: null,
      id: PROFILE_1_ID,
      userId: USER_1_ID,
      username: "test-user",
      isPrivate: false,
      recommendationPersonalizationEnabled: true,
      trustworthinessScore: 80,
      rentPostingsCount: 0,
      availableRentPostingsCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createChallenge(
  overrides: Partial<LoginMfaChallengeRecord> = {},
): LoginMfaChallengeRecord {
  return {
    userId: USER_1_ID,
    method: "password",
    username: "test-user",
    identifierHash: "hash:test-user",
    deviceId: "device-1",
    rememberMe: true,
    tokenVersion: 1,
    createdAt: "2026-10-27T00:00:00.000Z",
    ...overrides,
  };
}

const BOUND_CLIENT = {
  ip: "203.0.113.10",
  device: { id: "device-1", type: "desktop", isMobile: false },
  deviceBinding: { id: "EEEEEEEEEEEEEEEEEEEEEE" },
} as ClientRequestContext;

function createInput(
  overrides: Record<string, unknown> = {},
): CompleteLoginMfaInput {
  return {
    client: {
      ip: "203.0.113.10",
      device: { id: "device-1", type: "desktop", isMobile: false },
    } as ClientRequestContext,
    mfaChallengeToken: TOKEN,
    factor: "totp",
    code: "123456",
    deviceId: "device-1",
    audit: AUDIT_CONTEXT,
    ...overrides,
  } as CompleteLoginMfaInput;
}

function createHarness(
  options: {
    challenge?: LoginMfaChallengeRecord | null;
    user?: AuthUserRecord | null;
    passkeyCount?: number;
  } = {},
) {
  const challenges = new Map<string, LoginMfaChallengeRecord>();
  const initialChallenge =
    options.challenge === undefined ? createChallenge() : options.challenge;
  if (initialChallenge) {
    challenges.set(TOKEN, initialChallenge);
  }
  const lock = { release: jest.fn(async () => true) };
  const loginMfaChallengeStore = {
    acquireCompletionLock: jest.fn(async () => lock as typeof lock | null),
    read: jest.fn(async (token: string) => challenges.get(token) ?? null),
    issue: jest.fn(async () => ({
      mfaRequired: true as const,
      mfaChallengeToken: "new-challenge-token",
      availableFactors: ["totp" as const],
      expiresInSeconds: 300,
    })),
    delete: jest.fn(async (token: string) => {
      challenges.delete(token);
    }),
    getTtlInSeconds: jest.fn(() => 300),
  };
  const usersRepository = {
    findUserById: jest.fn(async () =>
      options.user === undefined ? createUser() : options.user,
    ),
  };
  const mfaTotpService = {
    isEnabled: jest.fn(async () => true),
    verifyCode: jest.fn(async () => undefined),
  };
  const mfaVerificationService = {
    recordLoginProof: jest.fn(async () => undefined),
  };
  const session = createSessionResult({ sessionId: "session-1" });
  const authSessionService = {
    authenticateVerifiedUser: jest.fn(async () => session),
  };
  const loginLockoutService = {
    isLocked: jest.fn(async () => false),
    clearAttemptRecord: jest.fn(async () => undefined),
    recordFailedLogin: jest.fn(async () => undefined),
    recordLockedLogin: jest.fn(async () => undefined),
    throwLockedLogin: jest.fn(async () => {
      throw new LockedError("This sign-in is locked.");
    }),
  };
  const authAuditService = { recordSafely: jest.fn(async () => undefined) };
  const mfaRecoveryCodeService = {
    countUnused: jest.fn(async () => 0),
    redeem: jest.fn(async () => 9),
  };
  const mfaFactorRepository = {
    getSummary: jest.fn(async (userId: string) => ({
      totpActive: await mfaTotpService.isEnabled(),
      passkeyCount: options.passkeyCount ?? 0,
      unusedRecoveryCodes: await mfaRecoveryCodeService.countUnused(),
      userId,
    })),
  };
  const passkeyService = {
    beginAssertion: jest.fn(async () => ({ challenge: "passkey-challenge" })),
    verifyAssertion: jest.fn(async () => ({ passkeyId: "passkey-1" })),
  };
  const deviceTrustService = {
    findTrust: jest.fn(
      async (): Promise<{ trustedUntil: string } | null> => null,
    ),
    trustSafely: jest.fn(
      async (): Promise<{ trustedUntil: string } | null> => ({
        trustedUntil: "2026-12-01T00:00:00.000Z",
      }),
    ),
    ttlDays: jest.fn(() => 30),
  };

  return {
    challenges,
    lock,
    session,
    loginMfaChallengeStore,
    usersRepository,
    mfaTotpService,
    mfaVerificationService,
    authSessionService,
    loginLockoutService,
    authAuditService,
    mfaRecoveryCodeService,
    mfaFactorRepository,
    passkeyService,
    deviceTrustService,
    service: new LoginMfaService(
      usersRepository as never,
      loginMfaChallengeStore as never,
      mfaTotpService as never,
      mfaVerificationService as never,
      authSessionService as never,
      loginLockoutService as never,
      authAuditService as never,
      mfaRecoveryCodeService as never,
      mfaFactorRepository,
      passkeyService,
      deviceTrustService,
    ),
  };
}

describe("LoginMfaService.completeLoginMfa", () => {
  it("remembers the device when asked, after issuing the session", async () => {
    const harness = createHarness();
    const input = createInput({ client: BOUND_CLIENT, rememberDevice: true });

    const result = await harness.service.completeLoginMfa(input);

    expect(harness.deviceTrustService.trustSafely).toHaveBeenCalledWith(
      createUser(),
      BOUND_CLIENT,
      "device-1",
      AUDIT_CONTEXT,
    );
    expect(
      harness.authSessionService.authenticateVerifiedUser.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      harness.deviceTrustService.trustSafely.mock.invocationCallOrder[0]!,
    );
    expect(result.device).toEqual({
      ...harness.session.device,
      known: true,
      trustedUntil: "2026-12-01T00:00:00.000Z",
    });
  });

  it("returns the plain session when the device cannot be remembered", async () => {
    const harness = createHarness();
    harness.deviceTrustService.trustSafely.mockResolvedValue(null);

    const result = await harness.service.completeLoginMfa(
      createInput({ rememberDevice: true }),
    );

    expect(result).toEqual(harness.session);
  });

  it("remembers nothing unless asked", async () => {
    const harness = createHarness();

    await harness.service.completeLoginMfa(
      createInput({ client: BOUND_CLIENT }),
    );

    expect(harness.deviceTrustService.trustSafely).not.toHaveBeenCalled();
  });

  it("keeps the recovery code count on a remembered sign-in", async () => {
    const harness = createHarness();

    const result = await harness.service.completeLoginMfa(
      createInput({
        client: BOUND_CLIENT,
        rememberDevice: true,
        factor: "recovery_code",
        code: "ABCDE-FGHIJ",
      }),
    );

    expect(result).toMatchObject({
      recoveryCodesRemaining: 9,
      device: { trustedUntil: "2026-12-01T00:00:00.000Z" },
    });
  });

  it("completes a password sign-in with the session the first step held back", async () => {
    const harness = createHarness();

    await expect(harness.service.completeLoginMfa(createInput())).resolves.toBe(
      harness.session,
    );

    expect(harness.mfaTotpService.verifyCode).toHaveBeenCalledWith(
      USER_1_ID,
      "123456",
    );
    expect(harness.challenges.has(TOKEN)).toBe(false);
    expect(harness.loginLockoutService.clearAttemptRecord).toHaveBeenCalledWith(
      "test-user",
    );
    expect(
      harness.authSessionService.authenticateVerifiedUser,
    ).toHaveBeenCalledWith(expect.objectContaining({ id: USER_1_ID }), {
      client: expect.any(Object),
      deviceId: "device-1",
      rememberMe: true,
      audit: AUDIT_CONTEXT,
    });
    expect(
      harness.mfaVerificationService.recordLoginProof,
    ).toHaveBeenCalledWith({
      userId: USER_1_ID,
      sessionId: "session-1",
      factor: "totp",
    });
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledTimes(1);
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "login.succeeded",
      outcome: "success",
      method: "password",
      identifierHash: "hash:test-user",
      context: AUDIT_CONTEXT,
      userId: USER_1_ID,
      sessionId: "session-1",
    });
    expect(harness.lock.release).toHaveBeenCalled();
  });

  it("records a provider sign-in as an OAuth success", async () => {
    const harness = createHarness({
      challenge: createChallenge({
        method: "microsoft",
        identifierHash: "hash:user@example.com",
      }),
    });

    await harness.service.completeLoginMfa(createInput());

    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "oauth.login.succeeded",
        method: "microsoft",
        identifierHash: "hash:user@example.com",
      }),
    );
  });

  it("is single-use: a completed challenge cannot be used again", async () => {
    const harness = createHarness();

    await harness.service.completeLoginMfa(createInput());

    await expect(
      harness.service.completeLoginMfa(createInput()),
    ).rejects.toBeInstanceOf(LoginMfaChallengeInvalidError);
    expect(
      harness.authSessionService.authenticateVerifiedUser,
    ).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown or expired challenge without auditing anyone", async () => {
    const harness = createHarness({ challenge: null });

    await expect(
      harness.service.completeLoginMfa(createInput()),
    ).rejects.toMatchObject({ status: 401, code: "MFA_CHALLENGE_INVALID" });

    expect(harness.mfaTotpService.verifyCode).not.toHaveBeenCalled();
    expect(harness.authAuditService.recordSafely).not.toHaveBeenCalled();
    expect(harness.lock.release).toHaveBeenCalled();
  });

  it("refuses a challenge already being verified", async () => {
    const harness = createHarness();
    harness.loginMfaChallengeStore.acquireCompletionLock.mockResolvedValue(
      null,
    );

    await expect(
      harness.service.completeLoginMfa(createInput()),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.loginMfaChallengeStore.read).not.toHaveBeenCalled();
  });

  it("refuses a challenge used from another device and leaves it usable", async () => {
    const harness = createHarness();

    await expect(
      harness.service.completeLoginMfa(createInput({ deviceId: "device-2" })),
    ).rejects.toBeInstanceOf(LoginMfaChallengeInvalidError);

    expect(harness.mfaTotpService.verifyCode).not.toHaveBeenCalled();
    expect(harness.challenges.has(TOKEN)).toBe(true);
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "login.failed",
        reasonCode: "token_invalid",
        userId: USER_1_ID,
      }),
    );
  });

  it.each([
    ["is gone", null],
    ["signed out everywhere", createUser({ tokenVersion: 2 })],
  ])("voids the challenge when the account %s", async (_case, user) => {
    const harness = createHarness({ user });

    await expect(
      harness.service.completeLoginMfa(createInput()),
    ).rejects.toBeInstanceOf(LoginMfaChallengeInvalidError);

    expect(harness.challenges.has(TOKEN)).toBe(false);
    expect(harness.mfaTotpService.verifyCode).not.toHaveBeenCalled();
  });

  it("voids the challenge and refuses a suspended account", async () => {
    const harness = createHarness({
      challenge: createChallenge({ method: "google" }),
      user: createUser({ status: "suspended" }),
    });

    await expect(
      harness.service.completeLoginMfa(createInput()),
    ).rejects.toMatchObject({ status: 403, code: "ACCOUNT_SUSPENDED" });

    expect(harness.challenges.has(TOKEN)).toBe(false);
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "oauth.login.failed",
        outcome: "blocked",
        reasonCode: "account_suspended",
      }),
    );
  });

  describe("with a recovery code", () => {
    const recoveryInput = () =>
      createInput({ factor: "recovery_code", code: "ABCDE-FGH23" });

    it("signs in and says how many codes are left", async () => {
      const harness = createHarness();

      const result = await harness.service.completeLoginMfa(recoveryInput());

      expect(harness.mfaRecoveryCodeService.redeem).toHaveBeenCalledWith({
        userId: USER_1_ID,
        code: "ABCDE-FGH23",
        stage: "login",
        method: "password",
        context: AUDIT_CONTEXT,
      });
      expect(harness.mfaTotpService.verifyCode).not.toHaveBeenCalled();
      expect(result).toEqual({ ...harness.session, recoveryCodesRemaining: 9 });
      expect(
        harness.loginLockoutService.clearAttemptRecord,
      ).toHaveBeenCalledWith("test-user");
      expect(
        harness.mfaVerificationService.recordLoginProof,
      ).toHaveBeenCalledWith({
        userId: USER_1_ID,
        sessionId: "session-1",
        factor: "recovery_code",
      });
    });

    it("keeps a count of zero, which is what prompts for new codes", async () => {
      const harness = createHarness();
      harness.mfaRecoveryCodeService.redeem.mockResolvedValue(0);

      await expect(
        harness.service.completeLoginMfa(recoveryInput()),
      ).resolves.toMatchObject({ recoveryCodesRemaining: 0 });
    });

    it("counts a wrong code against the lockout, with its own wording", async () => {
      const harness = createHarness();
      harness.mfaRecoveryCodeService.redeem.mockRejectedValue(
        new UnauthorizedError("MFA verification failed."),
      );

      await expect(
        harness.service.completeLoginMfa(recoveryInput()),
      ).rejects.toMatchObject({
        constructor: InvalidMfaCodeError,
        message: "That recovery code is incorrect or was already used.",
      });

      expect(
        harness.loginLockoutService.recordFailedLogin,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          username: "test-user",
          reasonCode: "mfa_invalid",
        }),
      );
      expect(harness.challenges.has(TOKEN)).toBe(true);
    });

    it("never spends a code on a locked username", async () => {
      const harness = createHarness();
      harness.loginLockoutService.isLocked.mockResolvedValue(true);

      await expect(
        harness.service.completeLoginMfa(recoveryInput()),
      ).rejects.toBeInstanceOf(LockedError);

      expect(harness.mfaRecoveryCodeService.redeem).not.toHaveBeenCalled();
    });

    it("adds no count to a sign-in finished with the authenticator", async () => {
      const harness = createHarness();

      const result = await harness.service.completeLoginMfa(createInput());

      expect(result).toBe(harness.session);
      expect(harness.mfaRecoveryCodeService.redeem).not.toHaveBeenCalled();
    });
  });

  it("refuses a locked username even with a correct code", async () => {
    const harness = createHarness();
    harness.loginLockoutService.isLocked.mockResolvedValue(true);

    await expect(
      harness.service.completeLoginMfa(createInput()),
    ).rejects.toBeInstanceOf(LockedError);

    expect(harness.mfaTotpService.verifyCode).not.toHaveBeenCalled();
    expect(harness.challenges.has(TOKEN)).toBe(false);
    expect(harness.loginLockoutService.recordLockedLogin).toHaveBeenCalled();
  });

  it("counts a wrong code against the username lockout and keeps the challenge", async () => {
    const harness = createHarness({
      challenge: createChallenge({ method: "apple" }),
    });
    harness.mfaTotpService.verifyCode.mockRejectedValue(
      new UnauthorizedError("MFA verification failed."),
    );

    await expect(
      harness.service.completeLoginMfa(createInput({ code: "000000" })),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    expect(harness.challenges.has(TOKEN)).toBe(true);
    expect(harness.loginLockoutService.recordFailedLogin).toHaveBeenCalledWith({
      username: "test-user",
      user: expect.objectContaining({ id: USER_1_ID }),
      reasonCode: "mfa_invalid",
      audit: {
        method: "apple",
        identifierHash: "hash:test-user",
        context: AUDIT_CONTEXT,
      },
      failureEventType: "oauth.login.failed",
    });
    expect(
      harness.authSessionService.authenticateVerifiedUser,
    ).not.toHaveBeenCalled();
    expect(
      harness.loginLockoutService.clearAttemptRecord,
    ).not.toHaveBeenCalled();
  });

  it("voids the challenge when the wrong code sets the lock", async () => {
    const harness = createHarness();
    harness.mfaTotpService.verifyCode.mockRejectedValue(
      new UnauthorizedError("MFA verification failed."),
    );
    harness.loginLockoutService.recordFailedLogin.mockRejectedValue(
      new LockedError("This sign-in is locked."),
    );

    await expect(
      harness.service.completeLoginMfa(createInput()),
    ).rejects.toBeInstanceOf(LockedError);

    expect(harness.challenges.has(TOKEN)).toBe(false);
    expect(harness.loginMfaChallengeStore.delete).toHaveBeenCalledTimes(1);
  });

  it("keeps the challenge when recording the failure fails for another reason", async () => {
    const harness = createHarness();
    harness.mfaTotpService.verifyCode.mockRejectedValue(
      new UnauthorizedError("MFA verification failed."),
    );
    harness.loginLockoutService.recordFailedLogin.mockRejectedValue(
      new Error("redis unavailable"),
    );

    await expect(
      harness.service.completeLoginMfa(createInput()),
    ).rejects.toThrow("redis unavailable");

    expect(harness.challenges.has(TOKEN)).toBe(true);
  });

  it("does not count an error that is not a rejected code", async () => {
    const harness = createHarness();
    harness.mfaTotpService.verifyCode.mockRejectedValue(
      new Error("MFA store unavailable."),
    );

    await expect(
      harness.service.completeLoginMfa(createInput()),
    ).rejects.toThrow("MFA store unavailable.");

    expect(
      harness.loginLockoutService.recordFailedLogin,
    ).not.toHaveBeenCalled();
    expect(harness.challenges.has(TOKEN)).toBe(true);
  });

  it("still signs in when the device-login proof cannot be written", async () => {
    const harness = createHarness();
    harness.mfaVerificationService.recordLoginProof.mockRejectedValue(
      new Error("redis unavailable"),
    );

    await expect(harness.service.completeLoginMfa(createInput())).resolves.toBe(
      harness.session,
    );
  });

  it("skips the device-login proof for a session without an id", async () => {
    const harness = createHarness();
    harness.authSessionService.authenticateVerifiedUser.mockResolvedValue(
      createSessionResult(),
    );

    await harness.service.completeLoginMfa(createInput());

    expect(
      harness.mfaVerificationService.recordLoginProof,
    ).not.toHaveBeenCalled();
  });
});

describe("LoginMfaService.evaluateFirstStep", () => {
  const audit = {
    method: "password" as const,
    identifierHash: "hash:test-user",
    context: AUDIT_CONTEXT,
  };

  function evaluate(
    harness: ReturnType<typeof createHarness>,
    overrides: Partial<
      Parameters<LoginMfaService["evaluateFirstStep"]>[0]
    > = {},
  ) {
    return harness.service.evaluateFirstStep({
      user: createUser(),
      method: "password",
      audit,
      client: BOUND_CLIENT,
      deviceId: "device-1",
      rememberMe: true,
      ...overrides,
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("needs nothing from an account without an authenticator", async () => {
    const harness = createHarness();
    harness.mfaTotpService.isEnabled.mockResolvedValue(false);
    harness.loginLockoutService.isLocked.mockResolvedValue(true);

    await expect(evaluate(harness)).resolves.toEqual({
      status: "not_required",
    });
    // The lock guards code guessing, so an account without a code skips it.
    expect(harness.loginLockoutService.isLocked).not.toHaveBeenCalled();
    expect(harness.authAuditService.recordSafely).not.toHaveBeenCalled();
  });

  it("skips everything for a bypass-eligible address, lock included", async () => {
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    jest.spyOn(environment, "getTokenConfig").mockReturnValue({
      ...environment.getTokenConfig(),
      mfaBypassEmails: ["bypass@rentify.local"],
    });
    const harness = createHarness();
    harness.loginLockoutService.isLocked.mockResolvedValue(true);

    await expect(
      evaluate(harness, {
        user: createUser({ email: "bypass@rentify.local" }),
      }),
    ).resolves.toEqual({ status: "not_required" });
    expect(harness.mfaTotpService.isEnabled).not.toHaveBeenCalled();
    expect(harness.loginLockoutService.isLocked).not.toHaveBeenCalled();
  });

  it("skips the code on a remembered device and records why", async () => {
    const harness = createHarness();
    harness.deviceTrustService.findTrust.mockResolvedValue({
      trustedUntil: "2026-12-01T00:00:00.000Z",
    });

    await expect(evaluate(harness, { totpCode: "000000" })).resolves.toEqual({
      status: "trusted_device",
      trustedUntil: "2026-12-01T00:00:00.000Z",
    });
    expect(harness.deviceTrustService.findTrust).toHaveBeenCalledWith(
      createUser(),
      BOUND_CLIENT,
    );
    // Neither a challenge nor the code sent along with the password.
    expect(harness.loginMfaChallengeStore.issue).not.toHaveBeenCalled();
    expect(harness.mfaTotpService.verifyCode).not.toHaveBeenCalled();
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith({
      ...audit,
      eventType: "login.mfa_skipped_trusted_device",
      outcome: "success",
      userId: USER_1_ID,
      metadata: { trustedUntil: "2026-12-01T00:00:00.000Z" },
    });
  });

  it("still refuses a locked username on a remembered device", async () => {
    const harness = createHarness();
    harness.deviceTrustService.findTrust.mockResolvedValue({
      trustedUntil: "2026-12-01T00:00:00.000Z",
    });
    harness.loginLockoutService.isLocked.mockResolvedValue(true);

    await expect(evaluate(harness)).rejects.toBeInstanceOf(LockedError);
    expect(harness.deviceTrustService.findTrust).not.toHaveBeenCalled();
  });

  it("refuses with a challenge and records it as a successful first step", async () => {
    const harness = createHarness();

    await expect(
      evaluate(harness, {
        method: "google",
        audit: { ...audit, method: "google" },
      }),
    ).rejects.toMatchObject({
      constructor: LoginMfaRequiredError,
      status: 401,
      code: "UNAUTHORIZED",
      message: "Authenticator code is required.",
      details: {
        mfaRequired: true,
        mfaChallengeToken: "new-challenge-token",
        availableFactors: ["totp"],
        expiresInSeconds: 300,
        rememberDeviceDays: 30,
      },
    });
    expect(harness.loginMfaChallengeStore.issue).toHaveBeenCalledWith(
      {
        userId: USER_1_ID,
        method: "google",
        username: "test-user",
        identifierHash: "hash:test-user",
        deviceId: "device-1",
        rememberMe: true,
        tokenVersion: 1,
      },
      ["totp"],
    );
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledTimes(1);
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith({
      ...audit,
      method: "google",
      eventType: "login.mfa_challenged",
      outcome: "success",
      reasonCode: "mfa_required",
      userId: USER_1_ID,
    });
    expect(
      harness.loginLockoutService.clearAttemptRecord,
    ).not.toHaveBeenCalled();
  });

  it("offers recovery codes only while the account has some", async () => {
    const harness = createHarness();
    harness.mfaRecoveryCodeService.countUnused.mockResolvedValue(1);

    await expect(evaluate(harness)).rejects.toBeInstanceOf(
      LoginMfaRequiredError,
    );

    expect(harness.loginMfaChallengeStore.issue).toHaveBeenCalledWith(
      expect.anything(),
      ["totp", "recovery_code"],
    );
  });

  it("never treats the deprecated totpCode field as a recovery code", async () => {
    const harness = createHarness();

    await evaluate(harness, { totpCode: "ABCDE-FGH23" });

    expect(harness.mfaTotpService.verifyCode).toHaveBeenCalledWith(
      USER_1_ID,
      "ABCDE-FGH23",
    );
    expect(harness.mfaRecoveryCodeService.redeem).not.toHaveBeenCalled();
  });

  it("refuses a locked username before issuing a challenge or checking a code", async () => {
    const harness = createHarness();
    harness.loginLockoutService.isLocked.mockResolvedValue(true);

    await expect(
      evaluate(harness, { totpCode: "123456" }),
    ).rejects.toBeInstanceOf(LockedError);
    expect(harness.loginLockoutService.recordLockedLogin).toHaveBeenCalled();
    expect(harness.mfaTotpService.verifyCode).not.toHaveBeenCalled();
    expect(harness.loginMfaChallengeStore.issue).not.toHaveBeenCalled();
  });

  it("verifies a code sent with the first step and clears the count", async () => {
    const harness = createHarness();

    await expect(evaluate(harness, { totpCode: "123456" })).resolves.toEqual({
      status: "verified",
      factor: "totp",
    });
    expect(harness.mfaTotpService.verifyCode).toHaveBeenCalledWith(
      USER_1_ID,
      "123456",
    );
    expect(harness.loginLockoutService.clearAttemptRecord).toHaveBeenCalledWith(
      "test-user",
    );
    expect(harness.loginMfaChallengeStore.issue).not.toHaveBeenCalled();
  });

  it.each([
    ["password", "login.failed"],
    ["microsoft", "oauth.login.failed"],
  ] as const)(
    "counts a wrong %s first-step code and rethrows the rejection",
    async (method, failureEventType) => {
      const harness = createHarness();
      const rejection = new UnauthorizedError("MFA verification failed.");
      harness.mfaTotpService.verifyCode.mockRejectedValue(rejection);

      await expect(
        evaluate(harness, {
          method,
          audit: { ...audit, method },
          totpCode: "000000",
        }),
      ).rejects.toBe(rejection);
      expect(
        harness.loginLockoutService.recordFailedLogin,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          username: "test-user",
          reasonCode: "mfa_invalid",
          failureEventType,
        }),
      );
      expect(
        harness.loginLockoutService.clearAttemptRecord,
      ).not.toHaveBeenCalled();
    },
  );
});

describe("LoginMfaService.recordVerifiedSignIn", () => {
  it("records the factor as the session's device-login proof", async () => {
    const harness = createHarness();

    await harness.service.recordVerifiedSignIn(
      createUser(),
      harness.session,
      "totp",
    );

    expect(
      harness.mfaVerificationService.recordLoginProof,
    ).toHaveBeenCalledWith({
      userId: USER_1_ID,
      sessionId: "session-1",
      factor: "totp",
    });
  });
});

describe("LoginMfaService with a passkey", () => {
  const ASSERTION = {
    id: "Y3JlZA",
    rawId: "Y3JlZA",
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: "Y2Q",
      authenticatorData: "YWQ",
      signature: "c2ln",
    },
  };
  const freshChallenge = () =>
    createChallenge({ createdAt: new Date(Date.now() - 60_000).toISOString() });

  function beginInput(overrides: { deviceId?: string } = {}) {
    return {
      mfaChallengeToken: TOKEN,
      deviceId: "device-1",
      audit: AUDIT_CONTEXT,
      ...overrides,
    };
  }

  it("asks a passkey-only account for a second factor at sign-in", async () => {
    const harness = createHarness({ passkeyCount: 1 });
    harness.mfaTotpService.isEnabled.mockResolvedValue(false);
    harness.mfaRecoveryCodeService.countUnused.mockResolvedValue(10);

    await expect(
      harness.service.evaluateFirstStep({
        user: createUser(),
        method: "password",
        audit: { method: "password", context: AUDIT_CONTEXT },
        client: BOUND_CLIENT,
        deviceId: "device-1",
      }),
    ).rejects.toBeInstanceOf(LoginMfaRequiredError);
    expect(harness.loginMfaChallengeStore.issue).toHaveBeenCalledWith(
      expect.anything(),
      ["passkey", "recovery_code"],
    );
  });

  it("lists the passkey ahead of the authenticator", async () => {
    const harness = createHarness({ passkeyCount: 2 });

    await expect(
      harness.service.evaluateFirstStep({
        user: createUser(),
        method: "google",
        audit: { method: "google", context: AUDIT_CONTEXT },
        client: BOUND_CLIENT,
      }),
    ).rejects.toBeInstanceOf(LoginMfaRequiredError);
    expect(harness.loginMfaChallengeStore.issue).toHaveBeenCalledWith(
      expect.anything(),
      ["passkey", "totp"],
    );
  });

  it("issues options bound to the sign-in, lasting no longer than it", async () => {
    const harness = createHarness({ challenge: freshChallenge() });

    const result = await harness.service.beginPasskey(beginInput());

    expect(result).toEqual({ options: { challenge: "passkey-challenge" } });
    const [call] = harness.passkeyService.beginAssertion.mock
      .calls as unknown as [
      [
        {
          userId: string;
          purpose: string;
          binding: string;
          ttlSeconds: number;
        },
      ],
    ];
    expect(call[0]).toMatchObject({
      userId: USER_1_ID,
      purpose: "login",
      binding: TOKEN,
    });
    expect(call[0].ttlSeconds).toBeGreaterThan(230);
    expect(call[0].ttlSeconds).toBeLessThanOrEqual(240);
  });

  it("refuses options for an unknown or expired sign-in", async () => {
    const harness = createHarness({ challenge: null });

    await expect(
      harness.service.beginPasskey(beginInput()),
    ).rejects.toBeInstanceOf(LoginMfaChallengeInvalidError);
    expect(harness.passkeyService.beginAssertion).not.toHaveBeenCalled();
  });

  it("refuses options for a sign-in whose time is up", async () => {
    const harness = createHarness({
      challenge: createChallenge({
        createdAt: new Date(Date.now() - 301_000).toISOString(),
      }),
    });

    await expect(
      harness.service.beginPasskey(beginInput()),
    ).rejects.toBeInstanceOf(LoginMfaChallengeInvalidError);
  });

  it("refuses options from another device and audits it", async () => {
    const harness = createHarness({ challenge: freshChallenge() });

    await expect(
      harness.service.beginPasskey(beginInput({ deviceId: "device-2" })),
    ).rejects.toBeInstanceOf(LoginMfaChallengeInvalidError);
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "login.failed",
        reasonCode: "token_invalid",
      }),
    );
    expect(harness.challenges.has(TOKEN)).toBe(true);
  });

  it("refuses options to a locked username", async () => {
    const harness = createHarness({ challenge: freshChallenge() });
    harness.loginLockoutService.isLocked.mockResolvedValue(true);

    await expect(
      harness.service.beginPasskey(beginInput()),
    ).rejects.toBeInstanceOf(LockedError);
    expect(harness.passkeyService.beginAssertion).not.toHaveBeenCalled();
  });

  it("voids the sign-in when the account signed out everywhere since", async () => {
    const harness = createHarness({
      challenge: freshChallenge(),
      user: createUser({ tokenVersion: 2 }),
    });

    await expect(
      harness.service.beginPasskey(beginInput()),
    ).rejects.toBeInstanceOf(LoginMfaChallengeInvalidError);
    expect(harness.challenges.has(TOKEN)).toBe(false);
  });

  it("finishes a sign-in with a verified assertion", async () => {
    const harness = createHarness({ passkeyCount: 1 });

    const result = await harness.service.completeLoginMfa(
      createInput({
        factor: "passkey",
        code: undefined,
        credential: ASSERTION,
      }),
    );

    expect(result).toBe(harness.session);
    expect(harness.passkeyService.verifyAssertion).toHaveBeenCalledWith({
      userId: USER_1_ID,
      purpose: "login",
      binding: TOKEN,
      credential: ASSERTION,
      method: "password",
      context: AUDIT_CONTEXT,
    });
    expect(harness.mfaTotpService.verifyCode).not.toHaveBeenCalled();
    expect(
      harness.mfaVerificationService.recordLoginProof,
    ).toHaveBeenCalledWith(expect.objectContaining({ factor: "passkey" }));
    expect(harness.loginLockoutService.clearAttemptRecord).toHaveBeenCalled();
  });

  it("counts a refused assertion against the username lockout", async () => {
    const harness = createHarness({ passkeyCount: 1 });
    harness.passkeyService.verifyAssertion.mockRejectedValue(
      new UnauthorizedError("MFA verification failed."),
    );

    await expect(
      harness.service.completeLoginMfa(
        createInput({
          factor: "passkey",
          code: undefined,
          credential: ASSERTION,
        }),
      ),
    ).rejects.toThrow(
      new InvalidMfaCodeError("That passkey could not be verified."),
    );
    expect(harness.loginLockoutService.recordFailedLogin).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "mfa_invalid" }),
    );
    expect(harness.challenges.has(TOKEN)).toBe(true);
  });
});
