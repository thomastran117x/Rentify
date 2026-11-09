import bcrypt from "bcrypt";
import ConflictError from "@/errors/http/conflict.error";
import LockedError from "@/errors/http/locked.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { RequestValidationError } from "@/configuration/validation/request";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type {
  AccountStatus,
  AuthUserRecord,
  OAuthIdentityRecord,
} from "@/features/auth/auth.model";
import { LoginLockoutService } from "@/features/auth/lockout/login-lockout.service";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";
import { PasswordService } from "@/features/auth/password/password.service";
import { AuthSessionService } from "@/features/auth/session/session.service";
import { testUuid } from "../../support/uuid";
const IDENTITY_1_ID = testUuid(9000, 994443);

const PROFILE_1_ID = testUuid(9000, 548259);
const USER_1_ID = testUuid(9000, 994257);

// Cost 4 keeps the suite fast; the production rounds are covered by
// password-hashing.test.ts.
const CURRENT_PASSWORD = "CorrectHorseBatteryStaple1!";
const NEW_PASSWORD = "AnotherStrongPassword1!";

function createClient(): ClientRequestContext {
  return {
    ip: "127.0.0.1",
    device: { id: "device-1", type: "desktop", isMobile: false },
  } as ClientRequestContext;
}

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: USER_1_ID,
    email: "user@example.com",
    passwordHash: "",
    tokenVersion: 2,
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

const googleIdentity: OAuthIdentityRecord = {
  id: IDENTITY_1_ID,
  userId: USER_1_ID,
  provider: "google",
  providerUserId: "google-user-1",
  emailVerified: true,
  linkedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function createHarness() {
  const securityNotificationService = {
    notify: jest.fn(async (_input: { eventId: string }) => "sent"),
  };
  const store = new Map<string, unknown>();
  const cacheService = {
    getJson: jest.fn(async (key: string) => store.get(key) ?? null),
    setJson: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  const authRepository = {
    findUserByUsername: jest.fn(async () => null as AuthUserRecord | null),
    findUserById: jest.fn(async () => null as AuthUserRecord | null),
    findUserByEmail: jest.fn(async () => null as AuthUserRecord | null),
    updatePasswordHash: jest.fn(async () => undefined),
    setPasswordHashIfUnset: jest.fn(async () => true),
    rotateTokenVersion: jest.fn(async () => 9),
  };
  const otpService = {
    verify: jest.fn(async () => undefined),
    issue: jest.fn(async () => ({ code: "123456", ttlInSeconds: 600 })),
  };
  const emailService = {
    sendPasswordResetEmail: jest.fn(async () => undefined),
    sendLoginUnlockEmail: jest.fn(async () => undefined),
  };
  const tokenService = {
    createAccessToken: jest.fn(() => "access-token"),
    createRefreshToken: jest.fn(async () => "refresh-token"),
    createSession: jest.fn(async () => undefined),
    getRefreshTokenExpiresInSeconds: jest.fn(() => 2_592_000),
  };
  const deviceService = {
    evaluateExistingSessionDevice: jest.fn(async () => ({
      deviceId: "device-1",
      known: true,
      knownByIp: true,
    })),
  };
  const authAuditService = {
    hashIdentifier: jest.fn((value: string) => `hash:${value}`),
    recordSafely: jest.fn(async () => undefined),
  };
  const accountStatusService = {
    liftSecurityHold: jest.fn(async (): Promise<AccountStatus> => "active"),
  };
  const publicOtpService = new PublicOtpService(
    cacheService as never,
    otpService as never,
    emailService as never,
  );

  return {
    store,
    cacheService,
    authRepository,
    otpService,
    emailService,
    tokenService,
    authAuditService,
    accountStatusService,
    securityNotificationService,
    service: new PasswordService(
      authRepository as never,
      authRepository as never,
      authRepository as never,
      otpService as never,
      new AuthSessionService(
        authRepository as never,
        authRepository as never,
        tokenService as never,
        deviceService as never,
        { recordSafely: async () => undefined } as never,
      ),
      new LoginLockoutService(
        cacheService as never,
        authRepository as never,
        otpService as never,
        publicOtpService,
        // Shared, so a test sees the events the lockout writes on the
        // service's behalf as well as the ones the service writes itself.
        authAuditService as never,
      ),
      publicOtpService,
      authAuditService as never,
      accountStatusService as never,
      securityNotificationService as never,
    ),
  };
}

async function localUser(): Promise<AuthUserRecord> {
  return createUser({ passwordHash: await bcrypt.hash(CURRENT_PASSWORD, 4) });
}

describe("PasswordService.forgotPassword", () => {
  it("sends a reset code to an eligible local account", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      await localUser(),
    );

    await expect(
      harness.service.forgotPassword({
        client: createClient(),
        username: "test-user",
      }),
    ).resolves.toEqual({ accepted: true });

    expect(harness.emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@example.com", resetCode: "123456" }),
    );
  });

  it("accepts an unknown username without sending anything", async () => {
    const harness = createHarness();

    await expect(
      harness.service.forgotPassword({
        client: createClient(),
        username: "nobody",
      }),
    ).resolves.toEqual({ accepted: true });
    expect(harness.emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("does not reveal a social-only account", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      createUser({
        passwordHash: undefined,
        oauthIdentities: [googleIdentity],
      }),
    );

    await expect(
      harness.service.forgotPassword({
        client: createClient(),
        username: "test-user",
      }),
    ).resolves.toEqual({ accepted: true });
    expect(harness.emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("still reports acceptance when rate limited", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      await localUser(),
    );
    harness.store.set("auth:otp-rate:local-password-reset:email:test-user", {
      count: 5,
    });

    await expect(
      harness.service.forgotPassword({
        client: createClient(),
        username: "test-user",
      }),
    ).resolves.toEqual({ accepted: true });
    expect(harness.emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("labels a resend distinctly from a first request", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      await localUser(),
    );

    await expect(
      harness.service.resendForgotPassword({
        client: createClient(),
        username: "test-user",
      }),
    ).resolves.toEqual({ accepted: true });
    expect(harness.emailService.sendPasswordResetEmail).toHaveBeenCalled();
  });
});

describe("PasswordService.resetPassword", () => {
  it("verifies the code, writes the hash and rotates the token version", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      await localUser(),
    );

    const session = await harness.service.resetPassword({
      client: createClient(),
      username: "test-user",
      code: "123456",
      newPassword: NEW_PASSWORD,
      deviceId: "device-1",
    });

    expect(harness.otpService.verify).toHaveBeenCalledWith({
      purpose: "local-password-reset",
      subject: "user@example.com",
      code: "123456",
      beforeConsume: expect.any(Function),
    });
    expect(harness.authRepository.updatePasswordHash).toHaveBeenCalled();
    expect(harness.authRepository.rotateTokenVersion).toHaveBeenCalledWith(
      USER_1_ID,
    );
    expect(session.accessToken).toBe("access-token");
    expect(harness.securityNotificationService.notify).toHaveBeenCalledTimes(1);
    expect(harness.securityNotificationService.notify).toHaveBeenCalledWith({
      kind: "password_changed",
      details: { change: "reset" },
      userId: USER_1_ID,
      eventId: expect.any(String),
      context: undefined,
    });
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith({
      id: harness.securityNotificationService.notify.mock.calls[0]![0].eventId,
      eventType: "password.reset",
      outcome: "success",
      userId: USER_1_ID,
      method: "password",
      identifierHash: "hash:test-user",
      sessionId: expect.any(String),
      context: undefined,
      metadata: { emailNotification: "sent" },
    });
  }, 20_000);

  it("clears any login lockout", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      await localUser(),
    );

    await harness.service.resetPassword({
      client: createClient(),
      username: "test-user",
      code: "123456",
      newPassword: NEW_PASSWORD,
    });

    expect(harness.cacheService.delete).toHaveBeenCalledWith(
      "auth:local-login-attempts:test-user",
    );
  }, 20_000);

  it("consumes an OTP attempt under a synthetic subject for an unknown username", async () => {
    // Otherwise the endpoint would answer faster for names that do not exist.
    const harness = createHarness();

    await expect(
      harness.service.resetPassword({
        client: createClient(),
        username: "nobody",
        code: "123456",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow();

    expect(harness.otpService.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "auth:missing-password-reset:nobody",
      }),
    );
  });

  it("rejects a social-only account", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      createUser({
        passwordHash: undefined,
        oauthIdentities: [googleIdentity],
      }),
    );

    await expect(
      harness.service.resetPassword({
        client: createClient(),
        username: "test-user",
        code: "123456",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects reusing the current password", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      await localUser(),
    );

    await expect(
      harness.service.resetPassword({
        client: createClient(),
        username: "test-user",
        code: "123456",
        newPassword: CURRENT_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.authRepository.updatePasswordHash).not.toHaveBeenCalled();
  }, 20_000);

  it("refuses a suspended account before writing anything", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      createUser({ ...(await localUser()), status: "suspended" }),
    );

    await expect(
      harness.service.resetPassword({
        client: createClient(),
        username: "test-user",
        code: "123456",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    expect(harness.authRepository.updatePasswordHash).not.toHaveBeenCalled();
    expect(
      harness.accountStatusService.liftSecurityHold,
    ).not.toHaveBeenCalled();
  }, 20_000);

  it("lifts a security hold once the new password is written", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      createUser({ ...(await localUser()), status: "locked" }),
    );

    const session = await harness.service.resetPassword({
      client: createClient(),
      username: "test-user",
      code: "123456",
      newPassword: NEW_PASSWORD,
    });

    expect(session.accessToken).toBe("access-token");
    expect(harness.accountStatusService.liftSecurityHold).toHaveBeenCalledWith(
      USER_1_ID,
      expect.objectContaining({
        reason: "Security hold cleared by a password reset.",
      }),
    );
    expect(
      harness.authRepository.updatePasswordHash.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.accountStatusService.liftSecurityHold.mock
        .invocationCallOrder[0]!,
    );
  }, 20_000);

  /**
   * The account was locked when the reset began, and an admin suspended it
   * before the hold was lifted. The status is read again at that point, so
   * the suspension stands and no session is issued.
   */
  it("issues no session when the account was suspended during the reset", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      createUser({ ...(await localUser()), status: "locked" }),
    );
    harness.accountStatusService.liftSecurityHold.mockResolvedValueOnce(
      "suspended",
    );

    await expect(
      harness.service.resetPassword({
        client: createClient(),
        username: "test-user",
        code: "123456",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    expect(harness.authRepository.rotateTokenVersion).not.toHaveBeenCalled();
    expect(harness.tokenService.createSession).not.toHaveBeenCalled();
  }, 20_000);

  it("issues a session when the account is still active", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByUsername.mockResolvedValue(
      await localUser(),
    );

    await expect(
      harness.service.resetPassword({
        client: createClient(),
        username: "test-user",
        code: "123456",
        newPassword: NEW_PASSWORD,
      }),
    ).resolves.toMatchObject({ accessToken: "access-token" });
  }, 20_000);
});

describe("PasswordService new-password policy", () => {
  /** Runs the policy hook as the real `OtpService` does once a code matches. */
  function verifyRunsHook(harness: ReturnType<typeof createHarness>) {
    harness.otpService.verify.mockImplementation(
      async (input?: { beforeConsume?: () => Promise<void> }) => {
        await input?.beforeConsume?.();
      },
    );
  }

  async function rejection(promise: Promise<unknown>) {
    const error = await promise.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RequestValidationError);
    return (error as RequestValidationError).details;
  }

  it("refuses a reset to a password containing the account's details, before the code is spent", async () => {
    const harness = createHarness();
    verifyRunsHook(harness);
    harness.authRepository.findUserByUsername.mockResolvedValue(
      await localUser(),
    );

    // "Test" is the account's first name, not the username that was sent.
    const details = await rejection(
      harness.service.resetPassword({
        client: createClient(),
        username: "test-user",
        code: "123456",
        newPassword: "testing-the-waters",
        deviceId: "device-1",
      }),
    );

    expect(details).toEqual([
      {
        path: "newPassword",
        message:
          "Password must not contain your name, username or email address.",
      },
    ]);
    expect(harness.authRepository.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("checks an unknown username's reset against the name sent", async () => {
    const harness = createHarness();
    verifyRunsHook(harness);

    await rejection(
      harness.service.resetPassword({
        client: createClient(),
        username: "nobody-here",
        code: "123456",
        newPassword: "nobody-here-again",
        deviceId: "device-1",
      }),
    );
  });

  it("refuses a common new password only after the current one is proven", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());

    await expect(
      harness.service.changePassword({
        userId: USER_1_ID,
        client: createClient(),
        currentPassword: "WrongPassword1!",
        newPassword: "password1234",
        deviceId: "device-1",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const details = await rejection(
      harness.service.changePassword({
        userId: USER_1_ID,
        client: createClient(),
        currentPassword: CURRENT_PASSWORD,
        newPassword: "password1234",
        deviceId: "device-1",
      }),
    );

    expect(details).toEqual([
      {
        path: "newPassword",
        message:
          "This password is too common or easy to guess. Choose something less predictable.",
      },
    ]);
    expect(harness.authRepository.updatePasswordHash).not.toHaveBeenCalled();
  }, 20_000);

  it("refuses a first password containing the email address", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({
        email: "jordan.example@example.com",
        passwordHash: undefined,
        oauthIdentities: [googleIdentity],
      }),
    );

    await rejection(
      harness.service.setPassword({
        userId: USER_1_ID,
        client: createClient(),
        newPassword: "Jordan.Example.Rocks",
        deviceId: "device-1",
      }),
    );
    expect(
      harness.authRepository.setPasswordHashIfUnset,
    ).not.toHaveBeenCalled();
  });
});

describe("PasswordService.checkPassword", () => {
  it("checks an anonymous caller against the context sent", async () => {
    const harness = createHarness();

    await expect(
      harness.service.checkPassword({
        password: "all-about-taylor",
        context: { username: "taylor-renter" },
      }),
    ).resolves.toEqual({
      acceptable: false,
      issues: [
        {
          code: "contains_personal_info",
          message:
            "Password must not contain your name, username or email address.",
        },
      ],
      warnings: [],
    });
    expect(harness.authRepository.findUserById).not.toHaveBeenCalled();
  });

  it("checks a signed-in caller against their own account instead", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(createUser());

    // The body claims another name; the account's "test-user" is what counts.
    await expect(
      harness.service.checkPassword({
        password: "all-about-test-user",
        userId: USER_1_ID,
        context: { username: "someone-else" },
      }),
    ).resolves.toMatchObject({
      acceptable: false,
      issues: [{ code: "contains_personal_info" }],
    });
    expect(harness.authRepository.findUserById).toHaveBeenCalledWith(USER_1_ID);
  });

  it("falls back to the context sent when the account is gone", async () => {
    const harness = createHarness();

    await expect(
      harness.service.checkPassword({
        password: "tidal-harbor-lantern",
        userId: USER_1_ID,
        context: {},
      }),
    ).resolves.toEqual({ acceptable: true, issues: [], warnings: [] });
  });
});

describe("PasswordService.changePassword", () => {
  it("changes the password when the current one matches", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());

    const session = await harness.service.changePassword({
      userId: USER_1_ID,
      client: createClient(),
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
      deviceId: "device-1",
    });

    expect(harness.authRepository.updatePasswordHash).toHaveBeenCalled();
    expect(harness.authRepository.rotateTokenVersion).toHaveBeenCalled();
    expect(session.accessToken).toBe("access-token");
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "password.changed",
        method: "password",
        userId: USER_1_ID,
        sessionId: expect.any(String),
      }),
    );
    expect(harness.securityNotificationService.notify).toHaveBeenCalledTimes(1);
    expect(harness.securityNotificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "password_changed",
        details: { change: "changed" },
      }),
    );
  }, 20_000);

  it("records an email that could not be queued, and still changes the password", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());
    harness.securityNotificationService.notify.mockResolvedValue("failed");

    const session = await harness.service.changePassword({
      userId: USER_1_ID,
      client: createClient(),
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
      deviceId: "device-1",
    });

    expect(session.accessToken).toBe("access-token");
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "password.changed",
        metadata: { emailNotification: "failed" },
      }),
    );
  }, 20_000);

  it("tells the owner before issuing a session that could fail", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());
    harness.tokenService.createSession.mockRejectedValue(
      new Error("Session store down"),
    );

    await expect(
      harness.service.changePassword({
        userId: USER_1_ID,
        client: createClient(),
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
        deviceId: "device-1",
      }),
    ).rejects.toThrow("Session store down");

    expect(harness.securityNotificationService.notify).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("rejects an incorrect current password", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());

    await expect(
      harness.service.changePassword({
        userId: USER_1_ID,
        client: createClient(),
        currentPassword: "WrongPassword1!",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(harness.authRepository.updatePasswordHash).not.toHaveBeenCalled();
  }, 20_000);

  it("counts a wrong current password towards the sign-in lockout", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());
    const audit = { ipAddress: "203.0.113.9", requestId: "req-1" };

    await expect(
      harness.service.changePassword({
        userId: USER_1_ID,
        client: createClient(),
        currentPassword: "WrongPassword1!",
        newPassword: NEW_PASSWORD,
        audit,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    expect(harness.store.get("auth:local-login-attempts:test-user")).toEqual({
      failedAttempts: 1,
    });
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "password.change_failed",
      outcome: "failure",
      reasonCode: "bad_credentials",
      method: "password",
      userId: USER_1_ID,
      context: audit,
    });
  }, 20_000);

  it("locks password sign-in on the fifth wrong current password", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());
    harness.store.set("auth:local-login-attempts:test-user", {
      failedAttempts: 4,
    });

    const attempt = harness.service.changePassword({
      userId: USER_1_ID,
      client: createClient(),
      currentPassword: "WrongPassword1!",
      newPassword: NEW_PASSWORD,
    });

    await expect(attempt).rejects.toBeInstanceOf(LockedError);
    await expect(attempt).rejects.toMatchObject({
      status: 423,
      code: "ACCOUNT_LOCKED",
      details: { email: "user@example.com", unlockRequired: true },
    });
    expect(harness.store.get("auth:local-login-attempts:test-user")).toEqual(
      expect.objectContaining({
        failedAttempts: 5,
        lockedAt: expect.any(String),
      }),
    );
    // The attempt that sets the lock is recorded as the lock, not as one more
    // failure, exactly as at sign-in.
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "login.locked",
        outcome: "blocked",
        userId: USER_1_ID,
        metadata: { triggered: true, failureReason: "bad_credentials" },
      }),
    );
    expect(harness.authAuditService.recordSafely).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "password.change_failed" }),
    );
    expect(harness.emailService.sendLoginUnlockEmail).toHaveBeenCalledTimes(1);
    expect(harness.authRepository.updatePasswordHash).not.toHaveBeenCalled();
  }, 20_000);

  it("refuses a locked account before checking the password", async () => {
    // Even the right password must not get through, or clear the lock.
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());
    harness.store.set("auth:local-login-attempts:test-user", {
      failedAttempts: 5,
      lockedAt: "2026-11-08T00:00:00.000Z",
    });

    await expect(
      harness.service.changePassword({
        userId: USER_1_ID,
        client: createClient(),
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(LockedError);

    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "password.change_failed",
        outcome: "blocked",
        reasonCode: "locked",
        userId: USER_1_ID,
      }),
    );
    expect(harness.authRepository.updatePasswordHash).not.toHaveBeenCalled();
    expect(harness.store.get("auth:local-login-attempts:test-user")).toEqual(
      expect.objectContaining({ lockedAt: "2026-11-08T00:00:00.000Z" }),
    );
  }, 20_000);

  it("clears earlier wrong attempts once the right password changes it", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());
    harness.store.set("auth:local-login-attempts:test-user", {
      failedAttempts: 3,
    });

    await harness.service.changePassword({
      userId: USER_1_ID,
      client: createClient(),
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(harness.store.has("auth:local-login-attempts:test-user")).toBe(
      false,
    );
  }, 20_000);

  it("rejects reusing the current password", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());

    await expect(
      harness.service.changePassword({
        userId: USER_1_ID,
        client: createClient(),
        currentPassword: CURRENT_PASSWORD,
        newPassword: CURRENT_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  }, 20_000);

  it("rejects an account with no local password", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({
        passwordHash: undefined,
        oauthIdentities: [googleIdentity],
      }),
    );

    await expect(
      harness.service.changePassword({
        userId: USER_1_ID,
        client: createClient(),
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("PasswordService.setPassword", () => {
  it("adds a first password to a social-only account", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({
        passwordHash: undefined,
        oauthIdentities: [googleIdentity],
      }),
    );

    const session = await harness.service.setPassword({
      userId: USER_1_ID,
      client: createClient(),
      newPassword: NEW_PASSWORD,
      deviceId: "device-1",
    });

    expect(harness.authRepository.setPasswordHashIfUnset).toHaveBeenCalled();
    expect(harness.authRepository.updatePasswordHash).not.toHaveBeenCalled();
    expect(harness.authRepository.rotateTokenVersion).toHaveBeenCalled();
    expect(session.accessToken).toBe("access-token");
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "password.set",
        method: "password",
        userId: USER_1_ID,
        sessionId: expect.any(String),
      }),
    );
    expect(harness.securityNotificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "password_changed",
        details: { change: "set" },
      }),
    );
  }, 20_000);

  it("loses the race conditionally rather than double-rotating", async () => {
    // The step-up guard is advisory; the conditional write is what decides which
    // of two concurrent submissions wins.
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({
        passwordHash: undefined,
        oauthIdentities: [googleIdentity],
      }),
    );
    harness.authRepository.setPasswordHashIfUnset.mockResolvedValue(false);

    await expect(
      harness.service.setPassword({
        userId: USER_1_ID,
        client: createClient(),
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.authRepository.rotateTokenVersion).not.toHaveBeenCalled();
    expect(harness.authAuditService.recordSafely).not.toHaveBeenCalled();
  }, 20_000);

  it("rejects an account that already has a password", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());

    await expect(
      harness.service.setPassword({
        userId: USER_1_ID,
        client: createClient(),
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow(/already has a password/);
  }, 20_000);

  it("rejects an account with no sign-in method at all", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({ passwordHash: undefined }),
    );

    await expect(
      harness.service.setPassword({
        userId: USER_1_ID,
        client: createClient(),
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("PasswordService rate limiting", () => {
  // The limit has to trip before the user lookup, or the endpoint still costs a
  // query per attempt and can be used to probe which usernames exist.
  it("stops looking up the username once the per-email limit is reached", async () => {
    const harness = createHarness();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expect(
        harness.service.resendForgotPassword({
          client: createClient(),
          username: "target-user",
          deviceId: "device-1",
        }),
      ).resolves.toEqual({ accepted: true });
    }

    expect(harness.authRepository.findUserByUsername).toHaveBeenCalledTimes(5);
  });

  it("stops looking up the username once the per-device limit is reached", async () => {
    const harness = createHarness();

    for (let attempt = 0; attempt < 11; attempt += 1) {
      await harness.service.resendForgotPassword({
        client: createClient(),
        username: `device-user-${attempt}`,
        deviceId: "shared-device",
      });
    }

    expect(harness.authRepository.findUserByUsername).toHaveBeenCalledTimes(10);
  });

  it("stops looking up the username once the per-ip limit is reached", async () => {
    const harness = createHarness();

    for (let attempt = 0; attempt < 21; attempt += 1) {
      await harness.service.resendForgotPassword({
        client: createClient(),
        username: `user-${attempt}`,
        deviceId: `device-${attempt}`,
      });
    }

    expect(harness.authRepository.findUserByUsername).toHaveBeenCalledTimes(20);
  });
});
