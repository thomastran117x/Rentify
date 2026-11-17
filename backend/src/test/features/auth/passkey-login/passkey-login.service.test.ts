import LockedError from "@/errors/http/locked.error";
import PasskeyLoginFailedError from "@/errors/http/passkey-login-failed.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { DiscoverableAssertionResult } from "@/features/auth/mfa/passkey/passkey.service";
import { PasskeyLoginService } from "@/features/auth/passkey-login/passkey-login.service";
import { testUuid } from "../../../support/uuid";

const USER_ID = testUuid(9000, 466001);
const PASSKEY_ID = "passkey-1";
const CONTEXT = {
  ipAddress: "203.0.113.7",
  requestId: "request-1",
  deviceId: "device-1",
};
const CREDENTIAL = {
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: "e30",
    authenticatorData: "AA",
    signature: "AA",
    userHandle: "dXNlcg",
  },
};
const SESSION = {
  sessionId: "session-1",
  accessToken: "access",
  device: { known: false, knownByIp: false },
};

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "casey@rentify.local",
    emailVerified: true,
    status: "active",
    tokenVersion: 0,
    profile: { username: "casey" },
    ...overrides,
  };
}

function createService(
  options: {
    result?: DiscoverableAssertionResult;
    user?: ReturnType<typeof buildUser> | null;
    lockedAt?: string;
  } = {},
) {
  const result: DiscoverableAssertionResult = options.result ?? {
    status: "verified",
    userId: USER_ID,
    passkeyId: PASSKEY_ID,
  };
  const user = options.user === undefined ? buildUser() : options.user;
  const passkeyService = {
    beginDiscoverableAssertion: jest.fn(async () => ({
      challenge: "challenge-1",
      rpId: "localhost",
      userVerification: "required" as const,
    })),
    verifyDiscoverableAssertion: jest.fn(async () => result),
  };
  const usersRepository = { findUserById: jest.fn(async () => user) };
  const loginLockoutService = {
    getAttemptRecord: jest.fn(async () =>
      options.lockedAt ? { lockedAt: options.lockedAt } : null,
    ),
    recordLockedLogin: jest.fn(async () => undefined),
    throwLockedLogin: jest.fn(async () => {
      throw new LockedError("This sign-in is locked.");
    }),
    recordFailedLogin: jest.fn(async () => undefined),
    clearAttemptRecord: jest.fn(async () => undefined),
  };
  const authSessionService = {
    authenticateVerifiedUser: jest.fn(async () => SESSION),
  };
  const loginMfaService = { recordVerifiedSignIn: jest.fn(async () => {}) };
  const authAuditService = {
    recordSafely: jest.fn(async () => undefined),
    hashIdentifier: jest.fn((value: string) => `username-hash:${value}`),
    hashPasskeyCredentialId: jest.fn(
      (value: string) => `credential-hash:${value}`,
    ),
  };
  const service = new PasskeyLoginService({
    passkeyService: passkeyService as never,
    usersRepository: usersRepository as never,
    loginLockoutService: loginLockoutService as never,
    authSessionService: authSessionService as never,
    loginMfaService: loginMfaService as never,
    authAuditService,
  });

  return {
    service,
    passkeyService,
    usersRepository,
    loginLockoutService,
    authSessionService,
    loginMfaService,
    authAuditService,
  };
}

function authenticate(service: PasskeyLoginService) {
  return service.authenticate({
    credential: CREDENTIAL as never,
    rememberMe: true,
    deviceId: "device-1",
    client: { device: { id: "device-1" } } as never,
    audit: CONTEXT,
  });
}

const PASSKEY_AUDIT = {
  method: "passkey",
  identifierHash: "username-hash:casey",
  context: CONTEXT,
};

describe("PasskeyLoginService", () => {
  it("returns request options for a discoverable passkey", async () => {
    const { service } = createService();

    await expect(service.beginOptions()).resolves.toEqual({
      options: expect.objectContaining({ userVerification: "required" }),
    });
  });

  it("signs in with no second step, records the proof and the success", async () => {
    const {
      service,
      passkeyService,
      loginLockoutService,
      authSessionService,
      loginMfaService,
      authAuditService,
    } = createService();

    await expect(authenticate(service)).resolves.toBe(SESSION);

    expect(passkeyService.verifyDiscoverableAssertion).toHaveBeenCalledWith({
      credential: CREDENTIAL,
      context: CONTEXT,
    });
    expect(loginLockoutService.clearAttemptRecord).toHaveBeenCalledWith(
      "casey",
    );
    expect(authSessionService.authenticateVerifiedUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      expect.objectContaining({
        deviceId: "device-1",
        rememberMe: true,
        audit: CONTEXT,
      }),
    );
    expect(loginMfaService.recordVerifiedSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      SESSION,
      "passkey",
    );
    expect(authAuditService.recordSafely).toHaveBeenCalledTimes(1);
    expect(authAuditService.recordSafely).toHaveBeenCalledWith({
      ...PASSKEY_AUDIT,
      eventType: "login.succeeded",
      outcome: "success",
      userId: USER_ID,
      sessionId: "session-1",
      metadata: { passkeyId: PASSKEY_ID },
    });
  });

  it.each([
    [
      "an unknown passkey",
      { status: "rejected", reason: "unknown_credential" } as const,
      undefined,
    ],
    [
      "an expired challenge",
      { status: "rejected", reason: "challenge_missing" } as const,
      undefined,
    ],
    [
      "a passkey whose account is gone",
      {
        status: "verified",
        userId: USER_ID,
        passkeyId: PASSKEY_ID,
      } as const,
      null,
    ],
  ])(
    "refuses %s under the credential's hash, naming no account",
    async (_label, result, user) => {
      const { service, loginLockoutService, authAuditService } = createService({
        result,
        user,
      });

      await expect(authenticate(service)).rejects.toBeInstanceOf(
        PasskeyLoginFailedError,
      );
      expect(authAuditService.recordSafely).toHaveBeenCalledWith({
        eventType: "login.failed",
        outcome: "failure",
        reasonCode: "bad_credentials",
        method: "passkey",
        identifierHash: `credential-hash:${CREDENTIAL.rawId}`,
        context: CONTEXT,
      });
      expect(loginLockoutService.recordFailedLogin).not.toHaveBeenCalled();
    },
  );

  it("counts a refused assertion towards the account's lockout", async () => {
    const { service, loginLockoutService, authSessionService } = createService({
      result: {
        status: "rejected",
        reason: "verification_failed",
        userId: USER_ID,
        passkeyId: PASSKEY_ID,
      },
    });

    await expect(authenticate(service)).rejects.toBeInstanceOf(
      PasskeyLoginFailedError,
    );
    expect(loginLockoutService.recordFailedLogin).toHaveBeenCalledWith({
      username: "casey",
      user: expect.objectContaining({ id: USER_ID }),
      reasonCode: "bad_credentials",
      audit: PASSKEY_AUDIT,
    });
    expect(authSessionService.authenticateVerifiedUser).not.toHaveBeenCalled();
  });

  it("lets the lockout's own error through when a refusal sets the lock", async () => {
    const { service, loginLockoutService } = createService({
      result: {
        status: "rejected",
        reason: "verification_failed",
        userId: USER_ID,
      },
    });
    loginLockoutService.recordFailedLogin.mockRejectedValueOnce(
      new LockedError("This sign-in is locked."),
    );

    await expect(authenticate(service)).rejects.toBeInstanceOf(LockedError);
  });

  it("refuses even a good passkey while the username is locked", async () => {
    const { service, loginLockoutService, authSessionService } = createService({
      lockedAt: "2026-11-16T10:00:00.000Z",
    });

    await expect(authenticate(service)).rejects.toBeInstanceOf(LockedError);
    expect(loginLockoutService.recordLockedLogin).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      PASSKEY_AUDIT,
    );
    expect(loginLockoutService.recordFailedLogin).not.toHaveBeenCalled();
    expect(authSessionService.authenticateVerifiedUser).not.toHaveBeenCalled();
  });

  it.each([
    ["suspended", "account_suspended"],
    ["locked", "account_locked"],
  ])("stops a %s account at the status check", async (status, reasonCode) => {
    const { service, authAuditService, authSessionService } = createService({
      user: buildUser({ status }),
    });

    await expect(authenticate(service)).rejects.toThrow();
    expect(authAuditService.recordSafely).toHaveBeenCalledWith({
      ...PASSKEY_AUDIT,
      eventType: "login.failed",
      outcome: "blocked",
      reasonCode,
      userId: USER_ID,
    });
    expect(authSessionService.authenticateVerifiedUser).not.toHaveBeenCalled();
  });

  it("refuses an account whose email is not verified", async () => {
    const { service, authAuditService } = createService({
      user: buildUser({ emailVerified: false }),
    });

    await expect(authenticate(service)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(authAuditService.recordSafely).toHaveBeenCalledWith({
      ...PASSKEY_AUDIT,
      eventType: "login.failed",
      outcome: "failure",
      reasonCode: "email_unverified",
      userId: USER_ID,
    });
  });
});
