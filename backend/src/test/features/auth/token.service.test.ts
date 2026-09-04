import { createHmac } from "node:crypto";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import {
  TokenService,
  type JwtClaims,
} from "@/features/auth/token/token.service";
import { testUuid } from "../../support/uuid";
const MISSING_USER_ID = testUuid(9000, 791594);

const USER_1_ID = testUuid(9000, 994257);

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: USER_1_ID,
    email: "user@example.com",
    role: "user",
    deviceId: "device-1",
    tokenVersion: 2,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createAuthRepository(options?: {
  tokenVersion?: number | null;
  role?: JwtClaims["role"];
}) {
  return {
    findSessionValidationByUserId: jest.fn(async () => {
      const tokenVersion =
        options?.tokenVersion === undefined ? 2 : options.tokenVersion;

      if (tokenVersion === null) {
        return null;
      }

      return {
        tokenVersion,
        role: options?.role ?? "user",
      };
    }),
  };
}

function createCache() {
  const store = new Map<string, { value: unknown; ttlSeconds: number }>();

  return {
    store,
    service: {
      getJson: jest.fn(async <TValue>(key: string) => {
        return (store.get(key)?.value as TValue | undefined) ?? null;
      }),
      setJson: jest.fn(
        async (key: string, value: unknown, ttlSeconds: number) => {
          store.set(key, {
            value,
            ttlSeconds,
          });
        },
      ),
      delete: jest.fn(async (key: string) => store.delete(key)),
      ttl: jest.fn(async (key: string) => store.get(key)?.ttlSeconds ?? -1),
      scanKeys: jest.fn(async (pattern: string) => {
        const prefix = pattern.replace(/\*$/, "");
        return [...store.keys()].filter((key) => key.startsWith(prefix));
      }),
      withLock: jest.fn(
        async (
          _key: string,
          _ttlInMs: number,
          callback: () => Promise<unknown>,
        ) => {
          return callback();
        },
      ),
    },
  };
}

function createService(options?: {
  tokenVersion?: number | null;
  role?: JwtClaims["role"];
  refreshTokenMode?: "stateless" | "stateful";
  issuer?: string;
  audience?: string;
  cachePrefix?: string;
  accessTokenSecret?: string;
  refreshTokenSecret?: string;
}) {
  const authRepository = createAuthRepository({
    tokenVersion: options?.tokenVersion,
    role: options?.role,
  });
  const cache = createCache();
  const service = new TokenService({
    cache: cache.service as any,
    tokenRepository: authRepository as any,
    accessTokenSecret: options?.accessTokenSecret,
    refreshTokenSecret: options?.refreshTokenSecret,
    refreshTokenMode: options?.refreshTokenMode,
    issuer: options?.issuer,
    audience: options?.audience,
    refreshTokenCachePrefix: options?.cachePrefix,
  });

  return {
    service,
    authRepository,
    cache,
  };
}

function toBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signValue(unsignedToken: string, secret: string): string {
  return createHmac("sha256", secret).update(unsignedToken).digest("base64url");
}

describe("TokenService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates and verifies access tokens while preserving auth claims", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { service, authRepository } = createService({
      role: "owner",
    });

    const token = service.createAccessToken({
      sub: USER_1_ID,
      email: "user@example.com",
      role: "owner",
      deviceId: "device-9",
      tokenVersion: 2,
    });

    const claims = await service.verifyAccessToken(token);

    expect(claims).toMatchObject({
      sub: USER_1_ID,
      email: "user@example.com",
      role: "owner",
      deviceId: "device-9",
      tokenVersion: 2,
      iat: 1_700_000_000,
      exp: 1_700_000_900,
    });
    expect(authRepository.findSessionValidationByUserId).toHaveBeenCalledWith(
      USER_1_ID,
    );
  });

  it("hydrates the current role from storage when the JWT claim is stale", async () => {
    const { service } = createService({
      role: "user",
    });
    const token = service.createAccessToken({
      sub: USER_1_ID,
      role: "admin",
      tokenVersion: 2,
    });

    await expect(service.verifyAccessToken(token)).resolves.toMatchObject({
      sub: USER_1_ID,
      role: "user",
      tokenVersion: 2,
    });
  });

  it("rejects access tokens when the stored token version has changed", async () => {
    const { service } = createService({
      tokenVersion: 3,
    });
    const token = service.createAccessToken({
      sub: USER_1_ID,
      tokenVersion: 2,
    });

    await expect(service.verifyAccessToken(token)).rejects.toMatchObject<
      Partial<UnauthorizedError>
    >({
      message: "Session is no longer valid.",
    });
  });

  it("rejects access tokens when the authenticated user no longer exists", async () => {
    const { service } = createService({
      tokenVersion: null,
    });
    const token = service.createAccessToken({
      sub: MISSING_USER_ID,
      tokenVersion: 2,
    });

    await expect(service.verifyAccessToken(token)).rejects.toMatchObject<
      Partial<UnauthorizedError>
    >({
      message: "Authenticated user could not be found.",
    });
  });

  it("rejects malformed access tokens", async () => {
    const { service } = createService();

    await expect(service.verifyAccessToken("not-a-jwt")).rejects.toThrow(
      "Invalid access token format.",
    );
  });

  it("rejects access tokens with invalid JWT headers even when the signature matches", async () => {
    const accessTokenSecret = "test-access-secret-value-with-32chars";
    const { service } = createService({
      accessTokenSecret,
    });
    const header = toBase64Url({
      alg: "none",
      typ: "JWT",
    });
    const payload = toBase64Url({
      sub: USER_1_ID,
      email: "user@example.com",
      role: "user",
      deviceId: "device-1",
      tokenVersion: 2,
      iat: 1,
      exp: 9_999_999_999,
    });
    const signature = signValue(`${header}.${payload}`, accessTokenSecret);

    await expect(
      service.verifyAccessToken(`${header}.${payload}.${signature}`),
    ).rejects.toThrow("Invalid access token header.");
  });

  it("rejects expired access tokens", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { service } = createService();
    const token = service.createAccessToken({
      sub: USER_1_ID,
      tokenVersion: 2,
    });

    jest.spyOn(Date, "now").mockReturnValue(1_700_000_901_000);

    await expect(service.verifyAccessToken(token)).rejects.toThrow(
      "Access token has expired.",
    );
  });

  it("enforces configured issuer and audience for access tokens", async () => {
    const issuerService = createService({
      issuer: "rent-api",
      audience: "rent-web",
    }).service;
    const verifierService = createService({
      issuer: "rent-api",
      audience: "rent-mobile",
    }).service;
    const token = issuerService.createAccessToken({
      sub: USER_1_ID,
      tokenVersion: 2,
    });

    await expect(verifierService.verifyAccessToken(token)).rejects.toThrow(
      "Access token audience is invalid.",
    );
  });

  it("returns the longer configured refresh TTL when remember me is enabled", () => {
    const { service } = createService();

    expect(service.getRefreshTokenExpiresInSeconds(false)).toBe(2_592_000);
    expect(service.getRefreshTokenExpiresInSeconds(true)).toBe(7_776_000);
  });

  it("creates and verifies stateless refresh tokens with remember-me claims", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { service, authRepository } = createService({
      refreshTokenMode: "stateless",
    });

    const token = await service.createRefreshToken(
      {
        sub: USER_1_ID,
        deviceId: "device-1",
        rememberMe: true,
        tokenVersion: 2,
      },
      {
        expiresInSeconds: service.getRefreshTokenExpiresInSeconds(true),
      },
    );

    const claims = await service.verifyRefreshToken(token);

    expect(claims).toMatchObject({
      sub: USER_1_ID,
      deviceId: "device-1",
      rememberMe: true,
      tokenVersion: 2,
      iat: 1_700_000_000,
      exp: 1_707_776_000,
    });
    expect(typeof claims.jti).toBe("string");
    expect(authRepository.findSessionValidationByUserId).toHaveBeenCalledWith(
      USER_1_ID,
    );
  });

  it("rejects stateless refresh tokens with invalid signatures", async () => {
    const { service } = createService({
      refreshTokenMode: "stateless",
    });
    const token = await service.createRefreshToken({
      sub: USER_1_ID,
      tokenVersion: 2,
    });
    const parts = token.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.not-the-real-signature`;

    await expect(service.verifyRefreshToken(tamperedToken)).rejects.toThrow(
      "Invalid refresh token signature.",
    );
  });

  it("rejects malformed stateless refresh tokens", async () => {
    const { service } = createService({
      refreshTokenMode: "stateless",
    });

    await expect(
      service.verifyRefreshToken("invalid-refresh-token"),
    ).rejects.toThrow("Invalid refresh token format.");
  });

  it("stores, verifies, and revokes stateful refresh token sessions", async () => {
    const { service, cache } = createService({
      refreshTokenMode: "stateful",
      cachePrefix: "test:refresh",
    });
    await service.createSession(
      {
        sessionId: "session-1",
        userId: USER_1_ID,
        deviceId: "device-7",
        tokenVersion: 2,
      },
      120,
    );
    const token = await service.createRefreshToken(
      {
        sub: USER_1_ID,
        deviceId: "device-7",
        sessionId: "session-1",
        tokenVersion: 2,
      },
      {
        expiresInSeconds: 120,
      },
    );
    const parts = token.split(".");
    const body = JSON.parse(
      Buffer.from(parts[1] ?? "", "base64url").toString("utf8"),
    ) as {
      jti: string;
    };

    expect(cache.service.setJson).toHaveBeenCalledTimes(2);
    expect(cache.service.setJson).toHaveBeenNthCalledWith(
      2,
      `test:refresh:${body.jti}`,
      expect.objectContaining({
        sub: USER_1_ID,
        deviceId: "device-7",
      }),
      120,
    );

    await expect(service.verifyRefreshToken(token)).resolves.toMatchObject({
      sub: USER_1_ID,
      deviceId: "device-7",
      sessionId: "session-1",
      tokenVersion: 2,
    });
    await expect(service.revokeRefreshToken(token)).resolves.toBe(true);
    expect(cache.service.setJson).toHaveBeenLastCalledWith(
      `test:refresh:${body.jti}`,
      expect.objectContaining({
        status: "revoked",
      }),
      120,
    );
  });

  it("rejects stateful refresh token revocation when the signature is invalid", async () => {
    const { service } = createService({
      refreshTokenMode: "stateful",
    });
    const token = await service.createRefreshToken({
      sub: USER_1_ID,
      tokenVersion: 2,
    });
    const parts = token.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.not-the-real-signature`;

    await expect(service.revokeRefreshToken(tamperedToken)).rejects.toThrow(
      "Invalid refresh token signature.",
    );
  });

  it("rejects stateful refresh tokens when the cached session is missing", async () => {
    const { service, cache } = createService({
      refreshTokenMode: "stateful",
    });
    const token = await service.createRefreshToken({
      sub: USER_1_ID,
      tokenVersion: 2,
    });
    const cacheKey = [...cache.store.keys()][0];

    cache.store.delete(cacheKey);

    await expect(service.verifyRefreshToken(token)).rejects.toThrow(
      "Refresh token session not found.",
    );
  });

  it("rejects access tokens when the server-side session has been revoked", async () => {
    const { service } = createService();
    await service.createSession(
      {
        sessionId: "session-123",
        userId: USER_1_ID,
        deviceId: "device-1",
        tokenVersion: 2,
      },
      300,
    );
    const token = service.createAccessToken({
      sub: USER_1_ID,
      tokenVersion: 2,
      sessionId: "session-123",
    });

    await service.revokeSession("session-123");

    await expect(service.verifyAccessToken(token)).rejects.toThrow(
      "Session is no longer valid.",
    );
  });

  it("returns the same rotated token during the grace period and revokes the session after a replay outside it", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { service } = createService({
      refreshTokenMode: "stateful",
    });
    await service.createSession(
      {
        sessionId: "session-rotate",
        userId: USER_1_ID,
        deviceId: "device-1",
        tokenVersion: 2,
      },
      120,
    );
    const token = await service.createRefreshToken(
      {
        sub: USER_1_ID,
        deviceId: "device-1",
        sessionId: "session-rotate",
        tokenVersion: 2,
      },
      {
        expiresInSeconds: 120,
      },
    );

    const rotated = await service.rotateRefreshToken(
      token,
      {
        sub: USER_1_ID,
        deviceId: "device-1",
        sessionId: "session-rotate",
        tokenVersion: 2,
      },
      {
        expiresInSeconds: 120,
      },
    );

    await expect(
      service.rotateRefreshToken(
        token,
        {
          sub: USER_1_ID,
          deviceId: "device-1",
          sessionId: "session-rotate",
          tokenVersion: 2,
        },
        {
          expiresInSeconds: 120,
        },
      ),
    ).resolves.toBe(rotated);

    jest.spyOn(Date, "now").mockReturnValue(1_700_000_010_000);

    await expect(
      service.rotateRefreshToken(
        token,
        {
          sub: USER_1_ID,
          deviceId: "device-1",
          sessionId: "session-rotate",
          tokenVersion: 2,
        },
        {
          expiresInSeconds: 120,
        },
      ),
    ).rejects.toThrow("Refresh token has already been used.");
  });

  it("rejects malformed stateful refresh tokens with an unauthorized error", async () => {
    const refreshTokenSecret = "test-refresh-secret-value-with-32chars";
    const { service } = createService({
      refreshTokenMode: "stateful",
      refreshTokenSecret,
    });
    const body = Buffer.from("not-json", "utf8").toString("base64url");
    const signature = signValue(body, refreshTokenSecret);

    await expect(
      service.verifyRefreshToken(`v1.${body}.${signature}`),
    ).rejects.toThrow("Invalid refresh token format.");
  });
});
