import ConflictError from "@/errors/http/conflict.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { ClientRequestContext } from "@/configuration/http/bindings";
import type {
  AuthUserRecord,
  OAuthIdentityRecord,
} from "@/features/auth/auth.model";
import { OAuthAccountsService } from "@/features/auth/oauth/oauth-accounts.service";
import { AuthSessionService } from "@/features/auth/session/session.service";
import { testUuid } from "../../support/uuid";
const OAUTH_IDENTITY_1_ID = testUuid(9000, 618144);

const PROFILE_1_ID = testUuid(9000, 548259);
const USER_1_ID = testUuid(9000, 994257);
const USER_2_ID = testUuid(9000, 994258);

const BCRYPT_HASH =
  "$2b$04$GXVZoFfAkExdnRF7t73lJuSVP2eDEWjoAAxTupSfym6y1po0SJYwe";

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
    lastName: "User",
    role: "user",
    emailVerified: true,
    oauthIdentities: [],
    organizationMemberships: [],
    profile: {
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
  id: OAUTH_IDENTITY_1_ID,
  userId: USER_1_ID,
  provider: "google",
  providerUserId: "google-user-1",
  providerEmail: "user@example.com",
  emailVerified: true,
  linkedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const googleProfile = {
  email: "oauth@example.com",
  provider: "google" as const,
  providerUserId: "google-user-1",
  emailVerified: true,
};

const oauthInput = {
  client: createClient(),
  nonce: "nonce-1",
  code: "code-1",
  codeVerifier: "verifier-1",
  deviceId: "device-1",
};

function createHarness() {
  const authRepository = {
    findUserByEmail: jest.fn(async () => null as AuthUserRecord | null),
    findUserById: jest.fn(async () => createUser()),
    findUserByOAuthIdentity: jest.fn(async () => null as AuthUserRecord | null),
    createOAuthUser: jest.fn(async () => createUser()),
    linkOAuthIdentity: jest.fn(async () => googleIdentity),
    unlinkOAuthIdentity: jest.fn(async () => true),
    listOAuthIdentitiesByUserId: jest.fn(async () => [googleIdentity]),
  };
  const googleOAuthService = { verify: jest.fn(async () => googleProfile) };
  const microsoftOAuthService = {
    verify: jest.fn(async () => ({
      ...googleProfile,
      provider: "microsoft" as const,
      email: "microsoft@example.com",
      providerUserId: "ms-user-1",
    })),
  };
  const appleOAuthService = {
    verify: jest.fn(async () => ({
      ...googleProfile,
      provider: "apple" as const,
      email: "apple@example.com",
      providerUserId: "apple-user-1",
    })),
  };
  const usernameBloomService = {
    check: jest.fn(() => "definitely-absent" as const),
    add: jest.fn(async () => undefined),
  };
  const mfaTotpService = {
    isEnabled: jest.fn(async () => false),
    verifyCode: jest.fn(async () => undefined),
  };
  const tokenService = {
    createAccessToken: jest.fn(() => "access-token"),
    createRefreshToken: jest.fn(async () => "refresh-token"),
    createSession: jest.fn(async () => undefined),
    getRefreshTokenExpiresInSeconds: jest.fn(() => 2_592_000),
  };
  const deviceService = {
    evaluateSuccessfulAuthentication: jest.fn(async () => ({
      deviceId: "device-1",
      known: true,
      knownByIp: true,
    })),
  };

  return {
    authRepository,
    googleOAuthService,
    microsoftOAuthService,
    appleOAuthService,
    usernameBloomService,
    mfaTotpService,
    tokenService,
    service: new OAuthAccountsService(
      authRepository as never,
      authRepository as never,
      googleOAuthService as never,
      microsoftOAuthService as never,
      appleOAuthService as never,
      usernameBloomService as never,
      mfaTotpService as never,
      new AuthSessionService(
        authRepository as never,
        authRepository as never,
        tokenService as never,
        deviceService as never,
      ),
    ),
  };
}

describe("OAuthAccountsService sign-in", () => {
  it("creates a new user when the provider account is verified and unlinked", async () => {
    const harness = createHarness();
    const createdUser = createUser({ email: "oauth-created@example.com" });
    harness.googleOAuthService.verify.mockResolvedValue({
      ...googleProfile,
      email: createdUser.email,
    });
    harness.authRepository.createOAuthUser.mockResolvedValue(createdUser);

    const result = await harness.service.googleAuthenticate(oauthInput);

    expect(harness.authRepository.createOAuthUser).toHaveBeenCalled();
    expect(result.accessToken).toBe("access-token");
    expect(result.user.email).toBe(createdUser.email);
    expect(result.isNewUser).toBe(true);
  });

  it("adds the generated username to the bloom filter", async () => {
    const harness = createHarness();

    await harness.service.googleAuthenticate(oauthInput);

    expect(harness.usernameBloomService.add).toHaveBeenCalledWith("test-user");
  });

  it("refuses to take over an email that already has an account", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByEmail.mockResolvedValue(
      createUser({ email: "oauth@example.com", passwordHash: BCRYPT_HASH }),
    );

    await expect(
      harness.service.googleAuthenticate(oauthInput),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("matches on the provider subject before the email", async () => {
    // The address on the provider can change; the subject cannot. Matching on
    // the subject is what lets a renamed provider account still sign in.
    const harness = createHarness();
    const linkedUser = createUser({
      email: "renamed@example.com",
      passwordHash: undefined,
      oauthIdentities: [googleIdentity],
    });
    harness.authRepository.findUserByOAuthIdentity.mockResolvedValue(
      linkedUser,
    );
    harness.googleOAuthService.verify.mockResolvedValue({
      ...googleProfile,
      email: "provider-email@example.com",
    });

    const result = await harness.service.googleAuthenticate(oauthInput);

    expect(harness.authRepository.findUserByEmail).not.toHaveBeenCalled();
    expect(result.user.email).toBe("renamed@example.com");
    expect(result.isNewUser).toBeUndefined();
  });

  it("rejects a provider profile with an unverified email", async () => {
    const harness = createHarness();
    harness.googleOAuthService.verify.mockResolvedValue({
      ...googleProfile,
      emailVerified: false,
    });

    await expect(
      harness.service.googleAuthenticate(oauthInput),
    ).rejects.toThrow("OAuth account email must be verified.");
  });

  it("enforces the login MFA gate on a linked account", async () => {
    const harness = createHarness();
    harness.authRepository.findUserByOAuthIdentity.mockResolvedValue(
      createUser({ oauthIdentities: [googleIdentity] }),
    );
    harness.mfaTotpService.isEnabled.mockResolvedValue(true);

    await expect(
      harness.service.googleAuthenticate(oauthInput),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("authenticates through Microsoft", async () => {
    const harness = createHarness();
    harness.authRepository.createOAuthUser.mockResolvedValue(
      createUser({ email: "microsoft@example.com" }),
    );

    await expect(
      harness.service.microsoftAuthenticate(oauthInput),
    ).resolves.toMatchObject({ user: { email: "microsoft@example.com" } });
  });

  it("authenticates through Apple", async () => {
    const harness = createHarness();
    harness.authRepository.createOAuthUser.mockResolvedValue(
      createUser({ email: "apple@example.com" }),
    );

    await expect(
      harness.service.appleAuthenticate(oauthInput),
    ).resolves.toMatchObject({ user: { email: "apple@example.com" } });
  });
});

describe("OAuthAccountsService.linkOAuthProvider", () => {
  const linkInput = {
    ...oauthInput,
    userId: USER_1_ID,
    provider: "google" as const,
  };

  it("links a provider to an authenticated local account", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({ passwordHash: BCRYPT_HASH }),
    );
    harness.googleOAuthService.verify.mockResolvedValue({
      ...googleProfile,
      email: "user@example.com",
    });

    await expect(harness.service.linkOAuthProvider(linkInput)).resolves.toEqual(
      {
        hasPassword: true,
        providers: [
          {
            id: OAUTH_IDENTITY_1_ID,
            provider: "google",
            providerEmail: "user@example.com",
            emailVerified: true,
            displayName: undefined,
            linkedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    );
    expect(harness.authRepository.linkOAuthIdentity).toHaveBeenCalledWith(
      USER_1_ID,
      expect.objectContaining({ provider: "google" }),
    );
  });

  it("rejects a subject already linked to another account", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({ passwordHash: BCRYPT_HASH }),
    );
    harness.authRepository.findUserByOAuthIdentity.mockResolvedValue(
      createUser({ id: USER_2_ID, email: "other@example.com" }),
    );

    await expect(
      harness.service.linkOAuthProvider(linkInput),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("is idempotent when the provider is already linked to this account", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({
        passwordHash: BCRYPT_HASH,
        oauthIdentities: [googleIdentity],
      }),
    );

    await expect(
      harness.service.linkOAuthProvider(linkInput),
    ).resolves.toMatchObject({ hasPassword: true });
    expect(harness.authRepository.linkOAuthIdentity).not.toHaveBeenCalled();
  });

  it("routes to the provider named in the route parameter", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({ passwordHash: BCRYPT_HASH }),
    );

    await harness.service.linkOAuthProvider({
      ...linkInput,
      provider: "apple",
    });

    expect(harness.appleOAuthService.verify).toHaveBeenCalled();
    expect(harness.googleOAuthService.verify).not.toHaveBeenCalled();
  });
});

describe("OAuthAccountsService.linkedOAuthProviders", () => {
  it("reports the linked providers and whether a password exists", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({
        passwordHash: BCRYPT_HASH,
        oauthIdentities: [googleIdentity],
      }),
    );

    await expect(
      harness.service.linkedOAuthProviders({ userId: USER_1_ID }),
    ).resolves.toMatchObject({
      hasPassword: true,
      providers: [expect.objectContaining({ provider: "google" })],
    });
  });

  it("reports no password for a social-only account", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({
        passwordHash: undefined,
        oauthIdentities: [googleIdentity],
      }),
    );

    await expect(
      harness.service.linkedOAuthProviders({ userId: USER_1_ID }),
    ).resolves.toMatchObject({ hasPassword: false });
  });
});

describe("OAuthAccountsService.unlinkOAuthProvider", () => {
  it("blocks unlinking the last usable sign-in method", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({
        passwordHash: undefined,
        oauthIdentities: [googleIdentity],
      }),
    );

    await expect(
      harness.service.unlinkOAuthProvider({
        userId: USER_1_ID,
        provider: "google",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("unlinks when a local password remains", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({
        passwordHash: BCRYPT_HASH,
        oauthIdentities: [googleIdentity],
      }),
    );
    harness.authRepository.listOAuthIdentitiesByUserId.mockResolvedValue([]);

    await expect(
      harness.service.unlinkOAuthProvider({
        userId: USER_1_ID,
        provider: "google",
      }),
    ).resolves.toEqual({ hasPassword: true, providers: [] });
    expect(harness.authRepository.unlinkOAuthIdentity).toHaveBeenCalledWith(
      USER_1_ID,
      "google",
    );
  });

  it("is a no-op when the provider was never linked", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      createUser({ passwordHash: BCRYPT_HASH }),
    );

    await expect(
      harness.service.unlinkOAuthProvider({
        userId: USER_1_ID,
        provider: "google",
      }),
    ).resolves.toEqual({ hasPassword: true, providers: [] });
    expect(harness.authRepository.unlinkOAuthIdentity).not.toHaveBeenCalled();
  });
});
