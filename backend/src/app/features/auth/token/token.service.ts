import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { environment } from "@/configuration/environment";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import type { AppRole } from "@/features/auth/auth.model";
import type { AuthRepository } from "@/features/auth/auth.repository";
import type { CacheService } from "@/features/cache/cache.service";

type RefreshTokenMode = "stateless" | "stateful";

export interface AccessTokenPayload {
  sub: string;
  email?: string;
  role?: AppRole;
  deviceId?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface RefreshTokenPayload {
  sub: string;
  deviceId?: string;
  rememberMe?: boolean;
  tokenVersion?: number;
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
}

interface TokenServiceOptions {
  cache: CacheService;
  authRepository: AuthRepository;
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
  private readonly authRepository: AuthRepository;
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
    this.authRepository = options.authRepository;
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
    };

    await this.cache.setJson(cacheKey, session, expiresInSeconds);

    return token;
  }

  async verifyStatefulRefreshToken(token: string): Promise<RefreshTokenClaims> {
    const [version, body, signature] = token.split(".");

    if (!version || !body || !signature || version !== REFRESH_TOKEN_VERSION) {
      throw new UnauthorizedError("Invalid refresh token format.");
    }

    const claims = JSON.parse(fromBase64Url(body)) as RefreshTokenClaims;
    this.assertRefreshTokenIsValid(claims);

    const session = await this.cache.getJson<StatefulRefreshSession>(
      this.getRefreshCacheKey(claims.jti),
    );

    if (!session) {
      throw new UnauthorizedError("Refresh token session not found.");
    }

    const expectedSignature = signValue(body, this.getRefreshTokenSecret());

    if (
      !safeEquals(signature, expectedSignature) ||
      !safeEquals(signature, session.signature)
    ) {
      throw new UnauthorizedError("Invalid refresh token signature.");
    }

    if (session.sub !== claims.sub || session.deviceId !== claims.deviceId) {
      throw new UnauthorizedError("Refresh token session mismatch.");
    }

    return claims;
  }

  async revokeStatefulRefreshToken(token: string): Promise<boolean> {
    const claims = await this.verifyStatefulRefreshToken(token);
    return this.cache.delete(this.getRefreshCacheKey(claims.jti));
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

  private async getCurrentSessionValidation(
    userId: string,
    tokenVersion?: string | number | boolean | null,
  ): Promise<{ tokenVersion: number; role: AppRole }> {
    const sessionValidation =
      await this.authRepository.findSessionValidationByUserId(userId);
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
    userId: string,
    tokenVersion?: string | number | boolean | null,
  ): Promise<void> {
    await this.getCurrentSessionValidation(userId, tokenVersion);
  }

  private getRefreshCacheKey(jti: string): string {
    return `${this.getRefreshTokenCachePrefix()}:${jti}`;
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
