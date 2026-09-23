import { Prisma } from "@/generated/prisma/client";
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
import { toDateOfBirthPersistence } from "@/features/auth/date-of-birth";
import ConflictError from "@/errors/http/conflict.error";
import {
  asOptionalUuid,
  asUuid,
  newUuid,
  type Uuid,
} from "@/configuration/validation/uuid";

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

export class OAuthUsernameAllocationConflictError extends Error {
  constructor() {
    super("The generated OAuth username was claimed concurrently.");
    this.name = "OAuthUsernameAllocationConflictError";
  }
}

function isUsernameUniqueConstraintViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const values = Array.isArray(target) ? target : [target];

  return values.some(
    (value) =>
      typeof value === "string" && value.toLowerCase().includes("username"),
  );
}

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

  /**
   * Cheap existence probe for availability checks. Unlike
   * {@link findUserByEmail} this touches only the unique index on
   * `users.email` and never loads the auth user graph.
   */
  async findUserIdByEmail(email: string): Promise<string | null> {
    const user = await this.executeAsync(() =>
      this.prisma.user.findUnique({
        where: {
          email: email.trim().toLowerCase(),
        },
        select: {
          id: true,
        },
      }),
    );

    return user?.id ?? null;
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
          dateOfBirth: toDateOfBirthPersistence(input.dateOfBirth),
          dateOfBirthProvidedAt: new Date(),
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
    username: string,
    dateOfBirth: string,
  ): Promise<AuthUserRecord> {
    try {
      const user = await this.executeAsync(() =>
        this.prisma.user.create({
          data: {
            id: newUuid(),
            email: input.email.toLowerCase(),
            passwordHash: null,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            dateOfBirth: toDateOfBirthPersistence(dateOfBirth),
            dateOfBirthProvidedAt: new Date(),
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
                // Assigned automatically rather than chosen by the user. Its
                // first replacement remains exempt from the rename cooldown.
                usernameAutoGenerated: true,
              },
            },
          },
          include: this.buildAuthUserInclude(),
        }),
      );

      return this.mapUser(user);
    } catch (error) {
      if (isUsernameUniqueConstraintViolation(error)) {
        throw new OAuthUsernameAllocationConflictError();
      }

      throw error;
    }
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

  /**
   * Moves an account to a new address, which the caller has already proven the
   * user can receive mail at.
   *
   * `emailVerified` goes true in the same write. Leaving it false would strip
   * the `email` factor from the account's MFA options — the address was just
   * confirmed by an emailed code, so treating it as unverified would be both
   * wrong and locking.
   *
   * The unique index is what actually decides a race for an address. Redis
   * reservations upstream make the common case answer clearly, but they are
   * advisory; this is the boundary that cannot be beaten.
   */
  async updateUserEmail(userId: Uuid, email: string): Promise<AuthUserRecord> {
    try {
      const user = await this.executeAsync(() =>
        this.prisma.user.update({
          where: {
            id: userId,
          },
          data: {
            email: email.trim().toLowerCase(),
            emailVerified: true,
          },
          include: this.buildAuthUserInclude(),
        }),
      );

      return this.mapUser(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError("That email address is not available.");
      }

      throw error;
    }
  }

  async activatePendingLocalUser(
    userId: Uuid,
    input: {
      username: string;
      passwordHash: string;
      firstName?: string;
      lastName?: string;
      dateOfBirth: string;
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
          dateOfBirth: toDateOfBirthPersistence(input.dateOfBirth),
          dateOfBirthProvidedAt: new Date(),
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
