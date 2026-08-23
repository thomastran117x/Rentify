import bcrypt from "bcrypt";
import { environment } from "@/configuration/environment";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import TooManyRequestError from "@/errors/http/too-many-request.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { AuthService } from "@/features/auth/auth.service";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { AuthSessionService } from "@/features/auth/session/session.service";
import { PendingSignupStore } from "@/features/auth/pending-signup/pending-signup.store";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";

const FAST_TEST_PASSWORD_HASH =
  "$2b$04$GXVZoFfAkExdnRF7t73lJuSVP2eDEWjoAAxTupSfym6y1po0SJYwe";

function createUser(): AuthUserRecord {
  return {
    id: "user-1",
    email: "user@example.com",
    passwordHash: "",
    tokenVersion: 2,
    firstName: "Test",
    lastName: "User",
    role: "user",
    emailVerified: true,
    oauthIdentities: [],
    organizationMemberships: [],
    profile: {
      id: "profile-1",
      userId: "user-1",
      username: "test-user",
      phoneNumber: undefined,
      avatarUrl: undefined,
      avatarBlobName: undefined,
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
  };
}

function createClient() {
  return {
    ip: "127.0.0.1",
    device: {
      id: "device-1",
      type: "desktop" as const,
      isMobile: false,
    },
  };
}

function createService(overrides?: {
  findUserByEmail?: (email: string) => Promise<AuthUserRecord | null>;
  findUserByUsername?: (username: string) => Promise<AuthUserRecord | null>;
  findUserIdByUsername?: (username: string) => Promise<string | null>;
  findUserById?: (userId: string) => Promise<AuthUserRecord | null>;
  createLocalUser?: (
    input: {
      username: string;
      email: string;
      firstName?: string;
      lastName?: string;
    },
    passwordHash: string,
  ) => Promise<AuthUserRecord>;
  createOAuthUser?: (profile: {
    email: string;
    provider: string;
    providerUserId: string;
    emailVerified: boolean;
    firstName?: string;
    lastName?: string;
  }) => Promise<AuthUserRecord>;
  findUserByOAuthIdentity?: (
    provider: string,
    providerUserId: string,
  ) => Promise<AuthUserRecord | null>;
  linkOAuthIdentity?: (
    userId: string,
    profile: {
      email: string;
      provider: "google" | "microsoft" | "apple";
      providerUserId: string;
      emailVerified: boolean;
      firstName?: string;
      lastName?: string;
    },
  ) => Promise<{
    id: string;
    userId: string;
    provider: "google" | "microsoft" | "apple";
    providerUserId: string;
    providerEmail?: string;
    emailVerified: boolean;
    displayName?: string;
    linkedAt: string;
    createdAt: string;
    updatedAt: string;
  }>;
  listOAuthIdentitiesByUserId?: (
    userId: string,
  ) => Promise<AuthUserRecord["oauthIdentities"]>;
  unlinkOAuthIdentity?: (
    userId: string,
    provider: "google" | "microsoft" | "apple",
  ) => Promise<boolean>;
  markEmailVerified?: (userId: string) => Promise<void>;
  activatePendingLocalUser?: (
    userId: string,
    input: {
      username: string;
      passwordHash: string;
      firstName?: string;
      lastName?: string;
    },
  ) => Promise<AuthUserRecord>;
  updatePasswordHash?: (userId: string, passwordHash: string) => Promise<void>;
  setPasswordHashIfUnset?: (
    userId: string,
    passwordHash: string,
  ) => Promise<boolean>;
  rotateTokenVersion?: (userId: string) => Promise<number>;
  verifyRefreshToken?: (token: string) => Promise<{
    sub: string;
    deviceId?: string;
    rememberMe?: boolean;
    sessionId?: string;
  }>;
  createRefreshToken?: (
    payload: Record<string, unknown>,
    options?: { expiresInSeconds?: number },
  ) => Promise<string>;
  rotateRefreshToken?: (
    token: string,
    payload: Record<string, unknown>,
    options?: { expiresInSeconds?: number },
  ) => Promise<string>;
  createSession?: (
    state: {
      sessionId: string;
      userId: string;
      deviceId?: string;
      tokenVersion: number;
    },
    ttlInSeconds: number,
  ) => Promise<void>;
  revokeSession?: (sessionId?: string) => Promise<boolean>;
  revokeSessionsForDevice?: (
    userId: string,
    deviceId: string,
  ) => Promise<number>;
  getRefreshTokenExpiresInSeconds?: (rememberMe?: boolean) => number;
  revokeRefreshToken?: (token: string) => Promise<boolean>;
  evaluateSuccessfulAuthentication?: () => Promise<{
    deviceId?: string;
    known: boolean;
    knownByIp: boolean;
  }>;
  evaluateExistingSessionDevice?: () => Promise<{
    deviceId?: string;
    known: boolean;
    knownByIp: boolean;
  }>;
  listKnownDevices?: (
    userId: string,
    currentDeviceId?: string,
  ) => Promise<
    Array<{
      id: string;
      current: boolean;
      deviceId: string;
      type: string;
      platform?: string;
      userAgent?: string;
      lastIpAddress?: string;
      firstSeenAt: string;
      lastSeenAt: string;
      verifiedAt: string;
    }>
  >;
  removeKnownDevice?: (userId: string, deviceId: string) => Promise<void>;
  registerKnownDevice?: (
    user: AuthUserRecord,
    client: ReturnType<typeof createClient>,
    deviceId?: string,
  ) => Promise<{ deviceId?: string; known: boolean; knownByIp: boolean }>;
  issueOtp?: (input: {
    purpose: string;
    subject: string;
  }) => Promise<{ code: string }>;
  verifyOtp?: (input: {
    purpose: string;
    subject: string;
    code: string;
  }) => Promise<void>;
  otpTtlInSeconds?: number;
  sendVerificationEmail?: (input: {
    to: string;
    verificationCode: string;
    firstName?: string;
  }) => Promise<void>;
  sendPasswordResetEmail?: (input: {
    to: string;
    resetCode: string;
    firstName?: string;
  }) => Promise<void>;
  sendLoginUnlockEmail?: (input: {
    to: string;
    unlockCode: string;
    firstName?: string;
  }) => Promise<void>;
  sendUsernameReminderEmail?: (input: {
    to: string;
    username: string;
    firstName?: string;
  }) => Promise<void>;
  verifyGoogle?: (input: unknown) => Promise<{
    email: string;
    provider: string;
    providerUserId: string;
    emailVerified: boolean;
    firstName?: string;
    lastName?: string;
  }>;
  mfaIsEnabled?: (userId: string) => Promise<boolean>;
  verifyTotpCode?: (userId: string, code: string) => Promise<void>;
  cacheGetJson?: (key: string) => Promise<unknown | null>;
  cacheDelete?: (key: string) => Promise<boolean>;
  cacheSetJson?: (
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ) => Promise<void>;
  acquireLock?: (
    key: string,
    ttlInMs: number,
  ) => Promise<{ release: () => Promise<boolean> } | null>;
  usernameBloomCheck?: (
    username: string,
  ) => "definitely-absent" | "possibly-present" | "unknown";
  usernameBloomAdd?: (usernames: string | string[]) => Promise<void>;
}) {
  const cacheJsonStore = new Map<
    string,
    { value: unknown; ttlSeconds?: number }
  >();
  const findUserByUsername =
    overrides?.findUserByUsername ?? (async () => null);
  const authRepository = {
    findUserByEmail: overrides?.findUserByEmail ?? (async () => null),
    findUserByUsername,
    // Availability checks use this cheaper probe. Derived from
    // findUserByUsername so a test that stubs only the latter still describes a
    // taken username.
    findUserIdByUsername:
      overrides?.findUserIdByUsername ??
      (async (username: string) =>
        (await findUserByUsername(username))?.id ?? null),
    findUserById: overrides?.findUserById ?? (async () => null),
    findUserByOAuthIdentity:
      overrides?.findUserByOAuthIdentity ?? (async () => null),
    createLocalUser:
      overrides?.createLocalUser ??
      (async (input) => ({
        ...createUser(),
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        profile: {
          ...createUser().profile,
          username: input.username,
        },
      })),
    createOAuthUser:
      overrides?.createOAuthUser ??
      (async (profile) => ({
        ...createUser(),
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        passwordHash: undefined,
        emailVerified: profile.emailVerified,
        oauthIdentities: [
          {
            id: "oauth-identity-1",
            userId: "user-1",
            provider: profile.provider as "google" | "microsoft" | "apple",
            providerUserId: profile.providerUserId,
            providerEmail: profile.email,
            emailVerified: profile.emailVerified,
            linkedAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      })),
    linkOAuthIdentity:
      overrides?.linkOAuthIdentity ??
      (async (userId, profile) => ({
        id: "oauth-identity-1",
        userId,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        providerEmail: profile.email,
        emailVerified: profile.emailVerified,
        linkedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
    listOAuthIdentitiesByUserId:
      overrides?.listOAuthIdentitiesByUserId ?? (async () => []),
    unlinkOAuthIdentity: overrides?.unlinkOAuthIdentity ?? (async () => true),
    markEmailVerified: overrides?.markEmailVerified ?? (async () => {}),
    activatePendingLocalUser:
      overrides?.activatePendingLocalUser ??
      (async (userId, input) => ({
        ...createUser(),
        id: userId,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        emailVerified: true,
        profile: {
          ...createUser().profile,
          username: input.username,
        },
      })),
    updatePasswordHash: overrides?.updatePasswordHash ?? (async () => {}),
    setPasswordHashIfUnset:
      overrides?.setPasswordHashIfUnset ?? (async () => true),
    rotateTokenVersion: overrides?.rotateTokenVersion ?? (async () => 3),
  };
  const tokenService = {
    createAccessToken: () => "access-token",
    createRefreshToken:
      overrides?.createRefreshToken ?? (async () => "refresh-token"),
    rotateRefreshToken:
      overrides?.rotateRefreshToken ?? (async () => "rotated-refresh-token"),
    createSession: overrides?.createSession ?? (async () => {}),
    revokeSession: overrides?.revokeSession ?? (async () => true),
    revokeSessionsForDevice:
      overrides?.revokeSessionsForDevice ?? (async () => 0),
    getRefreshTokenExpiresInSeconds:
      overrides?.getRefreshTokenExpiresInSeconds ??
      ((rememberMe = false) => (rememberMe ? 777 : 333)),
    verifyRefreshToken:
      overrides?.verifyRefreshToken ??
      (async () => ({
        sub: "user-1",
        deviceId: "device-1",
        rememberMe: false,
        sessionId: "session-1",
      })),
    revokeRefreshToken: overrides?.revokeRefreshToken ?? (async () => true),
  };
  const otpService = {
    issue:
      overrides?.issueOtp ??
      (async () => ({
        code: "123456",
      })),
    verify: overrides?.verifyOtp ?? (async () => {}),
    getTtlInSeconds: () => overrides?.otpTtlInSeconds ?? 600,
  };
  const deviceService = {
    evaluateSuccessfulAuthentication:
      overrides?.evaluateSuccessfulAuthentication ??
      (async () => ({
        deviceId: "device-1",
        known: true,
        knownByIp: true,
      })),
    evaluateExistingSessionDevice:
      overrides?.evaluateExistingSessionDevice ??
      (async () => ({
        deviceId: "device-1",
        known: true,
        knownByIp: true,
      })),
    registerKnownDevice:
      overrides?.registerKnownDevice ??
      (async () => ({
        deviceId: "device-1",
        known: true,
        knownByIp: true,
      })),
    listKnownDevices:
      overrides?.listKnownDevices ??
      (async () => [
        {
          id: "known-device-1",
          current: true,
          deviceId: "device-1",
          type: "desktop",
          platform: "macOS",
          userAgent: "test-agent",
          lastIpAddress: "127.0.0.1",
          firstSeenAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-02T00:00:00.000Z",
          verifiedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    removeKnownDevice: overrides?.removeKnownDevice ?? (async () => {}),
  };
  const emailService = {
    sendVerificationEmail: overrides?.sendVerificationEmail ?? (async () => {}),
    sendPasswordResetEmail:
      overrides?.sendPasswordResetEmail ?? (async () => {}),
    sendLoginUnlockEmail: overrides?.sendLoginUnlockEmail ?? (async () => {}),
    sendUsernameReminderEmail:
      overrides?.sendUsernameReminderEmail ?? (async () => {}),
  };
  const googleOAuthService = {
    verify:
      overrides?.verifyGoogle ??
      (async () => ({
        email: "oauth@example.com",
        provider: "google",
        providerUserId: "google-user-1",
        emailVerified: true,
      })),
  };
  const microsoftOAuthService = {};
  const appleOAuthService = {};
  const mfaTotpService = {
    isEnabled: overrides?.mfaIsEnabled ?? (async () => false),
    verifyCode: overrides?.verifyTotpCode ?? (async () => {}),
  };
  const cacheService = {
    getJson: jest.fn(async <TValue>(key: string) => {
      if (overrides?.cacheGetJson) {
        return (await overrides.cacheGetJson(key)) as TValue | null;
      }

      return (cacheJsonStore.get(key)?.value as TValue | undefined) ?? null;
    }),
    delete: jest.fn(async (key: string) => {
      if (overrides?.cacheDelete) {
        return overrides.cacheDelete(key);
      }

      return cacheJsonStore.delete(key);
    }),
    setJson: jest.fn(
      async (key: string, value: unknown, ttlSeconds?: number) => {
        if (overrides?.cacheSetJson) {
          await overrides.cacheSetJson(key, value, ttlSeconds);
          return;
        }

        cacheJsonStore.set(key, {
          value,
          ttlSeconds,
        });
      },
    ),
    acquireLock: jest.fn(async (key: string, ttlInMs: number) => {
      if (overrides?.acquireLock) {
        return overrides.acquireLock(key, ttlInMs);
      }

      return {
        release: async () => true,
      };
    }),
  };

  // Defaults to "unknown" so every existing expectation still exercises the
  // authoritative database path; tests that care about the filter opt in.
  const usernameBloomService = {
    check: jest.fn((username: string) =>
      overrides?.usernameBloomCheck
        ? overrides.usernameBloomCheck(username)
        : ("unknown" as const),
    ),
    add: jest.fn(async (usernames: string | string[]) => {
      await overrides?.usernameBloomAdd?.(usernames);
    }),
  };

  // The extracted collaborators are wired as real instances over the same leaf
  // fakes, so assertions keep targeting the fakes (cacheService.setJson,
  // emailService.send*, tokenService.create*) rather than a mock of the
  // collaborator.
  const authSessionService = new AuthSessionService(
    tokenService as any,
    deviceService as any,
  );
  const pendingSignupStore = new PendingSignupStore(
    cacheService as any,
    usernameBloomService as any,
  );
  const publicOtpService = new PublicOtpService(
    cacheService as any,
    otpService as any,
    emailService as any,
  );

  const service = new AuthService(
    authRepository as any,
    tokenService as any,
    otpService as any,
    deviceService as any,
    emailService as any,
    googleOAuthService as any,
    microsoftOAuthService as any,
    appleOAuthService as any,
    cacheService as any,
    mfaTotpService as any,
    usernameBloomService as any,
    authSessionService,
    pendingSignupStore,
    publicOtpService,
  );

  return service;
}

describe("AuthService", () => {
  it("returns a pending verification response when signup email already exists but is unverified", async () => {
    const existingUser = {
      ...createUser(),
      email: "pending@example.com",
      emailVerified: false,
    };
    const hashSpy = jest
      .spyOn(bcrypt, "hash")
      .mockResolvedValue(FAST_TEST_PASSWORD_HASH);
    const service = createService({
      findUserByEmail: async () => existingUser,
    });

    try {
      const result = await service.localSignup({
        client: createClient(),
        username: "pending-user",
        email: existingUser.email,
        password: "CorrectHorseBatteryStaple1!",
        firstName: "Pending",
        lastName: "User",
        deviceId: "device-1",
      });

      expect(result).toEqual({
        verificationRequired: true,
        email: existingUser.email,
        alreadyPending: false,
      });
    } finally {
      hashSpy.mockRestore();
    }
  });

  it("returns a generic pending verification response when a verified account already exists for the email", async () => {
    const service = createService({
      findUserByEmail: async () => createUser(),
    });

    await expect(
      service.localSignup({
        client: createClient(),
        username: "available-user",
        email: "user@example.com",
        password: "CorrectHorseBatteryStaple1!",
        firstName: "Test",
        lastName: "User",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({
      verificationRequired: true,
      email: "user@example.com",
      alreadyPending: false,
    });
  });

  it("accepts forgot password requests without sending email for unknown accounts", async () => {
    let resetEmailSent = false;
    const service = createService({
      findUserByUsername: async () => null,
      sendPasswordResetEmail: async () => {
        resetEmailSent = true;
      },
    });

    await expect(
      service.forgotPassword({
        client: createClient(),
        username: "missing-user",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({
      accepted: true,
    });

    expect(resetEmailSent).toBe(false);
  });

  it("accepts forgot password requests without revealing OAuth-only accounts", async () => {
    let resetEmailSent = false;
    const service = createService({
      findUserByUsername: async () => ({
        ...createUser(),
        passwordHash: undefined,
        oauthIdentities: [
          {
            id: "oauth-identity-1",
            userId: "user-1",
            provider: "google",
            providerUserId: "provider-user-1",
            providerEmail: "oauth@example.com",
            emailVerified: true,
            linkedAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      sendPasswordResetEmail: async () => {
        resetEmailSent = true;
      },
    });

    await expect(
      service.forgotPassword({
        client: createClient(),
        username: "oauth-user",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({
      accepted: true,
    });

    expect(resetEmailSent).toBe(false);
  });

  it("sends a username reminder to the email on file", async () => {
    let reminder: { to: string; username: string } | undefined;
    const service = createService({
      findUserByEmail: async () => ({
        ...createUser(),
        email: "owner@example.com",
        profile: {
          ...createUser().profile,
          username: "owner-one",
        },
      }),
      sendUsernameReminderEmail: async (input) => {
        reminder = { to: input.to, username: input.username };
      },
    });

    await expect(
      service.forgotUsername({
        client: createClient(),
        email: "owner@example.com",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({ accepted: true });

    expect(reminder).toEqual({
      to: "owner@example.com",
      username: "owner-one",
    });
  });

  it("reminds OAuth-only accounts of their auto-generated username", async () => {
    let reminder: { username: string } | undefined;
    const service = createService({
      findUserByEmail: async () => ({
        ...createUser(),
        email: "social@example.com",
        passwordHash: undefined,
        profile: {
          ...createUser().profile,
          username: "social",
        },
        oauthIdentities: [
          {
            id: "oauth-identity-1",
            userId: "user-1",
            provider: "google",
            providerUserId: "provider-user-1",
            providerEmail: "social@example.com",
            emailVerified: true,
            linkedAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      sendUsernameReminderEmail: async (input) => {
        reminder = { username: input.username };
      },
    });

    await expect(
      service.forgotUsername({
        client: createClient(),
        email: "social@example.com",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({ accepted: true });

    expect(reminder).toEqual({ username: "social" });
  });

  it("accepts username reminder requests without sending email for unknown accounts", async () => {
    let reminderSent = false;
    const service = createService({
      findUserByEmail: async () => null,
      sendUsernameReminderEmail: async () => {
        reminderSent = true;
      },
    });

    await expect(
      service.forgotUsername({
        client: createClient(),
        email: "missing@example.com",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({ accepted: true });

    expect(reminderSent).toBe(false);
  });

  it("does not send a username reminder when the request is rate limited", async () => {
    let reminderSent = false;
    const service = createService({
      cacheGetJson: async (key: string) =>
        key.includes("username-reminder") ? { count: 999 } : null,
      findUserByEmail: async () => {
        throw new Error("Lookup should not run when rate limited.");
      },
      sendUsernameReminderEmail: async () => {
        reminderSent = true;
      },
    });

    await expect(
      service.forgotUsername({
        client: createClient(),
        email: "owner@example.com",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({ accepted: true });

    expect(reminderSent).toBe(false);
  });

  it("accepts unknown verification resend requests without sending email", async () => {
    let verificationEmailSent = false;
    const service = createService({
      findUserByEmail: async () => null,
      sendVerificationEmail: async () => {
        verificationEmailSent = true;
      },
    });

    await expect(
      service.resendVerificationEmail({
        client: createClient(),
        email: "missing@example.com",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({
      accepted: true,
    });

    expect(verificationEmailSent).toBe(false);
  });

  it("accepts verification resend cooldowns without exposing account state", async () => {
    let verificationEmailSent = false;
    const service = createService({
      findUserByEmail: async () => ({
        ...createUser(),
        emailVerified: false,
      }),
      issueOtp: async () => {
        throw new TooManyRequestError(
          "A verification code was sent recently.",
          {
            retryAfterSeconds: 60,
          },
        );
      },
      sendVerificationEmail: async () => {
        verificationEmailSent = true;
      },
    });

    await expect(
      service.resendVerificationEmail({
        client: createClient(),
        email: "user@example.com",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({
      accepted: true,
    });

    expect(verificationEmailSent).toBe(false);
  });

  it("resends verification email for cached pending signup state without a real user", async () => {
    let verificationEmailSentTo: string | undefined;
    const service = createService({
      findUserByEmail: async () => null,
      cacheGetJson: async () => ({
        email: "pending@example.com",
        passwordHash: "hashed-password",
        firstName: "Pending",
        lastName: "User",
        deviceId: "device-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      sendVerificationEmail: async (input) => {
        verificationEmailSentTo = input.to;
      },
    });

    await expect(
      service.resendVerificationEmail({
        client: createClient(),
        email: "pending@example.com",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({
      accepted: true,
    });

    expect(verificationEmailSentTo).toBe("pending@example.com");
  });

  it("rate-limits public OTP requests by username before user lookup", async () => {
    let lookupCount = 0;
    const service = createService({
      findUserByUsername: async () => {
        lookupCount += 1;
        return null;
      },
    });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expect(
        service.resendForgotPassword({
          client: createClient(),
          username: "target-user",
          deviceId: "device-1",
        }),
      ).resolves.toEqual({
        accepted: true,
      });
    }

    expect(lookupCount).toBe(5);
  });

  it("rate-limits public OTP requests by IP and device before user lookup", async () => {
    let lookupCount = 0;
    const service = createService({
      findUserByUsername: async () => {
        lookupCount += 1;
        return null;
      },
    });

    for (let attempt = 0; attempt < 11; attempt += 1) {
      await service.resendForgotPassword({
        client: createClient(),
        username: `device-user-${attempt}`,
        deviceId: "shared-device",
      });
    }

    expect(lookupCount).toBe(10);

    for (let attempt = 0; attempt < 11; attempt += 1) {
      await service.resendForgotPassword({
        client: createClient(),
        username: `user-${attempt}`,
        deviceId: `device-${attempt}`,
      });
    }

    expect(lookupCount).toBe(20);
  });

  it("rejects refresh when no refresh token is provided", async () => {
    const service = createService();

    await expect(
      service.refresh({
        client: createClient(),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("issues a long-lived refresh token when remember me is enabled", async () => {
    const user = createUser();
    user.passwordHash = await bcrypt.hash("CorrectHorseBatteryStaple1!", 4);

    let issuedRememberMe: boolean | undefined;
    let issuedRefreshOptions: { expiresInSeconds?: number } | undefined;
    const service = createService({
      findUserByUsername: async () => user,
      createRefreshToken: async (payload, options) => {
        issuedRememberMe = (payload as { rememberMe?: boolean }).rememberMe;
        issuedRefreshOptions = options;
        return "refresh-token-remembered";
      },
      getRefreshTokenExpiresInSeconds: (rememberMe = false) =>
        rememberMe ? 2_592_000 : 86_400,
    });

    const session = await service.localAuthenticate({
      client: createClient(),
      username: user.profile.username,
      password: "CorrectHorseBatteryStaple1!",
      rememberMe: true,
      deviceId: "device-1",
    });

    expect(session.refreshToken).toBe("refresh-token-remembered");
    expect(session.refreshTokenExpiresInSeconds).toBe(2_592_000);
    expect(issuedRememberMe).toBe(true);
    expect(issuedRefreshOptions?.expiresInSeconds).toBe(2_592_000);
  });

  it("preserves remember me when rotating refresh tokens", async () => {
    const user = createUser();
    let issuedRememberMe: boolean | undefined;
    let issuedRefreshOptions: { expiresInSeconds?: number } | undefined;
    let rotatedRefreshToken: string | undefined;
    const service = createService({
      findUserById: async () => user,
      verifyRefreshToken: async () => ({
        sub: user.id,
        deviceId: "device-1",
        rememberMe: true,
        sessionId: "session-1",
      }),
      rotateRefreshToken: async (token, payload, options) => {
        rotatedRefreshToken = token;
        issuedRememberMe = (payload as { rememberMe?: boolean }).rememberMe;
        issuedRefreshOptions = options;
        return "rotated-refresh-token";
      },
      getRefreshTokenExpiresInSeconds: (rememberMe = false) =>
        rememberMe ? 2_592_000 : 86_400,
    });

    const session = await service.refresh({
      client: createClient(),
      refreshToken: "incoming-refresh-token",
    });

    expect(session.refreshToken).toBe("rotated-refresh-token");
    expect(session.refreshTokenExpiresInSeconds).toBe(2_592_000);
    expect(issuedRememberMe).toBe(true);
    expect(issuedRefreshOptions?.expiresInSeconds).toBe(2_592_000);
    expect(rotatedRefreshToken).toBe("incoming-refresh-token");
  });

  it("rejects change password when the current password is incorrect", async () => {
    const user = createUser();
    user.passwordHash = await bcrypt.hash("CorrectHorseBatteryStaple1!", 4);
    const service = createService({
      findUserById: async () => user,
    });

    await expect(
      service.changePassword({
        client: createClient(),
        userId: user.id,
        currentPassword: "WrongPassword1!",
        newPassword: "AnotherStrongPassword1!",
        deviceId: "device-1",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects password reset for social login accounts", async () => {
    const oauthUser = {
      ...createUser(),
      passwordHash: undefined,
      oauthIdentities: [
        {
          id: "oauth-identity-1",
          userId: "user-1",
          provider: "google" as const,
          providerUserId: "provider-user-1",
          providerEmail: "oauth@example.com",
          emailVerified: true,
          linkedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const service = createService({
      findUserByUsername: async () => oauthUser,
    });

    await expect(
      service.resetPassword({
        client: createClient(),
        username: oauthUser.profile.username,
        code: "123456",
        newPassword: "AnotherStrongPassword1!",
        deviceId: "device-1",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("returns verified auth details for localVerify", async () => {
    const service = createService();

    await expect(
      service.localVerify({
        client: createClient(),
        auth: {
          authMethod: "jwt",
          sub: "user-1",
          role: "owner",
          deviceId: "device-99",
          iat: 1,
          exp: 999999,
        },
      }),
    ).resolves.toEqual({
      verified: true,
      auth: {
        userId: "user-1",
        deviceId: "device-99",
        role: "owner",
      },
      client: createClient(),
    });
  });

  it("logs out by revoking the refresh token and current session", async () => {
    let revokedToken: string | undefined;
    let revokedSessionId: string | undefined;
    const service = createService({
      revokeRefreshToken: async (token) => {
        revokedToken = token;
        return true;
      },
      revokeSession: async (sessionId) => {
        revokedSessionId = sessionId;
        return true;
      },
    });

    await expect(
      service.logout({
        client: createClient(),
        auth: {
          authMethod: "jwt",
          sub: "user-1",
          deviceId: "device-1",
          sessionId: "session-1",
          iat: 1,
          exp: 999999,
        },
        refreshToken: "refresh-token-1",
      }),
    ).resolves.toEqual({
      loggedOut: true,
      auth: {
        userId: "user-1",
        deviceId: "device-1",
      },
      client: createClient(),
    });

    expect(revokedToken).toBe("refresh-token-1");
    expect(revokedSessionId).toBe("session-1");
  });

  it("lists known devices for the authenticated user", async () => {
    const service = createService();

    await expect(
      service.devices({
        client: createClient(),
        auth: {
          authMethod: "jwt",
          sub: "user-1",
          deviceId: "device-1",
          iat: 1,
          exp: 999999,
        },
      }),
    ).resolves.toEqual({
      devices: [
        {
          id: "known-device-1",
          current: true,
          deviceId: "device-1",
          type: "desktop",
          platform: "macOS",
          userAgent: "test-agent",
          lastIpAddress: "127.0.0.1",
          firstSeenAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-02T00:00:00.000Z",
          verifiedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("removes a known device and revokes its active sessions", async () => {
    let removed: { userId: string; deviceId: string } | null = null;
    let revokedSessions: { userId: string; deviceId: string } | null = null;
    const service = createService({
      removeKnownDevice: async (userId, deviceId) => {
        removed = { userId, deviceId };
      },
      revokeSessionsForDevice: async (userId, deviceId) => {
        revokedSessions = { userId, deviceId };
        return 1;
      },
    });

    await expect(
      service.removeKnownDevice({
        userId: "user-1",
        deviceId: "device-2",
      }),
    ).resolves.toEqual({
      removed: true,
      deviceId: "device-2",
    });

    expect(removed).toEqual({
      userId: "user-1",
      deviceId: "device-2",
    });
    expect(revokedSessions).toEqual({
      userId: "user-1",
      deviceId: "device-2",
    });
  });

  it("stores pending signup state in cache and sends verification during signup", async () => {
    let createLocalUserCalled = false;
    let verificationEmailSentTo: string | undefined;
    const cacheWrites: Array<{
      key: string;
      value: unknown;
      ttlSeconds?: number;
    }> = [];
    const hashSpy = jest
      .spyOn(bcrypt, "hash")
      .mockResolvedValue(FAST_TEST_PASSWORD_HASH);
    const service = createService({
      findUserByEmail: async () => null,
      createLocalUser: async () => {
        createLocalUserCalled = true;
        return createUser();
      },
      otpTtlInSeconds: 600,
      cacheSetJson: async (key, value, ttlSeconds) => {
        cacheWrites.push({ key, value, ttlSeconds });
      },
      sendVerificationEmail: async (input) => {
        verificationEmailSentTo = input.to;
      },
    });

    try {
      const result = await service.localSignup({
        client: createClient(),
        username: "new-user",
        email: "new-user@example.com",
        password: "CorrectHorseBatteryStaple1!",
        firstName: "New",
        lastName: "User",
        deviceId: "device-1",
      });

      expect(createLocalUserCalled).toBe(false);
      expect(cacheWrites).toHaveLength(2);
      expect(cacheWrites[0]).toMatchObject({
        key: "auth:pending-signup:new-user@example.com",
        ttlSeconds: 600,
        value: {
          username: "new-user",
          email: "new-user@example.com",
          firstName: "New",
          lastName: "User",
          deviceId: "device-1",
          createdAt: expect.any(String),
        },
      });
      await expect(
        bcrypt.compare(
          "CorrectHorseBatteryStaple1!",
          (cacheWrites[0]?.value as { passwordHash?: string }).passwordHash ??
            "",
        ),
      ).resolves.toBe(true);
      expect(cacheWrites[1]).toEqual({
        key: "auth:pending-signup-username:new-user",
        value: "new-user@example.com",
        ttlSeconds: 600,
      });
      expect(verificationEmailSentTo).toBe("new-user@example.com");
      expect(result).toEqual({
        verificationRequired: true,
        email: "new-user@example.com",
        alreadyPending: false,
      });
    } finally {
      hashSpy.mockRestore();
    }
  });

  it("creates a new OAuth user when the provider account is verified and not yet linked", async () => {
    const createdUser = {
      ...createUser(),
      email: "oauth-created@example.com",
      firstName: "OAuth",
      lastName: "User",
    };
    let createdOAuthEmail: string | undefined;
    const service = createService({
      findUserByEmail: async () => null,
      createOAuthUser: async (profile) => {
        createdOAuthEmail = profile.email;
        return createdUser;
      },
      verifyGoogle: async () => ({
        email: createdUser.email,
        provider: "google",
        providerUserId: "google-user-1",
        emailVerified: true,
        firstName: "OAuth",
        lastName: "User",
      }),
    });

    const result = await service.googleAuthenticate({
      client: createClient(),
      nonce: "nonce-1",
      code: "code-1",
      codeVerifier: "verifier-1",
      deviceId: "device-1",
    });

    expect(createdOAuthEmail).toBe(createdUser.email);
    expect(result.accessToken).toBe("access-token");
    expect(result.user.email).toBe(createdUser.email);
    expect(result.isNewUser).toBe(true);
  });

  it("rejects OAuth authentication when the email belongs to an unlinked account", async () => {
    const existingUser = {
      ...createUser(),
      email: "oauth@example.com",
      passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple1!", 4),
    };
    const service = createService({
      findUserByEmail: async () => existingUser,
      verifyGoogle: async () => ({
        email: existingUser.email,
        provider: "google",
        providerUserId: "google-user-1",
        emailVerified: true,
      }),
    });

    await expect(
      service.googleAuthenticate({
        client: createClient(),
        nonce: "nonce-1",
        code: "code-1",
        codeVerifier: "verifier-1",
        deviceId: "device-1",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("authenticates OAuth users by linked provider subject before checking email matches", async () => {
    const linkedUser = {
      ...createUser(),
      email: "renamed@example.com",
      passwordHash: undefined,
      oauthIdentities: [
        {
          id: "oauth-identity-1",
          userId: "user-1",
          provider: "google" as const,
          providerUserId: "google-user-1",
          providerEmail: "old-email@example.com",
          emailVerified: true,
          linkedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const service = createService({
      findUserByOAuthIdentity: async () => linkedUser,
      findUserByEmail: async () => {
        throw new Error(
          "Email lookup should not be needed for linked providers.",
        );
      },
      verifyGoogle: async () => ({
        email: "provider-email@example.com",
        provider: "google",
        providerUserId: "google-user-1",
        emailVerified: true,
      }),
    });

    const result = await service.googleAuthenticate({
      client: createClient(),
      nonce: "nonce-1",
      code: "code-1",
      codeVerifier: "verifier-1",
      deviceId: "device-1",
    });

    expect(result.user.email).toBe("renamed@example.com");
    expect(result.isNewUser).toBeUndefined();
  });

  it("links a Google provider to an authenticated local account", async () => {
    const localUser = {
      ...createUser(),
      passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple1!", 4),
    };
    let linkedUserId: string | undefined;
    const linkedIdentity = {
      id: "oauth-identity-1",
      userId: localUser.id,
      provider: "google" as const,
      providerUserId: "google-user-1",
      providerEmail: "user@example.com",
      emailVerified: true,
      linkedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const service = createService({
      findUserById: async () => localUser,
      findUserByOAuthIdentity: async () => null,
      linkOAuthIdentity: async (userId) => {
        linkedUserId = userId;
        return linkedIdentity;
      },
      listOAuthIdentitiesByUserId: async () => [linkedIdentity],
      verifyGoogle: async () => ({
        email: "user@example.com",
        provider: "google",
        providerUserId: "google-user-1",
        emailVerified: true,
      }),
    });

    await expect(
      service.linkOAuthProvider({
        client: createClient(),
        userId: localUser.id,
        provider: "google",
        nonce: "nonce-1",
        code: "code-1",
        codeVerifier: "verifier-1",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({
      hasPassword: true,
      providers: [
        {
          id: "oauth-identity-1",
          provider: "google",
          providerEmail: "user@example.com",
          emailVerified: true,
          linkedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(linkedUserId).toBe(localUser.id);
  });

  it("rejects linking when the provider subject belongs to another user", async () => {
    const localUser = {
      ...createUser(),
      id: "user-1",
      passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple1!", 4),
    };
    const otherUser = {
      ...createUser(),
      id: "user-2",
      email: "other@example.com",
    };
    const service = createService({
      findUserById: async () => localUser,
      findUserByOAuthIdentity: async () => otherUser,
      verifyGoogle: async () => ({
        email: "user@example.com",
        provider: "google",
        providerUserId: "google-user-1",
        emailVerified: true,
      }),
    });

    await expect(
      service.linkOAuthProvider({
        client: createClient(),
        userId: localUser.id,
        provider: "google",
        nonce: "nonce-1",
        code: "code-1",
        codeVerifier: "verifier-1",
        deviceId: "device-1",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks unlinking the last usable sign-in method", async () => {
    const oauthOnlyUser = {
      ...createUser(),
      passwordHash: undefined,
      oauthIdentities: [
        {
          id: "oauth-identity-1",
          userId: "user-1",
          provider: "google" as const,
          providerUserId: "google-user-1",
          providerEmail: "user@example.com",
          emailVerified: true,
          linkedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const service = createService({
      findUserById: async () => oauthOnlyUser,
    });

    await expect(
      service.unlinkOAuthProvider({
        userId: oauthOnlyUser.id,
        provider: "google",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("unlinks a provider when a local password remains available", async () => {
    const mixedUser = {
      ...createUser(),
      passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple1!", 4),
      oauthIdentities: [
        {
          id: "oauth-identity-1",
          userId: "user-1",
          provider: "google" as const,
          providerUserId: "google-user-1",
          providerEmail: "user@example.com",
          emailVerified: true,
          linkedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    let unlinkedProvider: string | undefined;
    const service = createService({
      findUserById: async () => mixedUser,
      unlinkOAuthIdentity: async (_userId, provider) => {
        unlinkedProvider = provider;
        return true;
      },
      listOAuthIdentitiesByUserId: async () => [],
    });

    await expect(
      service.unlinkOAuthProvider({
        userId: mixedUser.id,
        provider: "google",
      }),
    ).resolves.toEqual({
      hasPassword: true,
      providers: [],
    });
    expect(unlinkedProvider).toBe("google");
  });

  it("rejects OAuth authentication when the provider email is not verified", async () => {
    const service = createService({
      verifyGoogle: async () => ({
        email: "oauth@example.com",
        provider: "google",
        providerUserId: "google-user-1",
        emailVerified: false,
      }),
    });

    await expect(
      service.googleAuthenticate({
        client: createClient(),
        nonce: "nonce-1",
        code: "code-1",
        codeVerifier: "verifier-1",
        deviceId: "device-1",
      }),
    ).rejects.toThrow("OAuth account email must be verified.");
  });

  it("accepts resend verification email without revealing that the user is already verified", async () => {
    const service = createService({
      findUserByEmail: async () => createUser(),
    });

    await expect(
      service.resendVerificationEmail({
        client: createClient(),
        email: "user@example.com",
        deviceId: "device-1",
      }),
    ).resolves.toEqual({
      accepted: true,
    });
  });

  it("creates a real user from pending signup state during email verification", async () => {
    const pendingPasswordHash = await bcrypt.hash(
      "CorrectHorseBatteryStaple1!",
      4,
    );
    const createdUser = {
      ...createUser(),
      email: "pending@example.com",
      firstName: "Pending",
      lastName: "User",
      emailVerified: false,
    };
    let createdInput: {
      username: string;
      email: string;
      firstName?: string;
      lastName?: string;
      passwordHash: string;
    } | null = null;
    let markedVerifiedUserId: string | undefined;
    let deletedPendingKey: string | undefined;
    const service = createService({
      findUserByEmail: async () => null,
      cacheGetJson: async (key) => {
        if (key === "auth:pending-signup-username:pending-user") {
          return "pending@example.com";
        }

        return {
          username: "pending-user",
          email: "pending@example.com",
          passwordHash: pendingPasswordHash,
          firstName: "Pending",
          lastName: "User",
          deviceId: "device-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        };
      },
      createLocalUser: async (input, passwordHash) => {
        createdInput = {
          ...input,
          passwordHash,
        };
        return createdUser;
      },
      markEmailVerified: async (userId) => {
        markedVerifiedUserId = userId;
      },
      cacheDelete: async (key) => {
        deletedPendingKey = key;
        return true;
      },
    });

    await expect(
      service.verifyEmail({
        client: createClient(),
        email: "pending@example.com",
        code: "123456",
        deviceId: "device-1",
      }),
    ).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {
        email: "pending@example.com",
        emailVerified: true,
      },
    });

    expect(createdInput).toEqual({
      username: "pending-user",
      email: "pending@example.com",
      firstName: "Pending",
      lastName: "User",
      passwordHash: pendingPasswordHash,
    });
    expect(markedVerifiedUserId).toBe("user-1");
    expect(deletedPendingKey).toBe("auth:pending-signup:pending@example.com");
  });

  it("rejects verifyEmail when pending signup state is missing", async () => {
    const service = createService({
      cacheGetJson: async () => null,
    });

    await expect(
      service.verifyEmail({
        client: createClient(),
        email: "missing@example.com",
        code: "123456",
        deviceId: "device-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects verifyEmail when the pending-signup verification lock cannot be acquired", async () => {
    const service = createService({
      acquireLock: async () => null,
    });

    await expect(
      service.verifyEmail({
        client: createClient(),
        email: "locked@example.com",
        code: "123456",
        deviceId: "device-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects invalid username sign-in attempts and records the normalized username lock key", async () => {
    const cacheWrites: Array<{
      key: string;
      value: unknown;
      ttlSeconds?: number;
    }> = [];
    const service = createService({
      cacheGetJson: async () => null,
      cacheSetJson: async (key, value, ttlSeconds) => {
        cacheWrites.push({
          key,
          value,
          ttlSeconds,
        });
      },
    });

    await expect(
      service.localAuthenticate({
        client: createClient(),
        username: "Missing-User",
        password: "WrongPassword1!",
        deviceId: "device-1",
      }),
    ).rejects.toThrow("Invalid username or password.");
    expect(cacheWrites).toContainEqual({
      key: "auth:local-login-attempts:missing-user",
      value: {
        failedAttempts: 1,
      },
      ttlSeconds: 15 * 60,
    });
  });

  it("locks local sign-in immediately when a locked attempt record already exists", async () => {
    const service = createService({
      cacheGetJson: async (key) =>
        key.startsWith("auth:local-login-attempts:")
          ? {
              failedAttempts: 5,
              lockedAt: "2026-01-02T00:00:00.000Z",
            }
          : null,
    });

    await expect(
      service.localAuthenticate({
        client: createClient(),
        username: "missing-user",
        password: "WrongPassword1!",
        deviceId: "device-1",
      }),
    ).rejects.toThrow("This sign-in is locked.");
  });

  it("sends an unlock code when a failed local sign-in reaches the lock threshold", async () => {
    const user = {
      ...createUser(),
      passwordHash: FAST_TEST_PASSWORD_HASH,
    };
    let unlockEmailInput:
      | {
          to: string;
          unlockCode: string;
          firstName?: string;
        }
      | undefined;
    const service = createService({
      findUserByUsername: async () => user,
      cacheGetJson: async (key) =>
        key.startsWith("auth:local-login-attempts:")
          ? {
              failedAttempts: 4,
            }
          : null,
      issueOtp: async () => ({
        code: "654321",
      }),
      sendLoginUnlockEmail: async (input) => {
        unlockEmailInput = input;
      },
    });

    await expect(
      service.localAuthenticate({
        client: createClient(),
        username: user.profile.username,
        password: "WrongPassword1!",
        deviceId: "device-1",
      }),
    ).rejects.toThrow("This sign-in is locked.");

    expect(unlockEmailInput).toEqual({
      to: user.email,
      unlockCode: "654321",
      firstName: user.firstName,
    });
  });

  it("rejects local sign-in for unverified users after a correct password check", async () => {
    const user = {
      ...createUser(),
      emailVerified: false,
      passwordHash: FAST_TEST_PASSWORD_HASH,
    };
    let clearedKey: string | undefined;
    const service = createService({
      findUserByUsername: async () => user,
      cacheDelete: async (key) => {
        clearedKey = key;
        return true;
      },
    });

    await expect(
      service.localAuthenticate({
        client: createClient(),
        username: user.profile.username,
        password: "CorrectHorseBatteryStaple1!",
        deviceId: "device-1",
      }),
    ).rejects.toThrow("Please verify your email address before signing in.");

    expect(clearedKey).toBe("auth:local-login-attempts:test-user");
  });

  it("unlocks local sign-in by email and clears the username lock state when the account exists", async () => {
    const user = createUser();
    const verifyCalls: Array<{
      purpose: string;
      subject: string;
      code: string;
    }> = [];
    let clearedKey: string | undefined;
    const service = createService({
      findUserByEmail: async () => user,
      verifyOtp: async (input) => {
        verifyCalls.push(input);
      },
      cacheDelete: async (key) => {
        clearedKey = key;
        return true;
      },
    });

    await expect(
      service.unlockLocalLogin({
        email: user.email,
        code: "123456",
      }),
    ).resolves.toEqual({
      unlocked: true,
      email: user.email,
    });
    expect(verifyCalls).toEqual([
      {
        purpose: "local-login-unlock",
        subject: user.email,
        code: "123456",
      },
    ]);
    expect(clearedKey).toBe("auth:local-login-attempts:test-user");
  });

  it("resends a local-login unlock code when the account is still locked", async () => {
    const user = createUser();
    let unlockEmailInput:
      | {
          to: string;
          unlockCode: string;
          firstName?: string;
        }
      | undefined;
    const service = createService({
      findUserByEmail: async () => user,
      cacheGetJson: async (key) =>
        key.startsWith("auth:local-login-attempts:")
          ? {
              failedAttempts: 5,
              lockedAt: "2026-01-02T00:00:00.000Z",
            }
          : null,
      issueOtp: async () => ({
        code: "654321",
      }),
      sendLoginUnlockEmail: async (input) => {
        unlockEmailInput = input;
      },
    });

    await expect(
      service.resendUnlockLocalLogin({
        client: createClient(),
        email: user.email,
        deviceId: "device-1",
      }),
    ).resolves.toEqual({
      accepted: true,
    });
    expect(unlockEmailInput).toEqual({
      to: user.email,
      unlockCode: "654321",
      firstName: user.firstName,
    });
  });

  it("skips login MFA for allowlisted users outside production", async () => {
    const user = {
      ...createUser(),
      email: "owner1@rentify.local",
      passwordHash: FAST_TEST_PASSWORD_HASH,
    };
    const verifyTotpCode = jest.fn(async () => undefined);
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    jest.spyOn(environment, "getTokenConfig").mockReturnValue({
      ...environment.getTokenConfig(),
      mfaBypassEmails: ["owner1@rentify.local"],
    });
    const service = createService({
      findUserByUsername: async () => user,
      mfaIsEnabled: async () => true,
      verifyTotpCode,
    });

    await expect(
      service.localAuthenticate({
        client: createClient(),
        username: user.profile.username,
        password: "CorrectHorseBatteryStaple1!",
        deviceId: "device-1",
      }),
    ).resolves.toMatchObject({
      user: { email: user.email },
    });

    expect(verifyTotpCode).not.toHaveBeenCalled();
  });

  it("still requires login MFA for non-allowlisted users", async () => {
    const user = {
      ...createUser(),
      passwordHash: FAST_TEST_PASSWORD_HASH,
    };
    jest.spyOn(environment, "isProduction").mockReturnValue(false);
    jest.spyOn(environment, "getTokenConfig").mockReturnValue({
      ...environment.getTokenConfig(),
      mfaBypassEmails: ["owner1@rentify.local"],
    });
    const service = createService({
      findUserByUsername: async () => user,
      mfaIsEnabled: async () => true,
    });

    await expect(
      service.localAuthenticate({
        client: createClient(),
        username: user.profile.username,
        password: "CorrectHorseBatteryStaple1!",
        deviceId: "device-1",
      }),
    ).rejects.toMatchObject({
      message: "Authenticator code is required.",
    });
  });

  it("ignores the bypass allowlist in production", async () => {
    const user = {
      ...createUser(),
      email: "owner1@rentify.local",
      passwordHash: FAST_TEST_PASSWORD_HASH,
    };
    jest.spyOn(environment, "isProduction").mockReturnValue(true);
    jest.spyOn(environment, "getTokenConfig").mockReturnValue({
      ...environment.getTokenConfig(),
      mfaBypassEmails: ["owner1@rentify.local"],
    });
    const service = createService({
      findUserByUsername: async () => user,
      mfaIsEnabled: async () => true,
    });

    await expect(
      service.localAuthenticate({
        client: createClient(),
        username: user.profile.username,
        password: "CorrectHorseBatteryStaple1!",
        deviceId: "device-1",
      }),
    ).rejects.toMatchObject({
      message: "Authenticator code is required.",
    });
  });

  it("resets passwords for eligible local accounts and issues a fresh session", async () => {
    const user = {
      ...createUser(),
      passwordHash: FAST_TEST_PASSWORD_HASH,
    };
    let updatedPasswordHash: string | undefined;
    let rotatedUserId: string | undefined;
    let clearedKey: string | undefined;
    const service = createService({
      findUserByUsername: async () => user,
      updatePasswordHash: async (userId, passwordHash) => {
        rotatedUserId = userId;
        updatedPasswordHash = passwordHash;
      },
      cacheDelete: async (key) => {
        clearedKey = key;
        return true;
      },
    });

    const result = await service.resetPassword({
      client: createClient(),
      username: user.profile.username,
      code: "123456",
      newPassword: "AnotherStrongPassword1!",
      deviceId: "device-1",
    });

    expect(rotatedUserId).toBe(user.id);
    expect(updatedPasswordHash).toBeDefined();
    await expect(
      bcrypt.compare("AnotherStrongPassword1!", updatedPasswordHash ?? ""),
    ).resolves.toBe(true);
    expect(clearedKey).toBe("auth:local-login-attempts:test-user");
    expect(result.refreshToken).toBe("refresh-token");
  });

  it("changes passwords for eligible local accounts and rejects reusing the current password", async () => {
    const passwordHash = await bcrypt.hash("CorrectHorseBatteryStaple1!", 4);
    const user = {
      ...createUser(),
      passwordHash,
    };
    let updatedPasswordHash: string | undefined;
    const service = createService({
      findUserById: async () => user,
      updatePasswordHash: async (_userId, nextPasswordHash) => {
        updatedPasswordHash = nextPasswordHash;
      },
    });

    await expect(
      service.changePassword({
        client: createClient(),
        userId: user.id,
        currentPassword: "CorrectHorseBatteryStaple1!",
        newPassword: "CorrectHorseBatteryStaple1!",
        deviceId: "device-1",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const result = await service.changePassword({
      userId: user.id,
      client: createClient(),
      currentPassword: "CorrectHorseBatteryStaple1!",
      newPassword: "AnotherStrongPassword1!",
      deviceId: "device-1",
    });

    await expect(
      bcrypt.compare("AnotherStrongPassword1!", updatedPasswordHash ?? ""),
    ).resolves.toBe(true);
    expect(result.accessToken).toBe("access-token");
  });

  describe("setPassword", () => {
    function createOAuthOnlyUser(): AuthUserRecord {
      return {
        ...createUser(),
        passwordHash: undefined,
        oauthIdentities: [
          {
            id: "oauth-identity-1",
            userId: "user-1",
            provider: "google",
            providerUserId: "google-user-1",
            providerEmail: "user@example.com",
            emailVerified: true,
            linkedAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
    }

    it("adds a first password to a social-only account and rotates the token version", async () => {
      const user = createOAuthOnlyUser();
      let updatedPasswordHash: string | undefined;
      let rotatedUserId: string | undefined;
      let clearedKey: string | undefined;
      const service = createService({
        findUserById: async () => user,
        setPasswordHashIfUnset: async (_userId, nextPasswordHash) => {
          updatedPasswordHash = nextPasswordHash;
          return true;
        },
        rotateTokenVersion: async (userId) => {
          rotatedUserId = userId;
          return 3;
        },
        cacheDelete: async (key) => {
          clearedKey = key;
          return true;
        },
      });

      const result = await service.setPassword({
        userId: user.id,
        client: createClient(),
        newPassword: "AnotherStrongPassword1!",
        deviceId: "device-1",
      });

      await expect(
        bcrypt.compare("AnotherStrongPassword1!", updatedPasswordHash ?? ""),
      ).resolves.toBe(true);
      expect(rotatedUserId).toBe(user.id);
      expect(clearedKey).toBe("auth:local-login-attempts:test-user");
      expect(result.accessToken).toBe("access-token");
    });

    it("conflicts without rotating the token version when a concurrent request won the race", async () => {
      const user = createOAuthOnlyUser();
      let rotateCalled = false;
      const service = createService({
        findUserById: async () => user,
        // The guard passed on a stale read, but the conditional write lost.
        setPasswordHashIfUnset: async () => false,
        rotateTokenVersion: async () => {
          rotateCalled = true;
          return 3;
        },
      });

      await expect(
        service.setPassword({
          userId: user.id,
          client: createClient(),
          newPassword: "AnotherStrongPassword1!",
          deviceId: "device-1",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(rotateCalled).toBe(false);
    });

    it("rejects accounts that already have a local password", async () => {
      const user = {
        ...createUser(),
        passwordHash: await bcrypt.hash("CorrectHorseBatteryStaple1!", 4),
      };
      let updateCalled = false;
      const service = createService({
        findUserById: async () => user,
        setPasswordHashIfUnset: async () => {
          updateCalled = true;
          return true;
        },
      });

      await expect(
        service.setPassword({
          userId: user.id,
          client: createClient(),
          newPassword: "AnotherStrongPassword1!",
          deviceId: "device-1",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(updateCalled).toBe(false);
    });

    it("rejects accounts whose email is not verified", async () => {
      const user = { ...createOAuthOnlyUser(), emailVerified: false };
      const service = createService({ findUserById: async () => user });

      await expect(
        service.setPassword({
          userId: user.id,
          client: createClient(),
          newPassword: "AnotherStrongPassword1!",
          deviceId: "device-1",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("rejects passwordless accounts with no linked provider", async () => {
      const user = { ...createOAuthOnlyUser(), oauthIdentities: [] };
      const service = createService({ findUserById: async () => user });

      await expect(
        service.setPassword({
          userId: user.id,
          client: createClient(),
          newPassword: "AnotherStrongPassword1!",
          deviceId: "device-1",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("rejects a missing user", async () => {
      const service = createService({ findUserById: async () => null });

      await expect(
        service.setPassword({
          userId: "missing-user",
          client: createClient(),
          newPassword: "AnotherStrongPassword1!",
          deviceId: "device-1",
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  it("activates an existing unverified user from pending signup state during email verification", async () => {
    const pendingPasswordHash = await bcrypt.hash(
      "CorrectHorseBatteryStaple1!",
      4,
    );
    const existingUser = {
      ...createUser(),
      id: "user-activate",
      email: "pending@example.com",
      emailVerified: false,
    };
    let activatedUserId: string | undefined;
    let deletedPendingKey: string | undefined;
    const service = createService({
      findUserByEmail: async () => existingUser,
      cacheGetJson: async (key) => {
        if (key === "auth:pending-signup-username:pending-user") {
          return "pending@example.com";
        }

        return {
          username: "pending-user",
          email: "pending@example.com",
          passwordHash: pendingPasswordHash,
          firstName: "Pending",
          lastName: "User",
          deviceId: "device-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        };
      },
      activatePendingLocalUser: async (userId, input) => {
        activatedUserId = userId;
        return {
          ...existingUser,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash: input.passwordHash,
          emailVerified: true,
          profile: {
            ...existingUser.profile,
            username: input.username,
          },
        };
      },
      cacheDelete: async (key) => {
        deletedPendingKey = key;
        return true;
      },
    });

    const result = await service.verifyEmail({
      client: createClient(),
      email: "pending@example.com",
      code: "123456",
      deviceId: "device-1",
    });

    expect(activatedUserId).toBe("user-activate");
    expect(deletedPendingKey).toBe("auth:pending-signup:pending@example.com");
    expect(result.user.emailVerified).toBe(true);
    expect(result.user.username).toBe("pending-user");
  });

  it("authenticates through the Microsoft and Apple providers", async () => {
    const service = createService();
    Object.assign(service as object, {
      microsoftOAuthService: {
        verify: async () => ({
          email: "microsoft@example.com",
          provider: "microsoft",
          providerUserId: "ms-user-1",
          emailVerified: true,
        }),
      },
      appleOAuthService: {
        verify: async () => ({
          email: "apple@example.com",
          provider: "apple",
          providerUserId: "apple-user-1",
          emailVerified: true,
        }),
      },
    });
    await expect(
      service.microsoftAuthenticate({
        client: createClient(),
        nonce: "nonce-1",
        code: "code-1",
        codeVerifier: "verifier-1",
        deviceId: "device-1",
      }),
    ).resolves.toMatchObject({
      user: {
        email: "microsoft@example.com",
      },
    });

    await expect(
      service.appleAuthenticate({
        client: createClient(),
        nonce: "nonce-1",
        code: "code-1",
        codeVerifier: "verifier-1",
        deviceId: "device-1",
      }),
    ).resolves.toMatchObject({
      user: {
        email: "apple@example.com",
      },
    });

  });

  describe("isUsernameAvailable", () => {
    it("reports an unused username as available and normalizes it", async () => {
      const service = createService();

      await expect(
        service.isUsernameAvailable("  Casey-Doe  "),
      ).resolves.toEqual({
        username: "casey-doe",
        available: true,
        reason: null,
      });
    });

    it("reports a username held by another account as taken", async () => {
      const service = createService({
        findUserIdByUsername: async () => "user-2",
      });

      await expect(service.isUsernameAvailable("casey-doe")).resolves.toEqual({
        username: "casey-doe",
        available: false,
        reason: "taken",
      });
    });

    it("exempts the caller's own username so settings does not flag it", async () => {
      const service = createService({
        findUserIdByUsername: async () => "user-1",
      });

      await expect(
        service.isUsernameAvailable("casey-doe", "user-1"),
      ).resolves.toMatchObject({ available: true, reason: null });
    });

    it("reports a username reserved by an unverified signup as taken", async () => {
      const service = createService();

      await service.localSignup({
        client: createClient(),
        username: "casey-doe",
        email: "pending@example.com",
        password: "StrongPassw0rd!",
        deviceId: "device-1",
      });

      await expect(
        service.isUsernameAvailable("casey-doe"),
      ).resolves.toMatchObject({ available: false, reason: "taken" });
    });

    it("exempts the pending signup's own email from its reservation", async () => {
      const service = createService();

      await service.localSignup({
        client: createClient(),
        username: "casey-doe",
        email: "pending@example.com",
        password: "StrongPassw0rd!",
        deviceId: "device-1",
      });

      await expect(
        service.isUsernameAvailable(
          "casey-doe",
          undefined,
          "pending@example.com",
        ),
      ).resolves.toMatchObject({ available: true });
    });

    it("always consults the database, even when the filter has an opinion", async () => {
      // Write paths call this method. Letting the filter short-circuit them
      // would trade a clear "that username is taken" for a unique-constraint
      // violation surfaced later.
      const findUserIdByUsername = jest.fn(async () => null);
      const service = createService({
        findUserIdByUsername,
        usernameBloomCheck: () => "definitely-absent",
      });

      await service.isUsernameAvailable("casey-doe");

      expect(findUserIdByUsername).toHaveBeenCalledWith("casey-doe");
    });
  });

  describe("resolveUsernameAvailabilityHint", () => {
    it("answers from the filter without touching the database", async () => {
      const findUserIdByUsername = jest.fn(async () => null);
      const service = createService({
        findUserIdByUsername,
        usernameBloomCheck: () => "definitely-absent",
      });

      await expect(
        service.resolveUsernameAvailabilityHint("  Casey-Doe  "),
      ).resolves.toEqual({
        username: "casey-doe",
        available: true,
        reason: null,
      });
      expect(findUserIdByUsername).not.toHaveBeenCalled();
    });

    it("normalizes before consulting the filter", async () => {
      const usernameBloomCheck = jest.fn(() => "definitely-absent" as const);
      const service = createService({ usernameBloomCheck });

      await service.resolveUsernameAvailabilityHint("  Casey-Doe  ");

      expect(usernameBloomCheck).toHaveBeenCalledWith("casey-doe");
    });

    it("falls through to the database when the filter cannot rule the name out", async () => {
      // A false positive has to stay correct: it costs one query and still
      // returns the right verdict.
      const findUserIdByUsername = jest.fn(async () => "user-2");
      const service = createService({
        findUserIdByUsername,
        usernameBloomCheck: () => "possibly-present",
      });

      await expect(
        service.resolveUsernameAvailabilityHint("casey-doe"),
      ).resolves.toEqual({
        username: "casey-doe",
        available: false,
        reason: "taken",
      });
      expect(findUserIdByUsername).toHaveBeenCalledWith("casey-doe");
    });

    it("returns available when the filter was wrong and the row does not exist", async () => {
      const service = createService({
        findUserIdByUsername: async () => null,
        usernameBloomCheck: () => "possibly-present",
      });

      await expect(
        service.resolveUsernameAvailabilityHint("casey-doe"),
      ).resolves.toMatchObject({ available: true, reason: null });
    });

    it("reproduces the old behaviour when the filter is unavailable", async () => {
      const findUserIdByUsername = jest.fn(async () => "user-2");
      const service = createService({
        findUserIdByUsername,
        usernameBloomCheck: () => "unknown",
      });

      await expect(
        service.resolveUsernameAvailabilityHint("casey-doe"),
      ).resolves.toMatchObject({ available: false, reason: "taken" });
      expect(findUserIdByUsername).toHaveBeenCalled();
    });

    it("still exempts the caller's own username on the fallback path", async () => {
      const service = createService({
        findUserIdByUsername: async () => "user-1",
        usernameBloomCheck: () => "possibly-present",
      });

      await expect(
        service.resolveUsernameAvailabilityHint("casey-doe", "user-1"),
      ).resolves.toMatchObject({ available: true });
    });
  });

  describe("username bloom write-through", () => {
    it("records a username reserved by a pending signup", async () => {
      const usernameBloomAdd = jest.fn(async () => undefined);
      const service = createService({ usernameBloomAdd });

      await service.localSignup({
        client: createClient(),
        username: "Casey-Doe",
        email: "pending@example.com",
        password: "StrongPassw0rd!",
        deviceId: "device-1",
      });

      expect(usernameBloomAdd).toHaveBeenCalledWith("Casey-Doe");
    });
  });
});
