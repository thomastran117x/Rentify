import ConflictError from "@/errors/http/conflict.error";
import InvalidMfaCodeError from "@/errors/http/invalid-mfa-code.error";
import LockedError from "@/errors/http/locked.error";
import LoginMfaChallengeInvalidError from "@/errors/http/login-mfa-challenge-invalid.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import type {
  CompleteLoginMfaInput,
  LoginMfaChallengeRecord,
} from "@/features/auth/mfa/login/login-mfa.model";
import {
  LoginMfaService,
  MAX_LOGIN_MFA_CHALLENGE_ATTEMPTS,
} from "@/features/auth/mfa/login/login-mfa.service";
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
    failedAttempts: 0,
    createdAt: "2026-10-27T00:00:00.000Z",
    ...overrides,
  };
}

function createInput(
  overrides: Partial<CompleteLoginMfaInput> = {},
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
  };
}

function createHarness(
  options: {
    challenge?: LoginMfaChallengeRecord | null;
    user?: AuthUserRecord | null;
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
    update: jest.fn(async (token: string, record: LoginMfaChallengeRecord) => {
      challenges.set(token, record);
    }),
    delete: jest.fn(async (token: string) => {
      challenges.delete(token);
    }),
  };
  const usersRepository = {
    findUserById: jest.fn(async () =>
      options.user === undefined ? createUser() : options.user,
    ),
  };
  const mfaTotpService = { verifyCode: jest.fn(async () => undefined) };
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
    service: new LoginMfaService(
      usersRepository as never,
      loginMfaChallengeStore as never,
      mfaTotpService as never,
      mfaVerificationService as never,
      authSessionService as never,
      loginLockoutService as never,
      authAuditService as never,
    ),
  };
}

describe("LoginMfaService.completeLoginMfa", () => {
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

  it("counts a wrong code against the challenge and the username lockout", async () => {
    const harness = createHarness({
      challenge: createChallenge({ method: "apple" }),
    });
    harness.mfaTotpService.verifyCode.mockRejectedValue(
      new UnauthorizedError("MFA verification failed."),
    );

    await expect(
      harness.service.completeLoginMfa(createInput({ code: "000000" })),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    expect(harness.challenges.get(TOKEN)?.failedAttempts).toBe(1);
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

  it("uses up the challenge after the last allowed wrong code", async () => {
    const harness = createHarness({
      challenge: createChallenge({
        failedAttempts: MAX_LOGIN_MFA_CHALLENGE_ATTEMPTS - 1,
      }),
    });
    harness.mfaTotpService.verifyCode.mockRejectedValue(
      new UnauthorizedError("MFA verification failed."),
    );

    await expect(
      harness.service.completeLoginMfa(createInput()),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    expect(harness.challenges.has(TOKEN)).toBe(false);
    expect(harness.loginMfaChallengeStore.update).not.toHaveBeenCalled();
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

    expect(harness.challenges.get(TOKEN)?.failedAttempts).toBe(1);
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
    expect(harness.challenges.get(TOKEN)?.failedAttempts).toBe(0);
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
