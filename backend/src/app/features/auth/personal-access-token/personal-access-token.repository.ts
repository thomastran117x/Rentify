import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  PersonalAccessTokenRecord,
  PersonalAccessTokenScope,
} from "./personal-access-token.model";

type PersonalAccessTokenPersistence = {
  id: string;
  userId: string;
  name: string;
  publicId: string;
  tokenPrefix: string;
  secretHash: string;
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
  };
};

export class PersonalAccessTokenRepository extends BaseRepository {
  async create(input: {
    userId: string;
    name: string;
    publicId: string;
    tokenPrefix: string;
    secretHash: string;
    scopes: PersonalAccessTokenScope[];
    expiresAt?: Date;
  }): Promise<PersonalAccessTokenRecord> {
    const token = await this.executeAsync(() =>
      this.prisma.personalAccessToken.create({
        data: {
          id: randomUUID(),
          userId: input.userId,
          name: input.name,
          publicId: input.publicId,
          tokenPrefix: input.tokenPrefix,
          secretHash: input.secretHash,
          scopes: input.scopes,
          expiresAt: input.expiresAt ?? null,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
            },
          },
        },
      }),
    );

    return this.mapToken(token);
  }

  async listByUserId(userId: string): Promise<PersonalAccessTokenRecord[]> {
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
            },
          },
        },
      }),
    );

    return tokens.map((token) => this.mapToken(token));
  }

  async findByIdForUser(
    tokenId: string,
    userId: string,
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

  async touchLastUsedAt(tokenId: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.personalAccessToken.update({
        where: {
          id: tokenId,
        },
        data: {
          lastUsedAt: new Date(),
        },
      }),
    );
  }

  private mapToken(
    token: PersonalAccessTokenPersistence,
  ): PersonalAccessTokenRecord {
    return {
      id: token.id,
      userId: token.userId,
      name: token.name,
      publicId: token.publicId,
      tokenPrefix: token.tokenPrefix,
      secretHash: token.secretHash,
      scopes: this.parseScopes(token.scopes),
      lastUsedAt: token.lastUsedAt?.toISOString(),
      expiresAt: token.expiresAt?.toISOString(),
      revokedAt: token.revokedAt?.toISOString(),
      createdAt: token.createdAt.toISOString(),
      updatedAt: token.updatedAt.toISOString(),
      user: {
        id: token.user.id,
        email: token.user.email,
        role: token.user.role,
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
