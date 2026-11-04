import type { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  PersonalAccessTokenRecord,
  PersonalAccessTokenScope,
} from "./personal-access-token.model";
import { asUuid, newUuid, type Uuid } from "@/configuration/validation/uuid";
import { normalizeAccountStatus } from "@/features/auth/auth.model";

type PersonalAccessTokenPersistence = {
  id: string;
  userId: string;
  name: string;
  publicId: string;
  tokenPrefix: string;
  secretHash: string;
  secretKid: string;
  scopes: Prisma.JsonValue;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    email: string;
    role: string;
    status: string;
  };
};

export class PersonalAccessTokenRepository extends BaseRepository {
  async create(input: {
    userId: Uuid;
    name: string;
    publicId: string;
    tokenPrefix: string;
    secretHash: string;
    secretKid: string;
    scopes: PersonalAccessTokenScope[];
    expiresAt?: Date;
  }): Promise<PersonalAccessTokenRecord> {
    const token = await this.executeAsync(() =>
      this.prisma.personalAccessToken.create({
        data: {
          id: newUuid(),
          userId: input.userId,
          name: input.name,
          publicId: input.publicId,
          tokenPrefix: input.tokenPrefix,
          secretHash: input.secretHash,
          secretKid: input.secretKid,
          scopes: input.scopes,
          expiresAt: input.expiresAt ?? null,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
            },
          },
        },
      }),
    );

    return this.mapToken(token);
  }

  async listByUserId(userId: Uuid): Promise<PersonalAccessTokenRecord[]> {
    const tokens = await this.executeAsync(() =>
      this.prisma.personalAccessToken.findMany({
        where: {
          userId,
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
            },
          },
        },
      }),
    );

    return tokens.map((token) => this.mapToken(token));
  }

  async findByIdForUser(
    tokenId: string,
    userId: Uuid,
  ): Promise<PersonalAccessTokenRecord | null> {
    const token = await this.executeAsync(() =>
      this.prisma.personalAccessToken.findFirst({
        where: {
          id: tokenId,
          userId,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
            },
          },
        },
      }),
    );

    return token ? this.mapToken(token) : null;
  }

  async findByPublicId(
    publicId: string,
  ): Promise<PersonalAccessTokenRecord | null> {
    const token = await this.executeAsync(() =>
      this.prisma.personalAccessToken.findUnique({
        where: {
          publicId,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              status: true,
            },
          },
        },
      }),
    );

    return token ? this.mapToken(token) : null;
  }

  async revoke(tokenId: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.personalAccessToken.update({
        where: {
          id: tokenId,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
    );
  }

  /**
   * Records a use. `rehash` moves a token hashed with a previous key onto the
   * current key in the same write.
   */
  async touchLastUsedAt(
    tokenId: string,
    rehash?: { secretHash: string; secretKid: string },
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.personalAccessToken.update({
        where: {
          id: tokenId,
        },
        data: {
          lastUsedAt: new Date(),
          ...rehash,
        },
      }),
    );
  }

  private mapToken(
    token: PersonalAccessTokenPersistence,
  ): PersonalAccessTokenRecord {
    return {
      id: asUuid(token.id),
      userId: asUuid(token.userId),
      name: token.name,
      publicId: token.publicId,
      tokenPrefix: token.tokenPrefix,
      secretHash: token.secretHash,
      secretKid: token.secretKid,
      scopes: this.parseScopes(token.scopes),
      lastUsedAt: token.lastUsedAt?.toISOString(),
      expiresAt: token.expiresAt?.toISOString(),
      revokedAt: token.revokedAt?.toISOString(),
      createdAt: token.createdAt.toISOString(),
      updatedAt: token.updatedAt.toISOString(),
      user: {
        id: asUuid(token.user.id),
        email: token.user.email,
        role: token.user.role,
        status: normalizeAccountStatus(token.user.status),
      },
    };
  }

  private parseScopes(value: Prisma.JsonValue): PersonalAccessTokenScope[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (entry): entry is PersonalAccessTokenScope =>
        entry === "mcp:read" || entry === "mcp:write",
    );
  }
}
