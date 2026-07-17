import { Prisma } from "@prisma/client";
import ConflictError from "@/errors/http/conflict.error";
import { ProfileRepository } from "@/features/profile/profile.repository";

function createProfilePersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    userId: "user-1",
    username: "casey-doe",
    phoneNumber: "+1 555 0100",
    avatarUrl: "https://storage.example.com/avatars/user-1.png",
    avatarBlobName: "avatars/user-1.png",
    isPrivate: false,
    recommendationPersonalizationEnabled: true,
    trustworthinessScore: 4,
    rentPostingsCount: 3,
    availableRentPostingsCount: 2,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    user: {
      email: "user@example.com",
      firstName: "Casey",
      lastName: "Doe",
    },
    ...overrides,
  };
}

describe("ProfileRepository", () => {
  it("lists public profiles with pagination and query filters", async () => {
    const findMany = jest.fn(async () => [
      createProfilePersistence(),
      createProfilePersistence({
        id: "profile-2",
        userId: "user-2",
        username: "alex-rivera",
        phoneNumber: null,
        avatarUrl: null,
        avatarBlobName: null,
        user: {
          email: "alex@example.com",
          firstName: null,
          lastName: "Rivera",
        },
      }),
    ]);
    const count = jest.fn(async () => 5);
    const repository = new ProfileRepository({
      profile: {
        findMany,
        count,
      },
    } as any);

    const result = await repository.findPublicProfiles({
      page: 2,
      pageSize: 2,
      query: "casey",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        isPrivate: false,
        OR: [
          {
            username: {
              contains: "casey",
            },
          },
          {
            phoneNumber: {
              contains: "casey",
            },
          },
          {
            user: {
              is: {
                email: {
                  contains: "casey",
                },
              },
            },
          },
          {
            user: {
              is: {
                firstName: {
                  contains: "casey",
                },
              },
            },
          },
          {
            user: {
              is: {
                lastName: {
                  contains: "casey",
                },
              },
            },
          },
        ],
      },
      skip: 2,
      take: 2,
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
    });
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        isPrivate: false,
      }),
    });
    expect(result).toEqual({
      profiles: [
        {
          id: "profile-1",
          userId: "user-1",
          email: "user@example.com",
          firstName: "Casey",
          lastName: "Doe",
          username: "casey-doe",
          phoneNumber: "+1 555 0100",
          avatarUrl: "https://storage.example.com/avatars/user-1.png",
          trustworthinessScore: 4,
          rentPostingsCount: 3,
          availableRentPostingsCount: 2,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        },
        {
          id: "profile-2",
          userId: "user-2",
          email: "alex@example.com",
          firstName: undefined,
          lastName: "Rivera",
          username: "alex-rivera",
          phoneNumber: undefined,
          avatarUrl: undefined,
          trustworthinessScore: 4,
          rentPostingsCount: 3,
          availableRentPostingsCount: 2,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        },
      ],
      pagination: {
        page: 2,
        pageSize: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      },
      query: "casey",
    });
  });

  it("maps findByUserId results and returns null when the profile is missing", async () => {
    const findUnique = jest
      .fn(async () => createProfilePersistence())
      .mockResolvedValueOnce(createProfilePersistence())
      .mockResolvedValueOnce(null as any);
    const repository = new ProfileRepository({
      profile: {
        findUnique,
      },
    } as any);

    await expect(repository.findByUserId("user-1")).resolves.toEqual({
      id: "profile-1",
      userId: "user-1",
      email: "user@example.com",
      firstName: "Casey",
      lastName: "Doe",
      username: "casey-doe",
      phoneNumber: "+1 555 0100",
      avatarUrl: "https://storage.example.com/avatars/user-1.png",
      avatarBlobName: "avatars/user-1.png",
      isPrivate: false,
      recommendationPersonalizationEnabled: true,
      trustworthinessScore: 4,
      rentPostingsCount: 3,
      availableRentPostingsCount: 2,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    await expect(repository.findByUserId("missing-user")).resolves.toBeNull();
  });

  it("defaults recommendation personalization to true when the field or profile is absent", async () => {
    const findUnique = jest
      .fn(async () => ({ recommendationPersonalizationEnabled: false }))
      .mockResolvedValueOnce({ recommendationPersonalizationEnabled: false })
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce(null as any);
    const repository = new ProfileRepository({
      profile: {
        findUnique,
      },
    } as any);

    await expect(
      repository.findRecommendationPersonalizationEnabledByUserId("user-1"),
    ).resolves.toBe(false);
    await expect(
      repository.findRecommendationPersonalizationEnabledByUserId("user-2"),
    ).resolves.toBe(true);
    await expect(
      repository.findRecommendationPersonalizationEnabledByUserId("user-3"),
    ).resolves.toBe(true);
  });

  it("updates and maps profile persistence fields", async () => {
    const update = jest.fn(async () =>
      createProfilePersistence({
        username: "owner-one",
        phoneNumber: null,
        avatarUrl: null,
        avatarBlobName: null,
        recommendationPersonalizationEnabled: undefined,
      }),
    );
    const repository = new ProfileRepository({
      profile: {
        update,
      },
    } as any);

    const result = await repository.update({
      userId: "user-1",
      username: "owner-one",
      phoneNumber: null,
      isPrivate: true,
      recommendationPersonalizationEnabled: false,
      avatarUrl: null,
      avatarBlobName: null,
      trustworthinessScore: 5,
      rentPostingsCount: 7,
      availableRentPostingsCount: 4,
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
      },
      data: {
        username: "owner-one",
        phoneNumber: null,
        isPrivate: true,
        recommendationPersonalizationEnabled: false,
        avatarUrl: null,
        avatarBlobName: null,
        trustworthinessScore: 5,
        rentPostingsCount: 7,
        availableRentPostingsCount: 4,
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
    });
    expect(result.recommendationPersonalizationEnabled).toBe(true);
    expect(result.phoneNumber).toBeUndefined();
    expect(result.avatarUrl).toBeUndefined();
    expect(result.avatarBlobName).toBeUndefined();
  });

  it("maps duplicate usernames to ConflictError", async () => {
    const error = Object.assign(new Error("duplicate username"), {
      code: "P2002",
      clientVersion: "test",
    });
    Object.setPrototypeOf(
      error,
      Prisma.PrismaClientKnownRequestError.prototype,
    );
    const update = jest.fn(async () => {
      throw error;
    });
    const repository = new ProfileRepository({
      profile: {
        update,
      },
    } as any);

    await expect(
      repository.update({
        userId: "user-1",
        username: "taken-name",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
