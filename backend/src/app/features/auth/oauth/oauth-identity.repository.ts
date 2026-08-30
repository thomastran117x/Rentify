import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import {
  type OAuthIdentityRecord,
  type OAuthProvider,
  oauthProviderSchema,
} from "@/features/auth/auth.model";
import type { VerifiedOAuthProfile } from "@/features/auth/oauth/oauth.types";
import ConflictError from "@/errors/http/conflict.error";
import { asUuid, newUuid, type Uuid } from "@/configuration/validation/uuid";

type OAuthIdentityPersistence = {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  providerEmail: string | null;
  emailVerified: boolean;
  displayName: string | null;
  linkedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export class OAuthIdentityRepository extends BaseRepository {
  async listOAuthIdentitiesByUserId(
    userId: Uuid,
  ): Promise<OAuthIdentityRecord[]> {
    const identities = await this.executeAsync(() =>
      this.prisma.oAuthIdentity.findMany({
        where: {
          userId,
        },
        orderBy: {
          linkedAt: "asc",
        },
      }),
    );

    return identities.map((identity) => this.mapOAuthIdentity(identity));
  }

  async linkOAuthIdentity(
    userId: Uuid,
    input: VerifiedOAuthProfile,
  ): Promise<OAuthIdentityRecord> {
    try {
      const identity = await this.executeAsync(() =>
        this.prisma.oAuthIdentity.create({
          data: {
            id: newUuid(),
            userId,
            provider: input.provider,
            providerUserId: input.providerUserId,
            providerEmail: input.email.toLowerCase(),
            emailVerified: input.emailVerified,
            displayName: this.createDisplayName(input),
          },
        }),
      );

      return this.mapOAuthIdentity(identity);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError(
          "This OAuth provider is already linked to an account.",
        );
      }

      throw error;
    }
  }

  async unlinkOAuthIdentity(
    userId: Uuid,
    provider: OAuthProvider,
  ): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.oAuthIdentity.deleteMany({
        where: {
          userId,
          provider,
        },
      }),
    );

    return result.count > 0;
  }

  private mapOAuthIdentity(
    identity: OAuthIdentityPersistence,
  ): OAuthIdentityRecord {
    return {
      id: asUuid(identity.id),
      userId: asUuid(identity.userId),
      provider: oauthProviderSchema.parse(identity.provider),
      providerUserId: identity.providerUserId,
      providerEmail: identity.providerEmail ?? undefined,
      emailVerified: identity.emailVerified,
      displayName: identity.displayName ?? undefined,
      linkedAt: identity.linkedAt.toISOString(),
      createdAt: identity.createdAt.toISOString(),
      updatedAt: identity.updatedAt.toISOString(),
    };
  }

  private createDisplayName(
    input: Pick<VerifiedOAuthProfile, "firstName" | "lastName">,
  ): string | null {
    const displayName = [input.firstName, input.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    return displayName || null;
  }
}
