import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { environment } from "@/configuration/environment";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { AppRole } from "@/features/auth/auth.model";
import type { TokenRepository } from "@/features/auth/token/token.repository";
import type { CacheService } from "@/features/cache/cache.service";
import { type Uuid } from "@/configuration/validation/uuid";

type RefreshTokenMode = "stateless" | "stateful";

export interface AccessTokenPayload {
  // The authenticated user's id. Trusted because the token's HMAC signature is
  // verified before the claims are read, and we minted `sub` from `user.id`.
  sub: Uuid;
  email?: string;
  role?: AppRole;
  deviceId?: string;
  sessionId?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface RefreshTokenPayload {
  sub: Uuid;
  deviceId?: string;
  rememberMe?: boolean;
  tokenVersion?: number;
  sessionId?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface JwtClaims extends AccessTokenPayload {
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
}

interface RefreshTokenClaims extends RefreshTokenPayload {
  iat: number;
  exp: number;
  jti: string;
}

interface StatefulRefreshSession extends RefreshTokenClaims {
  signature: string;
  status: "active" | "consumed" | "revoked";
  rotatedAt?: number;
  replacementToken?: string;
}

interface TokenServiceOptions {
  cache: CacheService;
  tokenRepository: TokenRepository;
  accessTokenSecret?: string;
  refreshTokenSecret?: string;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  issuer?: string;
  audience?: string;
  refreshTokenMode?: RefreshTokenMode;
  refreshTokenCachePrefix?: string;
}

interface CreateRefreshTokenOptions {
  expiresInSeconds?: number;
}

const ACCESS_TOKEN_ALGORITHM = "HS256";
const REFRESH_TOKEN_VERSION = "v1";
const REFRESH_SESSION_LOCK_TTL_IN_MS = 5_000;
const REFRESH_ROTATION_GRACE_PERIOD_SECONDS = 5;
const SESSION_CACHE_PREFIX = "auth:session";

export interface AuthSessionState {
  sessionId: string;
  userId: Uuid;
  deviceId?: string;
  tokenVersion: number;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
}

function toBase64Url(value: string | Buffer): string {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buffer.toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export class TokenService {
  private readonly cache: CacheService;
  private readonly tokenRepository: TokenRepository;
  private readonly accessTokenSecret?: string;
  private readonly refreshTokenSecret?: string;
  private readonly accessTokenTtlSeconds?: number;
  private readonly refreshTokenTtlSeconds?: number;
  private readonly issuer?: string;
  private readonly audience?: string;
  private readonly refreshTokenMode?: RefreshTokenMode;
  private readonly refreshTokenCachePrefix?: string;

  constructor(options: TokenServiceOptions) {
    this.cache = options.cache;
    this.tokenRepository = options.tokenRepository;
    this.accessTokenSecret = options.accessTokenSecret;
    this.refreshTokenSecret = options.refreshTokenSecret;
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds;
    this.refreshTokenTtlSeconds = options.refreshTokenTtlSeconds;
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.refreshTokenMode = options.refreshTokenMode;
    this.refreshTokenCachePrefix = options.refreshTokenCachePrefix;
  }

  createAccessToken(payload: AccessTokenPayload): string {
    const now = Math.floor(Date.now() / 1000);
    const claims: JwtClaims = {
      ...payload,
      iat: now,
      exp: now + this.getAccessTokenTtlSeconds(),
      ...(this.getIssuer() ? { iss: this.getIssuer() } : {}),
      ...(this.getAudience() ? { aud: this.getAudience() } : {}),
    };

    return this.signJwt(claims);
  }

  async verifyAccessToken(token: string): Promise<JwtClaims> {
    const claims = this.verifyJwt(token);
    const sessionValidation = await this.getCurrentSessionValidation(
      claims.sub,
      claims.tokenVersion,
    );
    await this.assertSessionIsActive(claims.sub, claims.sessionId);

    return {
      ...claims,
      role: sessionValidation.role,
    };
  }

  getAccessTokenExpiresInSeconds(): number {
    return this.getAccessTokenTtlSeconds();
  }

  getRefreshTokenExpiresInSeconds(rememberMe = false): number {
    return rememberMe
      ? this.getRememberMeRefreshTokenTtlSeconds()
      : this.getRefreshTokenTtlSeconds();
  }

  async createRefreshToken(
    payload: RefreshTokenPayload,
    options: CreateRefreshTokenOptions = {},
  ): Promise<string> {
    if (this.getRefreshTokenMode() === "stateful") {
      return this.createStatefulRefreshToken(payload, options.expiresInSeconds);
    }

    return this.createStatelessRefreshToken(payload, options.expiresInSeconds);
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    if (this.getRefreshTokenMode() === "stateful") {
      const claims = await this.verifyStatefulRefreshToken(token);
      await this.assertTokenVersionIsCurrent(claims.sub, claims.tokenVersion);
      return claims;
    }

    const claims = this.verifyStatelessRefreshToken(token);
    await this.assertTokenVersionIsCurrent(claims.sub, claims.tokenVersion);
    return claims;
  }

  async revokeRefreshToken(token: string): Promise<boolean> {
    if (this.getRefreshTokenMode() === "stateful") {
      return this.revokeStatefulRefreshToken(token);
    }

    return false;
  }

  async createSession(
    state: Omit<AuthSessionState, "createdAt" | "updatedAt" | "status">,
    ttlInSeconds: number,
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.cache.setJson(
      this.getSessionCacheKey(state.sessionId),
      {
        ...state,
        status: "active",
        createdAt: now,
        updatedAt: now,
      } satisfies AuthSessionState,
      ttlInSeconds,
    );
  }

  async revokeSession(sessionId?: string): Promise<boolean> {
    if (!sessionId) {
      return false;
    }

    const cacheKey = this.getSessionCacheKey(sessionId);
    const session = await this.cache.getJson<AuthSessionState>(cacheKey);

    if (!session) {
      return false;
    }

    await this.cache.setJson(
      cacheKey,
      {
        ...session,
        status: "revoked",
        updatedAt: new Date().toISOString(),
      } satisfies AuthSessionState,
      await this.getRemainingTtlInSeconds(cacheKey),
    );

    return true;
  }

  async revokeSessionsForDevice(
    userId: Uuid,
    deviceId: string,
  ): Promise<number> {
    const sessionKeys = await this.cache.scanKeys(this.getSessionScanPattern());
    let revokedCount = 0;

    for (const sessionKey of sessionKeys) {
      const session = await this.cache.getJson<AuthSessionState>(sessionKey);

      if (
        !session ||
        session.userId !== userId ||
        session.deviceId !== deviceId ||
        session.status === "revoked"
      ) {
        continue;
      }

      await this.cache.setJson(
        sessionKey,
        {
          ...session,
          status: "revoked",
          updatedAt: new Date().toISOString(),
        } satisfies AuthSessionState,
        await this.getRemainingTtlInSeconds(sessionKey),
      );
      revokedCount += 1;
    }

    return revokedCount;
  }

  async rotateRefreshToken(
    token: string,
    payload: RefreshTokenPayload,
    options: CreateRefreshTokenOptions = {},
  ): Promise<string> {
    if (this.getRefreshTokenMode() !== "stateful") {
      throw new UnauthorizedError(
        "Refresh token rotation requires stateful mode.",
      );
    }

    const { claims } = this.parseAndVerifyRefreshTokenSignature(token);
    const sessionId = claims.sessionId ?? payload.sessionId;

    if (!sessionId) {
      throw new UnauthorizedError("Refresh token session is invalid.");
    }

    await this.assertTokenVersionIsCurrent(claims.sub, claims.tokenVersion);
    await this.assertSessionIsActive(claims.sub, sessionId);

    return this.cache.withLock(
      this.getRefreshRotationLockKey(claims.jti),
      REFRESH_SESSION_LOCK_TTL_IN_MS,
      async () => {
        const currentRecord = await this.cache.getJson<StatefulRefreshSession>(
          this.getRefreshCacheKey(claims.jti),
        );

        if (!currentRecord) {
          throw new UnauthorizedError("Refresh token session not found.");
        }

        if (
          currentRecord.sub !== claims.sub ||
          currentRecord.deviceId !== claims.deviceId
        ) {
          await this.revokeSession(sessionId);
          throw new UnauthorizedError("Refresh token session mismatch.");
        }

        if (currentRecord.status === "consumed") {
          if (this.isWithinRefreshRotationGracePeriod(currentRecord)) {
            return currentRecord.replacementToken;
          }

          await this.revokeSession(sessionId);
          throw new UnauthorizedError("Refresh token has already been used.");
        }

        if (currentRecord.status !== "active") {
          await this.revokeSession(sessionId);
          throw new UnauthorizedError("Refresh token is no longer valid.");
        }

        const expiresInSeconds =
          options.expiresInSeconds ?? this.getRefreshTokenTtlSeconds();
        const nextToken = await this.createStatefulRefreshToken(
          {
            ...payload,
            sessionId,
          },
          expiresInSeconds,
        );

        await this.cache.setJson(
          this.getRefreshCacheKey(claims.jti),
          {
            ...currentRecord,
            status: "consumed",
            rotatedAt: Math.floor(Date.now() / 1000),
            replacementToken: nextToken,
          } satisfies StatefulRefreshSession,
          await this.getRemainingTtlInSeconds(
            this.getRefreshCacheKey(claims.jti),
          ),
        );
        await this.extendSession(sessionId, payload, expiresInSeconds);

        return nextToken;
      },
    );
  }

  createStatelessRefreshToken(
    payload: RefreshTokenPayload,
    expiresInSeconds = this.getRefreshTokenTtlSeconds(),
  ): string {
    const claims = this.buildRefreshClaims(payload, expiresInSeconds);
    const body = toBase64Url(JSON.stringify(claims));
    const signature = signValue(body, this.getRefreshTokenSecret());

    return `${REFRESH_TOKEN_VERSION}.${body}.${signature}`;
  }

  verifyStatelessRefreshToken(token: string): RefreshTokenClaims {
    const [version, body, signature] = token.split(".");

    if (!version || !body || !signature || version !== REFRESH_TOKEN_VERSION) {
      throw new UnauthorizedError("Invalid refresh token format.");
    }

    const expectedSignature = signValue(body, this.getRefreshTokenSecret());

    if (!safeEquals(signature, expectedSignature)) {
      throw new UnauthorizedError("Invalid refresh token signature.");
    }

    const claims = JSON.parse(fromBase64Url(body)) as RefreshTokenClaims;
    this.assertRefreshTokenIsValid(claims);

    return claims;
  }

  async createStatefulRefreshToken(
    payload: RefreshTokenPayload,
    expiresInSeconds = this.getRefreshTokenTtlSeconds(),
  ): Promise<string> {
    const claims = this.buildRefreshClaims(payload, expiresInSeconds);
    const body = toBase64Url(JSON.stringify(claims));
    const signature = signValue(body, this.getRefreshTokenSecret());
    const token = `${REFRESH_TOKEN_VERSION}.${body}.${signature}`;
    const cacheKey = this.getRefreshCacheKey(claims.jti);
    const session: StatefulRefreshSession = {
      ...claims,
      signature,
      status: "active",
    };

    await this.cache.setJson(cacheKey, session, expiresInSeconds);

    return token;
  }

  async verifyStatefulRefreshToken(token: string): Promise<RefreshTokenClaims> {
    const { claims, signature } =
      this.parseAndVerifyRefreshTokenSignature(token);
    await this.assertSessionIsActive(claims.sub, claims.sessionId);

    const session = await this.cache.getJson<StatefulRefreshSession>(
      this.getRefreshCacheKey(claims.jti),
    );

    if (!session) {
      throw new UnauthorizedError("Refresh token session not found.");
    }

    if (!safeEquals(signature, session.signature)) {
      throw new UnauthorizedError("Invalid refresh token signature.");
    }

    if (
      session.status !== "active" ||
      session.sub !== claims.sub ||
      session.deviceId !== claims.deviceId
    ) {
      throw new UnauthorizedError("Refresh token session mismatch.");
    }

    return claims;
  }

  async revokeStatefulRefreshToken(token: string): Promise<boolean> {
    const { claims } = this.parseAndVerifyRefreshTokenSignature(token);
    const cacheKey = this.getRefreshCacheKey(claims.jti);
    const session = await this.cache.getJson<StatefulRefreshSession>(cacheKey);

    if (!session) {
      return false;
    }

    await this.cache.setJson(
      cacheKey,
      {
        ...session,
        status: "revoked",
      } satisfies StatefulRefreshSession,
      await this.getRemainingTtlInSeconds(cacheKey),
    );

    return true;
  }

  private signJwt(payload: JwtClaims): string {
    const header = {
      alg: ACCESS_TOKEN_ALGORITHM,
      typ: "JWT",
    };

    const encodedHeader = toBase64Url(JSON.stringify(header));
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const signature = signValue(unsignedToken, this.getAccessTokenSecret());

    return `${unsignedToken}.${signature}`;
  }

  private verifyJwt(token: string): JwtClaims {
    const [encodedHeader, encodedPayload, signature] = token.split(".");

    if (!encodedHeader || !encodedPayload || !signature) {
      throw new UnauthorizedError("Invalid access token format.");
    }

    const expectedSignature = signValue(
      `${encodedHeader}.${encodedPayload}`,
      this.getAccessTokenSecret(),
    );

    if (!safeEquals(signature, expectedSignature)) {
      throw new UnauthorizedError("Invalid access token signature.");
    }

    const header = JSON.parse(fromBase64Url(encodedHeader)) as {
      alg?: string;
      typ?: string;
    };

    if (header.alg !== ACCESS_TOKEN_ALGORITHM || header.typ !== "JWT") {
      throw new UnauthorizedError("Invalid access token header.");
    }

    const claims = JSON.parse(fromBase64Url(encodedPayload)) as JwtClaims;
    const now = Math.floor(Date.now() / 1000);

    if (claims.exp <= now) {
      throw new UnauthorizedError("Access token has expired.");
    }

    if (this.getIssuer() && claims.iss !== this.getIssuer()) {
      throw new UnauthorizedError("Access token issuer is invalid.");
    }

    if (this.getAudience() && claims.aud !== this.getAudience()) {
      throw new UnauthorizedError("Access token audience is invalid.");
    }

    return claims;
  }

  private buildRefreshClaims(
    payload: RefreshTokenPayload,
    expiresInSeconds = this.getRefreshTokenTtlSeconds(),
  ): RefreshTokenClaims {
    const now = Math.floor(Date.now() / 1000);

    return {
      ...payload,
      iat: now,
      exp: now + expiresInSeconds,
      jti: randomBytes(32).toString("base64url"),
    };
  }

  private assertRefreshTokenIsValid(claims: RefreshTokenClaims): void {
    const now = Math.floor(Date.now() / 1000);

    if (claims.exp <= now) {
      throw new UnauthorizedError("Refresh token has expired.");
    }
  }

  /**
   * Re-runs the session checks `verifyAccessToken` performs, without a token.
   *
   * A WebSocket outlives the access token that opened it, so it cannot keep
   * re-verifying that token: it would start failing on expiry while the session
   * behind it is perfectly healthy. This asks the question that actually
   * matters for a long-lived connection — is this session still active, and is
   * its token version still current — so a logout, a password change or a
   * revoked session closes the socket instead of leaving it streaming.
   */
  async assertSessionIsUsable(
    userId: Uuid,
    sessionId?: string | null,
    tokenVersion?: number | null,
  ): Promise<void> {
    await this.getCurrentSessionValidation(userId, tokenVersion);
    await this.assertSessionIsActive(userId, sessionId);
  }

  private async getCurrentSessionValidation(
    userId: Uuid,
    tokenVersion?: string | number | boolean | null,
  ): Promise<{ tokenVersion: number; role: AppRole }> {
    const sessionValidation =
      await this.tokenRepository.findSessionValidationByUserId(userId);
    const normalizedTokenVersion =
      typeof tokenVersion === "number" ? tokenVersion : 0;

    if (!sessionValidation) {
      throw new UnauthorizedError("Authenticated user could not be found.");
    }

    if (normalizedTokenVersion !== sessionValidation.tokenVersion) {
      throw new UnauthorizedError("Session is no longer valid.");
    }

    return sessionValidation;
  }

  private async assertTokenVersionIsCurrent(
    userId: Uuid,
    tokenVersion?: string | number | boolean | null,
  ): Promise<void> {
    await this.getCurrentSessionValidation(userId, tokenVersion);
  }

  private async assertSessionIsActive(
    userId: Uuid,
    sessionId?: string | number | boolean | null,
  ): Promise<void> {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return;
    }

    const session = await this.cache.getJson<AuthSessionState>(
      this.getSessionCacheKey(sessionId),
    );

    if (!session || session.userId !== userId || session.status !== "active") {
      throw new UnauthorizedError("Session is no longer valid.");
    }
  }

  private async extendSession(
    sessionId: string,
    payload: RefreshTokenPayload,
    ttlInSeconds: number,
  ): Promise<void> {
    const cacheKey = this.getSessionCacheKey(sessionId);
    const session = await this.cache.getJson<AuthSessionState>(cacheKey);

    if (!session) {
      throw new UnauthorizedError("Session is no longer valid.");
    }

    await this.cache.setJson(
      cacheKey,
      {
        ...session,
        deviceId: payload.deviceId,
        tokenVersion:
          typeof payload.tokenVersion === "number"
            ? payload.tokenVersion
            : session.tokenVersion,
        updatedAt: new Date().toISOString(),
      } satisfies AuthSessionState,
      ttlInSeconds,
    );
  }

  private parseAndVerifyRefreshTokenSignature(token: string): {
    claims: RefreshTokenClaims;
    signature: string;
  } {
    const [version, body, signature] = token.split(".");

    if (!version || !body || !signature || version !== REFRESH_TOKEN_VERSION) {
      throw new UnauthorizedError("Invalid refresh token format.");
    }

    const expectedSignature = signValue(body, this.getRefreshTokenSecret());

    if (!safeEquals(signature, expectedSignature)) {
      throw new UnauthorizedError("Invalid refresh token signature.");
    }

    try {
      const claims = JSON.parse(fromBase64Url(body)) as RefreshTokenClaims;
      this.assertRefreshTokenIsValid(claims);

      return {
        claims,
        signature,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }

      throw new UnauthorizedError("Invalid refresh token format.");
    }
  }

  private isWithinRefreshRotationGracePeriod(
    session: StatefulRefreshSession,
  ): session is StatefulRefreshSession & { replacementToken: string } {
    if (!session.replacementToken || !session.rotatedAt) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    return now - session.rotatedAt <= REFRESH_ROTATION_GRACE_PERIOD_SECONDS;
  }

  private getRefreshCacheKey(jti: string): string {
    return `${this.getRefreshTokenCachePrefix()}:${jti}`;
  }

  private getSessionCacheKey(sessionId: string): string {
    return `${SESSION_CACHE_PREFIX}:${sessionId}`;
  }

  private getSessionScanPattern(): string {
    return `${SESSION_CACHE_PREFIX}:*`;
  }

  private getRefreshRotationLockKey(jti: string): string {
    return `refresh-rotate:${jti}`;
  }

  private async getRemainingTtlInSeconds(key: string): Promise<number> {
    const ttl = await this.cache.ttl(key);
    return ttl > 0 ? ttl : 1;
  }

  private getAccessTokenSecret(): string {
    return (
      this.accessTokenSecret ?? environment.getTokenConfig().accessTokenSecret
    );
  }

  private getRefreshTokenSecret(): string {
    return (
      this.refreshTokenSecret ?? environment.getTokenConfig().refreshTokenSecret
    );
  }

  private getAccessTokenTtlSeconds(): number {
    return (
      this.accessTokenTtlSeconds ??
      environment.getTokenConfig().accessTokenTtlSeconds
    );
  }

  private getRefreshTokenTtlSeconds(): number {
    return (
      this.refreshTokenTtlSeconds ??
      environment.getTokenConfig().refreshTokenTtlSeconds
    );
  }

  private getRememberMeRefreshTokenTtlSeconds(): number {
    return environment.getTokenConfig().rememberMeRefreshTokenTtlSeconds;
  }

  private getIssuer(): string | undefined {
    return this.issuer ?? environment.getTokenConfig().issuer;
  }

  private getAudience(): string | undefined {
    return this.audience ?? environment.getTokenConfig().audience;
  }

  private getRefreshTokenMode(): RefreshTokenMode {
    return (
      this.refreshTokenMode ?? environment.getTokenConfig().refreshTokenMode
    );
  }

  private getRefreshTokenCachePrefix(): string {
    return (
      this.refreshTokenCachePrefix ??
      environment.getTokenConfig().refreshTokenCachePrefix
    );
  }
}
