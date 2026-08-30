import { randomUUID } from "node:crypto";
import { BaseRepository } from "@/features/base/base.repository";
import {
  type AuthUserOrganizationMembershipRecord,
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
import { asOptionalUuid, asUuid, newUuid, type Uuid } from "@/configuration/validation/uuid";

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

/**
 * Screens generated username candidates. True means "believed taken, do not
 * bother probing"; false covers both "believed free" and "no opinion", so an
 * unavailable filter simply restores the unscreened behaviour.
 */
export type UsernameLikelyTakenPredicate = (candidate: string) => boolean;

export class UsersRepository extends BaseRepository {
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

  /**
   * Cheap existence probe for availability checks. Unlike
   * {@link findUserByUsername} this touches only the unique index on
   * `profiles.username` and never loads the auth user graph.
   */
  async findUserIdByUsername(username: string): Promise<string | null> {
    const profile = await this.executeAsync(() =>
      this.prisma.profile.findUnique({
        where: {
          username: username.trim().toLowerCase(),
        },
        select: {
          userId: true,
        },
      }),
    );

    return profile?.userId ?? null;
  }

  async createLocalUser(
    input: CreateLocalUserInput,
    passwordHash: string,
  ): Promise<AuthUserRecord> {
    const user = await this.executeAsync(() =>
      this.prisma.user.create({
        data: {
          id: newUuid(),
          email: input.email.toLowerCase(),
          passwordHash,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          role: "user",
          emailVerified: false,
          profile: {
            create: {
              id: newUuid(),
              username: input.username.toLowerCase(),
            },
          },
        },
        include: this.buildAuthUserInclude(),
      }),
    );

    return this.mapUser(user);
  }

  async createOAuthUser(
    input: VerifiedOAuthProfile,
    isLikelyTaken?: UsernameLikelyTakenPredicate,
  ): Promise<AuthUserRecord> {
    const username = await this.generateAvailableUsername(
      input.email,
      isLikelyTaken,
    );

    const user = await this.executeAsync(() =>
      this.prisma.user.create({
        data: {
          id: newUuid(),
          email: input.email.toLowerCase(),
          passwordHash: null,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          role: "user",
          emailVerified: input.emailVerified,
          oauthIdentities: {
            create: {
              id: newUuid(),
              provider: input.provider,
              providerUserId: input.providerUserId,
              providerEmail: input.email.toLowerCase(),
              emailVerified: input.emailVerified,
              displayName: this.createDisplayName(input),
            },
          },
          profile: {
            create: {
              id: newUuid(),
              username,
              // Derived from the email local part, not chosen. Replacing it is
              // a claim rather than a change, so it does not start the rename
              // cooldown. See features/profile/username-change-policy.ts.
              usernameAutoGenerated: true,
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

  async markEmailVerified(userId: Uuid): Promise<void> {
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
    userId: Uuid,
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

  private mapUser(user: AuthUserPersistence): AuthUserRecord {
    if (!user.profile) {
      throw new ConflictError(
        "User profile is missing for the authenticated account.",
      );
    }

    return {
      id: asUuid(user.id),
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
      preferredOrganizationId: asOptionalUuid(user.preferredOrganizationId),
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

  private mapProfile(profile: AuthProfilePersistence): UserProfileRecord {
    return {
      id: asUuid(profile.id),
      userId: asUuid(profile.userId),
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

  /**
   * Finds an unclaimed username derived from the email local part.
   *
   * `isLikelyTaken` lets a caller pre-screen candidates against the username
   * bloom filter so the obviously-taken ones cost nothing — a popular local
   * part like `john` could previously spend 25 sequential queries walking
   * `john`, `john2`, `john3`… on a single OAuth signup.
   *
   * The predicate must be true only when the filter positively believes the
   * name is taken. An "I do not know" answer has to read as false, or an
   * unavailable filter would skip every candidate and push every new OAuth user
   * onto the random-suffix fallback below.
   *
   * The confirming probe is deliberately kept: this is a write path, and the
   * filter's freshness is a cache property rather than a guarantee.
   */
  private async generateAvailableUsername(
    email: string,
    isLikelyTaken?: UsernameLikelyTakenPredicate,
  ): Promise<string> {
    const [localPart] = email.toLowerCase().split("@");
    const baseUsername = this.sanitizeUsername(localPart || "user");

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const suffix = attempt === 0 ? "" : `${attempt + 1}`;
      const candidate = `${baseUsername}${suffix}`.slice(0, 50);

      if (isLikelyTaken?.(candidate)) {
        continue;
      }

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
      membershipId: asUuid(membership.id),
      organizationId: asUuid(membership.organizationId),
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
