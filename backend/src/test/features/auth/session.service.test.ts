import type { ClientRequestContext } from "@/configuration/http/bindings";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type {
  AuthRequestContext,
  AuthUserRecord,
} from "@/features/auth/auth.model";
import { AuthSessionService } from "@/features/auth/session/session.service";
import { RefreshTokenReuseDetectedError } from "@/features/auth/token/token.service";
import type { JwtAuthPrincipal } from "@/features/auth/auth.principal";
import { testUuid } from "../../support/uuid";
const PAT_1_ID = testUuid(9300, 1);
const DEVICE_1_ID = testUuid(9200, 895443);

const PROFILE_1_ID = testUuid(9000, 548259);
const USER_1_ID = testUuid(9000, 994257);

function createClient(): ClientRequestContext {
  return {
    ip: "203.0.113.10",
    source: "frontend-browser" as const,
    device: { id: DEVICE_1_ID, type: "desktop", isMobile: false },
  } as ClientRequestContext;
}

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: USER_1_ID,
    email: "user@example.com",
    passwordHash: "",
    tokenVersion: 7,
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

function createAuthContext(
  overrides: Partial<AuthRequestContext> = {},
): AuthRequestContext {
  return {
    auth: {
      authMethod: "jwt",
      sub: USER_1_ID,
      deviceId: DEVICE_1_ID,
      sessionId: "session-1",
      iat: 1,
      exp: 999_999,
    },
    client: createClient(),
    ...overrides,
  } as AuthRequestContext;
}

function createHarness() {
  const authRepository = {
    findUserById: jest.fn(async () => createUser()),
    rotateTokenVersion: jest.fn(async () => 8),
    revokeAllCredentials: jest.fn(async () => ({
      tokenVersion: 8,
      revokedPersonalAccessTokenIds: [PAT_1_ID],
    })),
    recordLastLogin: jest.fn(async () => undefined),
  };
  const authAuditService = {
    recordSafely: jest.fn(async () => undefined),
  };
  const tokenService = {
    createAccessToken: jest.fn(() => "access-token"),
    createRefreshToken: jest.fn(async () => "refresh-token"),
    createSession: jest.fn(async () => undefined),
    getRefreshTokenExpiresInSeconds: jest.fn((rememberMe: boolean) =>
      rememberMe ? 7_776_000 : 2_592_000,
    ),
    verifyRefreshToken: jest.fn(async () => ({
      sub: USER_1_ID,
      deviceId: DEVICE_1_ID,
      rememberMe: true,
      sessionId: "session-1",
    })),
    rotateRefreshToken: jest.fn(async () => "rotated-refresh-token"),
    revokeRefreshToken: jest.fn(async () => true),
    revokeSession: jest.fn(async () => true),
    revokeSessionForUser: jest.fn(async () => true),
    listSessionsForUser: jest.fn(async () => []),
    revokeSessionsForUser: jest.fn(async () => ["session-1", "session-2"]),
    revokeSessionsForUserExcept: jest.fn(async () => ["session-2"]),
  };
  const deviceService = {
    evaluateSuccessfulAuthentication: jest.fn(async () => ({
      deviceId: DEVICE_1_ID,
      known: false,
      knownByIp: true,
    })),
    evaluateExistingSessionDevice: jest.fn(async () => ({
      deviceId: DEVICE_1_ID,
      known: true,
      knownByIp: true,
    })),
  };

  return {
    authRepository,
    tokenService,
    deviceService,
    authAuditService,
    service: new AuthSessionService(
      authRepository as never,
      authRepository as never,
      tokenService as never,
      deviceService as never,
      authAuditService as never,
    ),
  };
}

function createJwtPrincipal(
  overrides: Partial<JwtAuthPrincipal> = {},
): JwtAuthPrincipal {
  return {
    authMethod: "jwt",
    sub: USER_1_ID,
    deviceId: DEVICE_1_ID,
    sessionId: "session-1",
    tokenVersion: 7,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

describe("AuthSessionService.authenticateVerifiedUser", () => {
  it("evaluates the device as a login event", async () => {
    const harness = createHarness();
    const user = createUser();

    await harness.service.authenticateVerifiedUser(user, {
      client: createClient(),
      deviceId: DEVICE_1_ID,
    });

    expect(
      harness.deviceService.evaluateSuccessfulAuthentication,
    ).toHaveBeenCalledWith(user, expect.anything(), DEVICE_1_ID, undefined);
    expect(
      harness.deviceService.evaluateExistingSessionDevice,
    ).not.toHaveBeenCalled();
  });

  it("returns the issued session with the device verdict and profile", async () => {
    const harness = createHarness();

    await expect(
      harness.service.authenticateVerifiedUser(createUser(), {
        client: createClient(),
        deviceId: DEVICE_1_ID,
      }),
    ).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      refreshTokenExpiresInSeconds: 2_592_000,
      device: { deviceId: DEVICE_1_ID, known: false, knownByIp: true },
      user: { id: USER_1_ID, username: "test-user" },
      sessionId: expect.any(String),
    });
  });

  it("records the sign-in time for the user", async () => {
    const harness = createHarness();

    await harness.service.authenticateVerifiedUser(createUser(), {
      client: createClient(),
    });

    expect(harness.authRepository.recordLastLogin).toHaveBeenCalledWith(
      USER_1_ID,
    );
  });

  it("still signs in when the sign-in time cannot be recorded", async () => {
    const harness = createHarness();
    harness.authRepository.recordLastLogin.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      harness.service.authenticateVerifiedUser(createUser(), {
        client: createClient(),
      }),
    ).resolves.toMatchObject({ accessToken: "access-token" });
  });

  it("honours rememberMe in the refresh token lifetime", async () => {
    const harness = createHarness();

    const result = await harness.service.authenticateVerifiedUser(
      createUser(),
      { client: createClient(), deviceId: DEVICE_1_ID, rememberMe: true },
    );

    expect(
      harness.tokenService.getRefreshTokenExpiresInSeconds,
    ).toHaveBeenCalledWith(true);
    expect(result.refreshTokenExpiresInSeconds).toBe(7_776_000);
    expect(harness.tokenService.createRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ rememberMe: true }),
      { expiresInSeconds: 7_776_000 },
    );
  });

  it("mints the access token, session record and refresh token on one session id", async () => {
    const harness = createHarness();

    await harness.service.authenticateVerifiedUser(createUser(), {
      client: createClient(),
      deviceId: DEVICE_1_ID,
    });

    const accessTokenCalls = harness.tokenService.createAccessToken.mock
      .calls as unknown as Array<[{ sessionId: string }]>;
    const { sessionId } = accessTokenCalls[0][0];
    expect(sessionId).toEqual(expect.any(String));
    expect(harness.tokenService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        userId: USER_1_ID,
        tokenVersion: 7,
      }),
      2_592_000,
    );
    expect(harness.tokenService.createRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId }),
      expect.anything(),
    );
  });

  it("gives each sign-in a distinct session id", async () => {
    const harness = createHarness();

    await harness.service.authenticateVerifiedUser(createUser(), {
      client: createClient(),
    });
    await harness.service.authenticateVerifiedUser(createUser(), {
      client: createClient(),
    });

    const [first, second] = harness.tokenService.createAccessToken.mock
      .calls as unknown as Array<[{ sessionId: string }]>;
    expect(first[0].sessionId).not.toBe(second[0].sessionId);
  });
});

describe("AuthSessionService account status backstop", () => {
  it.each([
    { status: "locked" as const, code: "ACCOUNT_LOCKED" },
    { status: "suspended" as const, code: "ACCOUNT_SUSPENDED" },
  ])("issues no session to a $status account", async ({ status, code }) => {
    const harness = createHarness();
    const user = createUser({ status });

    await expect(
      harness.service.authenticateVerifiedUser(user, {
        client: createClient(),
        deviceId: DEVICE_1_ID,
      }),
    ).rejects.toMatchObject({ code });
    await expect(
      harness.service.reissueSessionForUser(user, createClient()),
    ).rejects.toMatchObject({ code });
    expect(
      harness.deviceService.evaluateSuccessfulAuthentication,
    ).not.toHaveBeenCalled();
    expect(
      harness.deviceService.evaluateExistingSessionDevice,
    ).not.toHaveBeenCalled();
  });
});

describe("AuthSessionService.reissueSessionForUser", () => {
  it("evaluates the device as an established one", async () => {
    const harness = createHarness();
    const user = createUser();

    await harness.service.reissueSessionForUser(
      user,
      createClient(),
      DEVICE_1_ID,
    );

    expect(
      harness.deviceService.evaluateExistingSessionDevice,
    ).toHaveBeenCalledWith(user, expect.anything(), DEVICE_1_ID, undefined);
    expect(
      harness.deviceService.evaluateSuccessfulAuthentication,
    ).not.toHaveBeenCalled();
  });

  it("does not carry rememberMe into a credential-change session", async () => {
    const harness = createHarness();

    const result = await harness.service.reissueSessionForUser(
      createUser(),
      createClient(),
      DEVICE_1_ID,
    );

    expect(
      harness.tokenService.getRefreshTokenExpiresInSeconds,
    ).toHaveBeenCalledWith(false);
    expect(result.refreshTokenExpiresInSeconds).toBe(2_592_000);
  });

  it("carries the rotated token version into the new session", async () => {
    const harness = createHarness();

    await harness.service.reissueSessionForUser(
      createUser({ tokenVersion: 9 }),
      createClient(),
      DEVICE_1_ID,
    );

    expect(harness.tokenService.createAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ tokenVersion: 9 }),
    );
    expect(harness.tokenService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ tokenVersion: 9 }),
      expect.anything(),
    );
  });
});

describe("AuthSessionService.localVerify", () => {
  it("echoes the principal and client without any I/O", async () => {
    const harness = createHarness();

    await expect(
      harness.service.localVerify(
        createAuthContext({
          auth: {
            authMethod: "jwt",
            sub: USER_1_ID,
            role: "owner",
            deviceId: "device-99",
            iat: 1,
            exp: 999_999,
          } as AuthRequestContext["auth"],
        }),
      ),
    ).resolves.toMatchObject({
      verified: true,
      auth: { userId: USER_1_ID, deviceId: "device-99", role: "owner" },
    });
    expect(harness.authRepository.findUserById).not.toHaveBeenCalled();
  });
});

describe("AuthSessionService session management", () => {
  it("projects current session metadata first and sorts the rest by activity", async () => {
    const harness = createHarness();
    harness.tokenService.listSessionsForUser.mockResolvedValue([
      {
        sessionId: "session-2",
        userId: USER_1_ID,
        deviceId: "device-2",
        tokenVersion: 7,
        status: "active",
        deviceType: "mobile",
        platform: "Android",
        userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/129.0",
        firstIpAddress: "198.51.100.2",
        lastIpAddress: "198.51.100.3",
        rememberMe: false,
        createdAt: "2026-10-01T00:00:00.000Z",
        lastUsedAt: "2026-10-30T12:00:00.000Z",
        updatedAt: "2026-10-30T12:00:00.000Z",
      },
      {
        sessionId: "session-1",
        userId: USER_1_ID,
        deviceId: DEVICE_1_ID,
        tokenVersion: 7,
        status: "active",
        deviceType: "desktop",
        platform: "Windows",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0",
        rememberMe: true,
        createdAt: "2026-10-01T00:00:00.000Z",
        lastUsedAt: "2026-10-20T12:00:00.000Z",
        updatedAt: "2026-10-20T12:00:00.000Z",
      },
    ] as never);

    await expect(
      harness.service.listSessions(createJwtPrincipal()),
    ).resolves.toEqual({
      sessions: [
        expect.objectContaining({
          id: "session-1",
          current: true,
          deviceLabel: "Chrome on Windows",
          browser: "Chrome",
          os: "Windows",
          rememberMe: true,
        }),
        expect.objectContaining({
          id: "session-2",
          current: false,
          deviceLabel: "Chrome on Android",
          firstIpAddress: "198.51.100.2",
          lastIpAddress: "198.51.100.3",
        }),
      ],
    });
    expect(harness.tokenService.listSessionsForUser).toHaveBeenCalledWith(
      USER_1_ID,
      7,
    );
  });

  it("revokes one owned session and records its scope", async () => {
    const harness = createHarness();
    const audit = { requestId: "request-1" };

    await expect(
      harness.service.revokeManagedSession({
        auth: createJwtPrincipal(),
        sessionId: "session-2",
        audit,
      }),
    ).resolves.toEqual({ revoked: true, id: "session-2", current: false });
    expect(harness.tokenService.revokeSessionForUser).toHaveBeenCalledWith(
      USER_1_ID,
      "session-2",
    );
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "session.revoked",
        sessionId: "session-2",
        metadata: { scope: "one" },
        context: audit,
      }),
    );
  });

  it("rejects a missing or non-owned session without an audit event", async () => {
    const harness = createHarness();
    harness.tokenService.revokeSessionForUser.mockResolvedValue(false);

    await expect(
      harness.service.revokeManagedSession({
        auth: createJwtPrincipal(),
        sessionId: "missing",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(harness.authAuditService.recordSafely).not.toHaveBeenCalled();
  });

  it("revokes other sessions while preserving the current one", async () => {
    const harness = createHarness();

    await expect(
      harness.service.revokeManagedSessions({
        auth: createJwtPrincipal(),
        scope: "others",
      }),
    ).resolves.toEqual({
      scope: "others",
      revokedSessionCount: 1,
      revokedPersonalAccessTokenCount: 0,
    });
    expect(
      harness.tokenService.revokeSessionsForUserExcept,
    ).toHaveBeenCalledWith(USER_1_ID, "session-1");
    expect(harness.authRepository.revokeAllCredentials).not.toHaveBeenCalled();
  });

  it("revokes all sessions and PATs and audits every affected credential", async () => {
    const harness = createHarness();

    await expect(
      harness.service.revokeManagedSessions({
        auth: createJwtPrincipal(),
        scope: "all",
      }),
    ).resolves.toEqual({
      scope: "all",
      revokedSessionCount: 2,
      revokedPersonalAccessTokenCount: 1,
    });
    expect(harness.authRepository.revokeAllCredentials).toHaveBeenCalledWith(
      USER_1_ID,
    );
    expect(harness.tokenService.revokeSessionsForUser).toHaveBeenCalledWith(
      USER_1_ID,
    );
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "pat.revoked",
        metadata: expect.objectContaining({
          tokenId: PAT_1_ID,
          scope: "all",
        }),
      }),
    );
  });
});

describe("AuthSessionService.refresh", () => {
  it("rejects a request with no refresh token", async () => {
    const harness = createHarness();

    await expect(
      harness.service.refresh({ client: createClient() }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rotates the token and preserves rememberMe", async () => {
    const harness = createHarness();

    const session = await harness.service.refresh({
      client: createClient(),
      refreshToken: "incoming-refresh-token",
    });

    expect(session.refreshToken).toBe("rotated-refresh-token");
    expect(session.refreshTokenExpiresInSeconds).toBe(7_776_000);
    expect(harness.tokenService.rotateRefreshToken).toHaveBeenCalledWith(
      "incoming-refresh-token",
      expect.objectContaining({ rememberMe: true, sessionId: "session-1" }),
      { expiresInSeconds: 7_776_000 },
      expect.objectContaining({ ip: "203.0.113.10" }),
    );
  });

  it("ends a legacy sessionless token at its next refresh", async () => {
    const harness = createHarness();
    harness.tokenService.verifyRefreshToken.mockResolvedValue({
      sub: USER_1_ID,
      deviceId: DEVICE_1_ID,
      rememberMe: false,
      sessionId: undefined,
    } as never);

    await expect(
      harness.service.refresh({
        client: createClient(),
        refreshToken: "legacy-refresh-token",
      }),
    ).rejects.toThrow("Session is no longer valid.");

    expect(harness.tokenService.createSession).not.toHaveBeenCalled();
    expect(harness.tokenService.revokeRefreshToken).toHaveBeenCalledWith(
      "legacy-refresh-token",
    );
    expect(harness.tokenService.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it("falls back to the request device when the token carries none", async () => {
    const harness = createHarness();
    harness.tokenService.verifyRefreshToken.mockResolvedValue({
      sub: USER_1_ID,
      rememberMe: false,
      sessionId: "session-1",
    } as never);

    await harness.service.refresh({
      client: createClient(),
      refreshToken: "incoming-refresh-token",
    });

    expect(harness.tokenService.createAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: DEVICE_1_ID }),
    );
  });

  it("rejects a token whose account no longer exists", async () => {
    const harness = createHarness();
    harness.authRepository.findUserById.mockResolvedValue(
      null as unknown as AuthUserRecord,
    );

    await expect(
      harness.service.refresh({
        client: createClient(),
        refreshToken: "incoming-refresh-token",
      }),
    ).rejects.toThrow();
  });

  it("records refresh-token reuse with the compromised session context", async () => {
    const harness = createHarness();
    harness.tokenService.rotateRefreshToken.mockRejectedValue(
      new RefreshTokenReuseDetectedError(USER_1_ID, "session-1"),
    );
    const audit = { ipAddress: "203.0.113.10", requestId: "request-1" };

    await expect(
      harness.service.refresh({
        client: createClient(),
        refreshToken: "incoming-refresh-token",
        audit,
      }),
    ).rejects.toThrow("Refresh token has already been used.");

    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "session.refresh_reuse_detected",
      outcome: "blocked",
      userId: USER_1_ID,
      method: "refresh",
      sessionId: "session-1",
      context: audit,
    });
  });
});

describe("AuthSessionService.logout", () => {
  it("revokes the refresh token and the current session", async () => {
    const harness = createHarness();

    await expect(
      harness.service.logout(
        createAuthContext({ refreshToken: "refresh-token-1" }),
      ),
    ).resolves.toMatchObject({
      loggedOut: true,
      auth: { userId: USER_1_ID, deviceId: DEVICE_1_ID },
    });

    expect(harness.tokenService.revokeRefreshToken).toHaveBeenCalledWith(
      "refresh-token-1",
    );
    expect(harness.tokenService.revokeSession).toHaveBeenCalledWith(
      "session-1",
    );
  });

  it("records the sign-out with its session and request context", async () => {
    const harness = createHarness();
    const audit = { ipAddress: "203.0.113.10", requestId: "request-1" };

    await harness.service.logout(createAuthContext({ audit }));

    expect(harness.authAuditService.recordSafely).toHaveBeenCalledTimes(1);
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith({
      eventType: "logout",
      outcome: "success",
      userId: USER_1_ID,
      method: undefined,
      sessionId: "session-1",
      context: audit,
    });
  });

  it("still ends the session when the refresh token cannot be revoked", async () => {
    const harness = createHarness();
    harness.tokenService.revokeRefreshToken.mockRejectedValue(
      new Error("already revoked"),
    );

    await expect(
      harness.service.logout(
        createAuthContext({ refreshToken: "refresh-token-1" }),
      ),
    ).resolves.toMatchObject({ loggedOut: true });
    expect(harness.tokenService.revokeSession).toHaveBeenCalled();
  });

  it("rotates the token version for a personal access token", async () => {
    // A PAT has no session record, so bumping the token version is the only way
    // to invalidate it.
    const harness = createHarness();

    await harness.service.logout(
      createAuthContext({
        auth: {
          authMethod: "pat",
          sub: USER_1_ID,
          scopes: ["auth:read"],
          personalAccessTokenId: PAT_1_ID,
          personalAccessTokenName: "CI token",
        } satisfies AuthRequestContext["auth"],
      }),
    );

    expect(harness.authRepository.rotateTokenVersion).toHaveBeenCalledWith(
      USER_1_ID,
    );
    expect(harness.tokenService.revokeSession).not.toHaveBeenCalled();
    expect(harness.authAuditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "logout",
        method: "pat",
        sessionId: undefined,
      }),
    );
  });
});
