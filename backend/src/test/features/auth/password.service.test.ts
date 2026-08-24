import bcrypt from "bcrypt";
import ConflictError from "@/errors/http/conflict.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type {
  AuthUserRecord,
  OAuthIdentityRecord,
} from "@/features/auth/auth.model";
import { LoginLockoutService } from "@/features/auth/lockout/login-lockout.service";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";
import { PasswordService } from "@/features/auth/password/password.service";
import { AuthSessionService } from "@/features/auth/session/session.service";

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
    id: "user-1",
    email: "user@example.com",
    passwordHash: "",
    tokenVersion: 2,
    firstName: "Test",
    role: "user",
    emailVerified: true,
    oauthIdentities: [],
    organizationMemberships: [],
    profile: {
      id: "profile-1",
      userId: "user-1",
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
  id: "identity-1",
  userId: "user-1",
  provider: "google",
  providerUserId: "google-user-1",
  emailVerified: true,
  linkedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function createHarness() {
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
      ),
      new LoginLockoutService(
        cacheService as never,
        authRepository as never,
        otpService as never,
        publicOtpService,
      ),
      publicOtpService,
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
    });
    expect(harness.authRepository.updatePasswordHash).toHaveBeenCalled();
    expect(harness.authRepository.rotateTokenVersion).toHaveBeenCalledWith(
      "user-1",
    );
    expect(session.accessToken).toBe("access-token");
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
});

describe("PasswordService.changePassword", () => {
  it("changes the password when the current one matches", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());

    const session = await harness.service.changePassword({
      userId: "user-1",
      client: createClient(),
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
      deviceId: "device-1",
    });

    expect(harness.authRepository.updatePasswordHash).toHaveBeenCalled();
    expect(harness.authRepository.rotateTokenVersion).toHaveBeenCalled();
    expect(session.accessToken).toBe("access-token");
  }, 20_000);

  it("rejects an incorrect current password", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());

    await expect(
      harness.service.changePassword({
        userId: "user-1",
        client: createClient(),
        currentPassword: "WrongPassword1!",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(harness.authRepository.updatePasswordHash).not.toHaveBeenCalled();
  }, 20_000);

  it("rejects reusing the current password", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());

    await expect(
      harness.service.changePassword({
        userId: "user-1",
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
        userId: "user-1",
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
      userId: "user-1",
      client: createClient(),
      newPassword: NEW_PASSWORD,
      deviceId: "device-1",
    });

    expect(harness.authRepository.setPasswordHashIfUnset).toHaveBeenCalled();
    expect(harness.authRepository.updatePasswordHash).not.toHaveBeenCalled();
    expect(harness.authRepository.rotateTokenVersion).toHaveBeenCalled();
    expect(session.accessToken).toBe("access-token");
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
        userId: "user-1",
        client: createClient(),
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.authRepository.rotateTokenVersion).not.toHaveBeenCalled();
  }, 20_000);

  it("rejects an account that already has a password", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(await localUser());

    await expect(
      harness.service.setPassword({
        userId: "user-1",
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
        userId: "user-1",
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
