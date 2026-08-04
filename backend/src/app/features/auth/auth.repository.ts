import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import {
  type AuthUserOrganizationMembershipRecord,
  type AppRole,
  type CreateLocalUserInput,
  type AuthUserRecord,
  type OAuthIdentityRecord,
  type OAuthProvider,
  type UserProfileRecord,
  normalizeAppRole,
  oauthProviderSchema,
} from "@/features/auth/auth.model";
import type { VerifiedOAuthProfile } from "@/features/auth/oauth/oauth.types";
import ConflictError from "@/errors/http/conflict.error";

type AuthUserPersistence = {
  id: string;
  email: string;
  passwordHash: string | null;
  tokenVersion: number;
  firstName: string | null;
  lastName: string | null;
  role: string;
  emailVerified: boolean;
  oauthIdentities: OAuthIdentityPersistence[];
  profile: AuthProfilePersistence | null;
  preferredOrganizationId: string | null;
  organizationMemberships: OrganizationMembershipPersistence[];
  createdAt: Date;
  updatedAt: Date;
};

type OrganizationMembershipPersistence = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
  organization: {
    id: string;
    name: string;
  };
};

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

export type MfaVerificationSecurityContext = {
  id: string;
  email: string;
  firstName?: string;
  emailVerified: boolean;
  tokenVersion: number;
  updatedAt: string;
  mfaTotp: {
    status: string;
    updatedAt: string;
    confirmedAt?: string;
  } | null;
};

type AuthProfilePersistence = {
  id: string;
  userId: string;
  username: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  avatarBlobName: string | null;
  isPrivate: boolean;
  recommendationPersonalizationEnabled?: boolean;
  trustworthinessScore: number;
  rentPostingsCount: number;
  availableRentPostingsCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export class AuthRepository extends BaseRepository {
  async findSessionValidationByUserId(
    userId: string,
  ): Promise<{ tokenVersion: number; role: AppRole } | null> {
    const user = await this.executeAsync(() =>
      this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          tokenVersion: true,
          role: true,
        },
      }),
    );

    if (!user) {
      return null;
    }

    return {
      tokenVersion: user.tokenVersion,
      role: normalizeAppRole(user.role),
    };
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    const user = await this.executeAsync(() =>
      this.prisma.user.findUnique({
        where: {
          id,
        },
        include: this.buildAuthUserInclude(),
      }),
    );

    if (!user) {
      return null;
    }

    return this.mapUser(user);
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const user = await this.executeAsync(() =>
      this.prisma.user.findUnique({
        where: {
          email: email.toLowerCase(),
        },
        include: this.buildAuthUserInclude(),
      }),
    );

    if (!user) {
      return null;
    }

    return this.mapUser(user);
  }

  async findUserByUsername(username: string): Promise<AuthUserRecord | null> {
    const user = await this.executeAsync(() =>
      this.prisma.user.findFirst({
        where: {
          profile: {
            is: {
              username: username.toLowerCase(),
            },
          },
        },
        include: this.buildAuthUserInclude(),
      }),
    );

    if (!user) {
      return null;
    }

    return this.mapUser(user);
  }

  async findMfaVerificationSecurityContextByUserId(
    userId: string,
  ): Promise<MfaVerificationSecurityContext | null> {
    const user = await this.executeAsync(() =>
      this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          emailVerified: true,
          tokenVersion: true,
          updatedAt: true,
          mfaTotp: {
            select: {
              status: true,
              updatedAt: true,
              confirmedAt: true,
            },
          },
        },
      }),
    );

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName ?? undefined,
      emailVerified: user.emailVerified,
      tokenVersion: user.tokenVersion,
      updatedAt: user.updatedAt.toISOString(),
      mfaTotp: user.mfaTotp
        ? {
            status: user.mfaTotp.status,
            updatedAt: user.mfaTotp.updatedAt.toISOString(),
            confirmedAt: user.mfaTotp.confirmedAt?.toISOString(),
          }
        : null,
    };
  }

  async createLocalUser(
    input: CreateLocalUserInput,
    passwordHash: string,
  ): Promise<AuthUserRecord> {
    const user = await this.executeAsync(() =>
      this.prisma.user.create({
        data: {
          id: randomUUID(),
          email: input.email.toLowerCase(),
          passwordHash,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          role: "user",
          emailVerified: false,
          profile: {
            create: {
              id: randomUUID(),
              username: input.username.toLowerCase(),
            },
          },
        },
        include: this.buildAuthUserInclude(),
      }),
    );

    return this.mapUser(user);
  }

  async createOAuthUser(input: VerifiedOAuthProfile): Promise<AuthUserRecord> {
    const username = await this.generateAvailableUsername(input.email);

    const user = await this.executeAsync(() =>
      this.prisma.user.create({
        data: {
          id: randomUUID(),
          email: input.email.toLowerCase(),
          passwordHash: null,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          role: "user",
          emailVerified: input.emailVerified,
          oauthIdentities: {
            create: {
              id: randomUUID(),
              provider: input.provider,
              providerUserId: input.providerUserId,
              providerEmail: input.email.toLowerCase(),
              emailVerified: input.emailVerified,
              displayName: this.createDisplayName(input),
            },
          },
          profile: {
            create: {
              id: randomUUID(),
              username,
            },
          },
        },
        include: this.buildAuthUserInclude(),
      }),
    );

    return this.mapUser(user);
  }

  async findUserByOAuthIdentity(
    provider: OAuthProvider,
    providerUserId: string,
  ): Promise<AuthUserRecord | null> {
    const identity = await this.executeAsync(() =>
      this.prisma.oAuthIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider,
            providerUserId,
          },
        },
        include: {
          user: {
            include: this.buildAuthUserInclude(),
          },
        },
      }),
    );

    return identity ? this.mapUser(identity.user) : null;
  }

  async listOAuthIdentitiesByUserId(
    userId: string,
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
    userId: string,
    input: VerifiedOAuthProfile,
  ): Promise<OAuthIdentityRecord> {
    try {
      const identity = await this.executeAsync(() =>
        this.prisma.oAuthIdentity.create({
          data: {
            id: randomUUID(),
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
    userId: string,
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

  async markEmailVerified(userId: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          emailVerified: true,
        },
      }),
    );
  }

  async activatePendingLocalUser(
    userId: string,
    input: {
      username: string;
      passwordHash: string;
      firstName?: string;
      lastName?: string;
    },
  ): Promise<AuthUserRecord> {
    const user = await this.executeAsync(() =>
      this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          passwordHash: input.passwordHash,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          emailVerified: true,
          profile: {
            update: {
              username: input.username.toLowerCase(),
            },
          },
        },
        include: this.buildAuthUserInclude(),
      }),
    );

    return this.mapUser(user);
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          passwordHash,
        },
      }),
    );
  }

  async rotateTokenVersion(userId: string): Promise<number> {
    const user = await this.executeAsync(() =>
      this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          tokenVersion: {
            increment: 1,
          },
        },
        select: {
          tokenVersion: true,
        },
      }),
    );

    return user.tokenVersion;
  }

  async findTokenVersionByUserId(userId: string): Promise<number | null> {
    const sessionValidation = await this.findSessionValidationByUserId(userId);
    return sessionValidation?.tokenVersion ?? null;
  }

  private mapUser(user: AuthUserPersistence): AuthUserRecord {
    if (!user.profile) {
      throw new ConflictError(
        "User profile is missing for the authenticated account.",
      );
    }

    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash ?? undefined,
      tokenVersion: user.tokenVersion,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      role: normalizeAppRole(user.role),
      emailVerified: user.emailVerified,
      profile: this.mapProfile(user.profile),
      oauthIdentities: user.oauthIdentities.map((identity) =>
        this.mapOAuthIdentity(identity),
      ),
      preferredOrganizationId: user.preferredOrganizationId ?? undefined,
      organizationMemberships: user.organizationMemberships.map((membership) =>
        this.mapOrganizationMembership(membership),
      ),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private mapOAuthIdentity(
    identity: OAuthIdentityPersistence,
  ): OAuthIdentityRecord {
    return {
      id: identity.id,
      userId: identity.userId,
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

  private mapProfile(profile: AuthProfilePersistence): UserProfileRecord {
    return {
      id: profile.id,
      userId: profile.userId,
      username: profile.username,
      phoneNumber: profile.phoneNumber ?? undefined,
      avatarUrl: profile.avatarUrl ?? undefined,
      avatarBlobName: profile.avatarBlobName ?? undefined,
      isPrivate: profile.isPrivate,
      recommendationPersonalizationEnabled:
        profile.recommendationPersonalizationEnabled ?? true,
      trustworthinessScore: profile.trustworthinessScore,
      rentPostingsCount: profile.rentPostingsCount,
      availableRentPostingsCount: profile.availableRentPostingsCount,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private async generateAvailableUsername(email: string): Promise<string> {
    const [localPart] = email.toLowerCase().split("@");
    const baseUsername = this.sanitizeUsername(localPart || "user");

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const suffix = attempt === 0 ? "" : `${attempt + 1}`;
      const candidate = `${baseUsername}${suffix}`.slice(0, 50);
      const existingProfile = await this.executeAsync(() =>
        this.prisma.profile.findUnique({
          where: {
            username: candidate,
          },
          select: {
            id: true,
          },
        }),
      );

      if (!existingProfile) {
        return candidate;
      }
    }

    return `${baseUsername.slice(0, 41)}-${randomUUID().slice(0, 8)}`;
  }

  private sanitizeUsername(value: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "");

    return normalized.slice(0, 50) || "user";
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

  private mapOrganizationMembership(
    membership: OrganizationMembershipPersistence,
  ): AuthUserOrganizationMembershipRecord {
    return {
      membershipId: membership.id,
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      role: membership.role as AuthUserOrganizationMembershipRecord["role"],
      createdAt: membership.createdAt.toISOString(),
      updatedAt: membership.updatedAt.toISOString(),
    };
  }

  private buildAuthUserInclude() {
    return {
      profile: true,
      oauthIdentities: true,
      organizationMemberships: {
        include: {
          organization: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc" as const,
        },
      },
    };
  }
}
