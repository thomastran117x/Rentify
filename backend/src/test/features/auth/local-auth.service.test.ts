import bcrypt from "bcrypt";
import { environment } from "@/configuration/environment";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import TooManyRequestError from "@/errors/http/too-many-request.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { LocalAuthService } from "@/features/auth/local/local-auth.service";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { AuthSessionService } from "@/features/auth/session/session.service";
import { PendingSignupStore } from "@/features/auth/pending-signup/pending-signup.store";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";
import { UsernameService } from "@/features/auth/username/username.service";
import { LoginLockoutService } from "@/features/auth/lockout/login-lockout.service";
import { testUuid } from "../../support/uuid";
const DEVICE_1_ID = testUuid(9200, 895443);
const KNOWN_DEVICE_1_ID = testUuid(9200, 135264);
const OAUTH_IDENTITY_1_ID = testUuid(9200, 618144);
const USER_ACTIVATE_ID = testUuid(9200, 329753);

const PROFILE_1_ID = testUuid(9000, 548259);
const USER_1_ID = testUuid(9000, 994257);

const FAST_TEST_PASSWORD_HASH =
  "$2b$04$GXVZoFfAkExdnRF7t73lJuSVP2eDEWjoAAxTupSfym6y1po0SJYwe";

function createUser(): AuthUserRecord {
  return {
    id: USER_1_ID,
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
      id: PROFILE_1_ID,
      userId: USER_1_ID,
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
    source: "frontend-browser" as const,
    device: {
      id: DEVICE_1_ID,
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
            id: OAUTH_IDENTITY_1_ID,
            userId: USER_1_ID,
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
        id: OAUTH_IDENTITY_1_ID,
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
        sub: USER_1_ID,
        deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
        known: true,
        knownByIp: true,
      })),
    evaluateExistingSessionDevice:
      overrides?.evaluateExistingSessionDevice ??
      (async () => ({
        deviceId: DEVICE_1_ID,
        known: true,
        knownByIp: true,
      })),
    registerKnownDevice:
      overrides?.registerKnownDevice ??
      (async () => ({
        deviceId: DEVICE_1_ID,
        known: true,
        knownByIp: true,
      })),
    listKnownDevices:
      overrides?.listKnownDevices ??
      (async () => [
        {
          id: KNOWN_DEVICE_1_ID,
          current: true,
          deviceId: DEVICE_1_ID,
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
    authRepository as any,
    authRepository as any,
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

  const usernameService = new UsernameService(
    authRepository as any,
    usernameBloomService as any,
    pendingSignupStore,
    publicOtpService,
  );

  const loginLockoutService = new LoginLockoutService(
    cacheService as any,
    authRepository as any,
    otpService as any,
    publicOtpService,
  );

  const service = new LocalAuthService(
    authRepository as any,
    tokenService as any,
    otpService as any,
    deviceService as any,
    emailService as any,
    cacheService as any,
    mfaTotpService as any,
    usernameBloomService as any,
    authSessionService,
    pendingSignupStore,
    publicOtpService,
    usernameService,
    loginLockoutService,
  );

  return service;
}

describe("LocalAuthService", () => {
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
        deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
      }),
    ).resolves.toEqual({
      verificationRequired: true,
      email: "user@example.com",
      alreadyPending: false,
    });
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
        deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
      }),
    ).resolves.toEqual({
      accepted: true,
    });

    expect(verificationEmailSentTo).toBe("pending@example.com");
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
      deviceId: DEVICE_1_ID,
    });

    expect(session.refreshToken).toBe("refresh-token-remembered");
    expect(session.refreshTokenExpiresInSeconds).toBe(2_592_000);
    expect(issuedRememberMe).toBe(true);
    expect(issuedRefreshOptions?.expiresInSeconds).toBe(2_592_000);
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
        deviceId: DEVICE_1_ID,
      }),
    ).rejects.toThrow("Please verify your email address before signing in.");

    expect(clearedKey).toBe("auth:local-login-attempts:test-user");
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
        deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
      }),
    ).rejects.toMatchObject({
      message: "Authenticator code is required.",
    });
  });

  it("activates an existing unverified user from pending signup state during email verification", async () => {
    const pendingPasswordHash = await bcrypt.hash(
      "CorrectHorseBatteryStaple1!",
      4,
    );
    const existingUser = {
      ...createUser(),
      id: USER_ACTIVATE_ID,
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
          deviceId: DEVICE_1_ID,
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
      deviceId: DEVICE_1_ID,
    });

    expect(activatedUserId).toBe(USER_ACTIVATE_ID);
    expect(deletedPendingKey).toBe("auth:pending-signup:pending@example.com");
    expect(result.user.emailVerified).toBe(true);
    expect(result.user.username).toBe("pending-user");
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
        deviceId: DEVICE_1_ID,
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
          deviceId: DEVICE_1_ID,
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

  it("accepts resend verification email without revealing that the user is already verified", async () => {
    const service = createService({
      findUserByEmail: async () => createUser(),
    });

    await expect(
      service.resendVerificationEmail({
        client: createClient(),
        email: "user@example.com",
        deviceId: DEVICE_1_ID,
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
          deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
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
    expect(markedVerifiedUserId).toBe(USER_1_ID);
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
        deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
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
        deviceId: DEVICE_1_ID,
      }),
    ).rejects.toThrow("This sign-in is locked.");

    expect(unlockEmailInput).toEqual({
      to: user.email,
      unlockCode: "654321",
      firstName: user.firstName,
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
        deviceId: DEVICE_1_ID,
      });

      expect(usernameBloomAdd).toHaveBeenCalledWith("Casey-Doe");
    });
  });
});
