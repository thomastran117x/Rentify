import type { ClientRequestContext } from "@/configuration/http/bindings";
import type { AuthUserRecord } from "@/features/auth/auth.model";
import { AuthSessionService } from "@/features/auth/session/session.service";

function createClient(): ClientRequestContext {
  return {
    ip: "203.0.113.10",
    device: { id: "device-1", type: "desktop", isMobile: false },
  } as ClientRequestContext;
}

function createUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: "user-1",
    email: "user@example.com",
    passwordHash: "",
    tokenVersion: 7,
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

function createHarness() {
  const tokenService = {
    createAccessToken: jest.fn(() => "access-token"),
    createRefreshToken: jest.fn(async () => "refresh-token"),
    createSession: jest.fn(async () => undefined),
    getRefreshTokenExpiresInSeconds: jest.fn((rememberMe: boolean) =>
      rememberMe ? 7_776_000 : 2_592_000,
    ),
  };
  const deviceService = {
    evaluateSuccessfulAuthentication: jest.fn(async () => ({
      deviceId: "device-1",
      known: false,
      knownByIp: true,
    })),
    evaluateExistingSessionDevice: jest.fn(async () => ({
      deviceId: "device-1",
      known: true,
      knownByIp: true,
    })),
  };

  return {
    tokenService,
    deviceService,
    service: new AuthSessionService(
      tokenService as never,
      deviceService as never,
    ),
  };
}

describe("AuthSessionService.authenticateVerifiedUser", () => {
  it("evaluates the device as a login event", async () => {
    const harness = createHarness();
    const user = createUser();

    await harness.service.authenticateVerifiedUser(user, {
      client: createClient(),
      deviceId: "device-1",
    });

    expect(
      harness.deviceService.evaluateSuccessfulAuthentication,
    ).toHaveBeenCalledWith(user, expect.anything(), "device-1");
    expect(
      harness.deviceService.evaluateExistingSessionDevice,
    ).not.toHaveBeenCalled();
  });

  it("returns the issued session with the device verdict and profile", async () => {
    const harness = createHarness();

    await expect(
      harness.service.authenticateVerifiedUser(createUser(), {
        client: createClient(),
        deviceId: "device-1",
      }),
    ).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      refreshTokenExpiresInSeconds: 2_592_000,
      device: { deviceId: "device-1", known: false, knownByIp: true },
      user: { id: "user-1", username: "test-user" },
    });
  });

  it("honours rememberMe in the refresh token lifetime", async () => {
    const harness = createHarness();

    const result = await harness.service.authenticateVerifiedUser(
      createUser(),
      { client: createClient(), deviceId: "device-1", rememberMe: true },
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
      deviceId: "device-1",
    });

    const accessTokenCalls = harness.tokenService.createAccessToken.mock
      .calls as unknown as Array<[{ sessionId: string }]>;
    const { sessionId } = accessTokenCalls[0][0];
    expect(sessionId).toEqual(expect.any(String));
    expect(harness.tokenService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        userId: "user-1",
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

describe("AuthSessionService.reissueSessionForUser", () => {
  it("evaluates the device as an established one", async () => {
    const harness = createHarness();
    const user = createUser();

    await harness.service.reissueSessionForUser(
      user,
      createClient(),
      "device-1",
    );

    expect(
      harness.deviceService.evaluateExistingSessionDevice,
    ).toHaveBeenCalledWith(user, expect.anything(), "device-1");
    expect(
      harness.deviceService.evaluateSuccessfulAuthentication,
    ).not.toHaveBeenCalled();
  });

  it("does not carry rememberMe into a credential-change session", async () => {
    const harness = createHarness();

    const result = await harness.service.reissueSessionForUser(
      createUser(),
      createClient(),
      "device-1",
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
      "device-1",
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
