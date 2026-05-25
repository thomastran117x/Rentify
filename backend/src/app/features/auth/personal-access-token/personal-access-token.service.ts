import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import BadRequestError from "@/errors/http/bad-request.error";
import UnauthorizedError from "@/errors/http/unauthorized.error";
import { environment } from "@/configuration/environment";
import { normalizeAppRole } from "@/features/auth/auth.model";
import type { PersonalAccessTokenPrincipal } from "@/features/auth/auth.principal";
import type {
  CreatePersonalAccessTokenInput,
  CreatePersonalAccessTokenResult,
  PersonalAccessTokenListResult,
  PersonalAccessTokenRecord,
  PersonalAccessTokenScope,
  PersonalAccessTokenSummary,
  RevokePersonalAccessTokenInput,
  RevokePersonalAccessTokenResult,
} from "./personal-access-token.model";
import { PersonalAccessTokenRepository } from "./personal-access-token.repository";

interface PersonalAccessTokenServiceOptions {
  personalAccessTokenSecret?: string;
}

const PAT_TOKEN_PREFIX = "rpat";
const MCP_READ_SCOPE: PersonalAccessTokenScope = "mcp:read";
const PAT_TOKEN_PATTERN = /^rpat_([a-f0-9]{24})_([a-f0-9]{48})$/;

export class PersonalAccessTokenService {
  private readonly personalAccessTokenSecret?: string;

  constructor(
    private readonly personalAccessTokenRepository: PersonalAccessTokenRepository,
    options: PersonalAccessTokenServiceOptions = {},
  ) {
    this.personalAccessTokenSecret = options.personalAccessTokenSecret;
  }

  async listForUser(userId: string): Promise<PersonalAccessTokenListResult> {
    const tokens =
      await this.personalAccessTokenRepository.listByUserId(userId);

    return {
      tokens: tokens.map((token) => this.toSummary(token)),
    };
  }

  async create(
    input: CreatePersonalAccessTokenInput,
  ): Promise<CreatePersonalAccessTokenResult> {
    const publicId = randomBytes(12).toString("hex");
    const secret = randomBytes(24).toString("hex");
    const tokenValue = `${PAT_TOKEN_PREFIX}_${publicId}_${secret}`;
    const tokenRecord = await this.personalAccessTokenRepository.create({
      userId: input.userId,
      name: input.name,
      publicId,
      tokenPrefix: `${PAT_TOKEN_PREFIX}_${publicId}_${secret.slice(0, 6)}`,
      secretHash: this.hashSecret(publicId, secret),
      scopes: input.scopes,
      ...(input.expiresAt || input.expiresInDays !== undefined
        ? {
            expiresAt: this.resolveExpiresAt(
              input.expiresAt,
              input.expiresInDays,
            ),
          }
        : {}),
    });

    return {
      ...this.toSummary(tokenRecord),
      token: tokenValue,
    };
  }

  async revoke(
    input: RevokePersonalAccessTokenInput,
  ): Promise<RevokePersonalAccessTokenResult> {
    const token = await this.personalAccessTokenRepository.findByIdForUser(
      input.tokenId,
      input.userId,
    );

    if (!token) {
      throw new BadRequestError("Personal access token could not be found.");
    }

    if (!token.revokedAt) {
      await this.personalAccessTokenRepository.revoke(token.id);
    }

    return {
      revoked: true,
      tokenId: token.id,
    };
  }

  async authenticateToken(
    tokenValue: string,
  ): Promise<PersonalAccessTokenPrincipal> {
    const parsedToken = this.parseToken(tokenValue);
    const token = await this.personalAccessTokenRepository.findByPublicId(
      parsedToken.publicId,
    );

    if (!token) {
      throw new UnauthorizedError("Personal access token is invalid.");
    }

    if (token.revokedAt) {
      throw new UnauthorizedError("Personal access token has been revoked.");
    }

    if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) {
      throw new UnauthorizedError("Personal access token has expired.");
    }

    const expectedHash = this.hashSecret(
      parsedToken.publicId,
      parsedToken.secret,
    );

    if (!this.safeEquals(token.secretHash, expectedHash)) {
      throw new UnauthorizedError("Personal access token is invalid.");
    }

    await this.personalAccessTokenRepository.touchLastUsedAt(token.id);

    return {
      sub: token.user.id,
      email: token.user.email,
      role: normalizeAppRole(token.user.role),
      authMethod: "pat",
      scopes: token.scopes,
      personalAccessTokenId: token.id,
      personalAccessTokenName: token.name,
    };
  }

  allowReadScope(): PersonalAccessTokenScope[] {
    return [MCP_READ_SCOPE];
  }

  private toSummary(
    token: PersonalAccessTokenRecord,
  ): PersonalAccessTokenSummary {
    return {
      id: token.id,
      name: token.name,
      tokenPrefix: token.tokenPrefix,
      scopes: token.scopes,
      lastUsedAt: token.lastUsedAt,
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    };
  }

  private parseToken(tokenValue: string): { publicId: string; secret: string } {
    const match = PAT_TOKEN_PATTERN.exec(tokenValue);

    if (!match) {
      throw new UnauthorizedError("Personal access token format is invalid.");
    }

    const [, publicId, secret] = match;
    return {
      publicId,
      secret,
    };
  }

  private hashSecret(publicId: string, secret: string): string {
    return createHmac("sha256", this.getPersonalAccessTokenSecret())
      .update(`${publicId}.${secret}`)
      .digest("hex");
  }

  private safeEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, "utf8");
    const rightBuffer = Buffer.from(right, "utf8");

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private resolveExpiresAt(expiresAt?: string, expiresInDays?: number): Date {
    if (expiresAt) {
      const parsed = new Date(expiresAt);

      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        throw new BadRequestError("expiresAt must be a valid future date.");
      }

      return parsed;
    }

    if (expiresInDays === undefined) {
      throw new BadRequestError("Token expiry is required.");
    }

    const nextExpiration = new Date();
    nextExpiration.setUTCDate(nextExpiration.getUTCDate() + expiresInDays);
    return nextExpiration;
  }

  private getPersonalAccessTokenSecret(): string {
    return (
      this.personalAccessTokenSecret ??
      environment.getTokenConfig().personalAccessTokenSecret
    );
  }
}
