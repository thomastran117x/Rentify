import { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import ConflictError from "@/errors/http/conflict.error";
import type {
  ListProfilesInput,
  ListProfilesResult,
  ProfileRecord,
  PublicProfileRecord,
  UpdateProfileInput,
} from "@/features/profile/profile.model";

type ProfilePersistence = {
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
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
};

export class ProfileRepository extends BaseRepository {
  async findPublicProfiles(
    input: ListProfilesInput,
  ): Promise<ListProfilesResult> {
    const where: Prisma.ProfileWhereInput = {
      isPrivate: false,
      ...(input.query
        ? {
            OR: [
              {
                username: {
                  contains: input.query,
                },
              },
              {
                phoneNumber: {
                  contains: input.query,
                },
              },
              {
                user: {
                  is: {
                    email: {
                      contains: input.query,
                    },
                  },
                },
              },
              {
                user: {
                  is: {
                    firstName: {
                      contains: input.query,
                    },
                  },
                },
              },
              {
                user: {
                  is: {
                    lastName: {
                      contains: input.query,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const skip = (input.page - 1) * input.pageSize;

    const [profiles, total] = await Promise.all([
      this.executeAsync(() =>
        this.prisma.profile.findMany({
          where,
          skip,
          take: input.pageSize,
          orderBy: [
            {
              trustworthinessScore: "desc",
            },
            {
              username: "asc",
            },
          ],
          include: {
            user: {
              select: {
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
      ),
      this.executeAsync(() => this.prisma.profile.count({ where })),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / input.pageSize));

    return {
      profiles: profiles.map((profile) => this.mapPublicProfile(profile)),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages,
        hasNextPage: input.page < totalPages,
        hasPreviousPage: input.page > 1,
      },
      ...(input.query ? { query: input.query } : {}),
    };
  }

  async findByUserId(userId: string): Promise<ProfileRecord | null> {
    const profile = await this.executeAsync(() =>
      this.prisma.profile.findUnique({
        where: {
          userId,
        },
        include: {
          user: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
    );

    if (!profile) {
      return null;
    }

    return this.mapProfile(profile);
  }

  async findRecommendationPersonalizationEnabledByUserId(
    userId: string,
  ): Promise<boolean | null> {
    const prismaProfile = this.prisma.profile as unknown as {
      findUnique: (args: unknown) => Promise<{
        recommendationPersonalizationEnabled?: boolean;
      } | null>;
    };
    const profile = await this.executeAsync(() =>
      prismaProfile.findUnique({
        where: {
          userId,
        },
        select: {
          recommendationPersonalizationEnabled: true,
        },
      }),
    );

    return profile?.recommendationPersonalizationEnabled ?? true;
  }

  async update(input: UpdateProfileInput): Promise<ProfileRecord> {
    try {
      const prismaProfile = this.prisma.profile as unknown as {
        update: (args: unknown) => Promise<ProfilePersistence>;
      };
      const profile = await this.executeAsync(() =>
        prismaProfile.update({
          where: {
            userId: input.userId,
          },
          data: {
            username: input.username,
            phoneNumber: input.phoneNumber ?? null,
            ...(input.isPrivate !== undefined
              ? { isPrivate: input.isPrivate }
              : {}),
            ...(input.recommendationPersonalizationEnabled !== undefined
              ? {
                  recommendationPersonalizationEnabled:
                    input.recommendationPersonalizationEnabled,
                }
              : {}),
            avatarUrl: input.avatarUrl ?? null,
            avatarBlobName: input.avatarBlobName ?? null,
            ...(input.trustworthinessScore !== undefined
              ? { trustworthinessScore: input.trustworthinessScore }
              : {}),
            ...(input.rentPostingsCount !== undefined
              ? { rentPostingsCount: input.rentPostingsCount }
              : {}),
            ...(input.availableRentPostingsCount !== undefined
              ? { availableRentPostingsCount: input.availableRentPostingsCount }
              : {}),
          },
          include: {
            user: {
              select: {
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
      );

      return this.mapProfile(profile);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError("That username is already taken.");
      }

      throw error;
    }
  }

  private mapProfile(profile: ProfilePersistence): ProfileRecord {
    return {
      id: profile.id,
      userId: profile.userId,
      email: profile.user.email,
      firstName: profile.user.firstName ?? undefined,
      lastName: profile.user.lastName ?? undefined,
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

  private mapPublicProfile(profile: ProfilePersistence): PublicProfileRecord {
    return {
      id: profile.id,
      userId: profile.userId,
      email: profile.user.email,
      firstName: profile.user.firstName ?? undefined,
      lastName: profile.user.lastName ?? undefined,
      username: profile.username,
      phoneNumber: profile.phoneNumber ?? undefined,
      avatarUrl: profile.avatarUrl ?? undefined,
      trustworthinessScore: profile.trustworthinessScore,
      rentPostingsCount: profile.rentPostingsCount,
      availableRentPostingsCount: profile.availableRentPostingsCount,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
