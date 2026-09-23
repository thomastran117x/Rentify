import { Prisma } from "@/generated/prisma/client";
import {
  OAuthUsernameAllocationConflictError,
  UsersRepository,
} from "@/features/auth/users/users.repository";
import type { VerifiedOAuthProfile } from "@/features/auth/oauth/oauth.types";
import ConflictError from "@/errors/http/conflict.error";
import { testUuid } from "../../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);
const USER_2_ID = testUuid(9000, 994258);

function createOrganizationMembershipPersistence(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "membership-1",
    organizationId: "org-1",
    userId: USER_1_ID,
    role: "manager",
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    organization: {
      id: "org-1",
      name: "Org One",
    },
    ...overrides,
  };
}

function createOAuthIdentityPersistence(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "oauth-1",
    userId: USER_1_ID,
    provider: "google",
    providerUserId: "google-user-1",
    providerEmail: "user@example.com",
    emailVerified: true,
    displayName: "Jane Doe",
    linkedAt: new Date("2026-05-01T00:00:00.000Z"),
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    ...overrides,
  };
}

function createProfilePersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    userId: USER_1_ID,
    username: "jane-doe",
    phoneNumber: null,
    avatarUrl: null,
    avatarBlobName: null,
    isPrivate: false,
    recommendationPersonalizationEnabled: undefined,
    trustworthinessScore: 88,
    rentPostingsCount: 4,
    availableRentPostingsCount: 2,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    ...overrides,
  };
}

function createUserPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_1_ID,
    email: "user@example.com",
    passwordHash: "hashed-password",
    tokenVersion: 3,
    firstName: "Jane",
    lastName: "Doe",
    role: "owner",
    emailVerified: true,
    oauthIdentities: [createOAuthIdentityPersistence()],
    profile: createProfilePersistence(),
    preferredOrganizationId: "org-1",
    organizationMemberships: [createOrganizationMembershipPersistence()],
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    ...overrides,
  };
}

function createOAuthProfile(
  overrides: Record<string, unknown> = {},
): VerifiedOAuthProfile {
  return {
    provider: "google",
    providerUserId: "google-user-1",
    email: "User@Example.com",
    emailVerified: true,
    firstName: "Jane",
    lastName: "Doe",
    ...overrides,
  };
}

describe("UsersRepository", () => {
  it("finds users by id and email and maps nested auth records", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(createUserPersistence())
      .mockResolvedValueOnce(
        createUserPersistence({
          email: "user@example.com",
          firstName: null,
          lastName: null,
          oauthIdentities: [
            createOAuthIdentityPersistence({
              providerEmail: null,
              displayName: null,
            }),
          ],
          preferredOrganizationId: null,
        }),
      );
    const repository = new UsersRepository({
      user: {
        findUnique,
      },
    } as any);

    const byId = await repository.findUserById(USER_1_ID);
    const byEmail = await repository.findUserByEmail("User@Example.com");

    expect(findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          email: "user@example.com",
        },
      }),
    );
    expect(byId).toMatchObject({
      id: USER_1_ID,
      email: "user@example.com",
      role: "owner",
      emailVerified: true,
      profile: expect.objectContaining({
        username: "jane-doe",
        recommendationPersonalizationEnabled: true,
      }),
      oauthIdentities: [
        expect.objectContaining({
          provider: "google",
          providerEmail: "user@example.com",
          displayName: "Jane Doe",
        }),
      ],
      organizationMemberships: [
        expect.objectContaining({
          membershipId: "membership-1",
          organizationName: "Org One",
          role: "manager",
        }),
      ],
    });
    expect(byEmail).toMatchObject({
      firstName: undefined,
      lastName: undefined,
      preferredOrganizationId: undefined,
      oauthIdentities: [
        expect.objectContaining({
          providerEmail: undefined,
          displayName: undefined,
        }),
      ],
    });
  });

  it("creates local users with explicit usernames and activates pending local users", async () => {
    const create = jest.fn(async () =>
      createUserPersistence({
        email: "new@example.com",
        emailVerified: false,
        profile: createProfilePersistence({
          username: "new-user",
        }),
      }),
    );
    const update = jest.fn(async () =>
      createUserPersistence({
        email: "pending@example.com",
        emailVerified: true,
        passwordHash: "fresh-hash",
        profile: createProfilePersistence({
          username: "pending-user",
        }),
      }),
    );
    const repository = new UsersRepository({
      user: {
        create,
        update,
      },
    } as any);
    const created = await repository.createLocalUser(
      {
        username: "New-User",
        email: "New@Example.com",
        firstName: "New",
        lastName: "User",
        dateOfBirth: "2012-06-15",
      },
      "password-hash",
    );
    const activated = await repository.activatePendingLocalUser(USER_2_ID, {
      username: "Pending-User",
      passwordHash: "fresh-hash",
      firstName: "Pending",
      lastName: "User",
      dateOfBirth: "2012-06-15",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "new@example.com",
          passwordHash: "password-hash",
          dateOfBirth: new Date("2012-06-15T00:00:00.000Z"),
          dateOfBirthProvidedAt: expect.any(Date),
          emailVerified: false,
          profile: {
            create: expect.objectContaining({
              username: "new-user",
            }),
          },
        }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: USER_2_ID,
        },
        data: expect.objectContaining({
          passwordHash: "fresh-hash",
          dateOfBirth: new Date("2012-06-15T00:00:00.000Z"),
          dateOfBirthProvidedAt: expect.any(Date),
          emailVerified: true,
          profile: {
            update: expect.objectContaining({
              username: "pending-user",
            }),
          },
        }),
      }),
    );
    expect(created.profile.username).toBe("new-user");
    expect(activated.profile.username).toBe("pending-user");
    expect(activated.emailVerified).toBe(true);
  });

  it("creates oauth users and finds them by identity", async () => {
    const profileFindUnique = jest.fn(async () => null);
    const create = jest.fn(async () =>
      createUserPersistence({
        passwordHash: null,
        oauthIdentities: [
          createOAuthIdentityPersistence({
            providerEmail: "user@example.com",
            displayName: "Jane Doe",
          }),
        ],
      }),
    );
    const findUnique = jest.fn(async () => ({
      user: createUserPersistence(),
    }));
    const repository = new UsersRepository({
      profile: {
        findUnique: profileFindUnique,
      },
      user: {
        create,
      },
      oAuthIdentity: {
        findUnique,
      },
    } as any);

    const created = await repository.createOAuthUser(
      createOAuthProfile(),
      "bright-otter-4827",
      "2012-06-15",
    );
    const found = await repository.findUserByOAuthIdentity(
      "google",
      "google-user-1",
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "user@example.com",
          passwordHash: null,
          dateOfBirth: new Date("2012-06-15T00:00:00.000Z"),
          dateOfBirthProvidedAt: expect.any(Date),
          profile: {
            create: expect.objectContaining({
              username: "bright-otter-4827",
              usernameAutoGenerated: true,
            }),
          },
          oauthIdentities: {
            create: expect.objectContaining({
              provider: "google",
              providerEmail: "user@example.com",
              displayName: "Jane Doe",
            }),
          },
        }),
      }),
    );
    expect(found?.id).toBe(USER_1_ID);
    expect(created.passwordHash).toBeUndefined();
  });

  it("marks only username unique races as retryable OAuth allocation conflicts", async () => {
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: "profiles_username_key" },
      },
    );
    const repository = new UsersRepository({
      user: {
        create: jest.fn(async () => {
          throw uniqueViolation;
        }),
      },
    } as any);

    await expect(
      repository.createOAuthUser(
        createOAuthProfile(),
        "bright-otter-4827",
        "2012-06-15",
      ),
    ).rejects.toBeInstanceOf(OAuthUsernameAllocationConflictError);
  });

  it("does not mask a non-username OAuth uniqueness conflict", async () => {
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: "users_email_key" },
      },
    );
    const repository = new UsersRepository({
      user: {
        create: jest.fn(async () => {
          throw uniqueViolation;
        }),
      },
    } as any);

    await expect(
      repository.createOAuthUser(
        createOAuthProfile(),
        "bright-otter-4827",
        "2012-06-15",
      ),
    ).rejects.toBe(uniqueViolation);
  });

  describe("updateUserEmail", () => {
    it("lower-cases the address and verifies it in the same write", async () => {
      const update = jest.fn(async () =>
        createUserPersistence({ email: "owner-one-new@rentify.local" }),
      );
      const repository = new UsersRepository({
        user: {
          update,
        },
      } as any);

      const updated = await repository.updateUserEmail(
        USER_1_ID,
        "  Owner-One-New@Rentify.local  ",
      );

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: USER_1_ID,
          },
          data: {
            email: "owner-one-new@rentify.local",
            emailVerified: true,
          },
        }),
      );
      expect(updated.email).toBe("owner-one-new@rentify.local");
    });

    /**
     * The Redis reservation upstream is advisory; this constraint is the one
     * that actually decides a race, so its failure has to arrive as a conflict
     * rather than an unhandled Prisma error.
     */
    it("turns a unique-constraint violation into a conflict", async () => {
      const uniqueViolation = Object.assign(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "7.0.0",
        }),
      );
      const update = jest.fn(async () => {
        throw uniqueViolation;
      });
      const repository = new UsersRepository({
        user: {
          update,
        },
      } as any);

      await expect(
        repository.updateUserEmail(USER_1_ID, "taken@rentify.local"),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("lets an unrelated database failure through untouched", async () => {
      const update = jest.fn(async () => {
        throw new Error("connection reset");
      });
      const repository = new UsersRepository({
        user: {
          update,
        },
      } as any);

      await expect(
        repository.updateUserEmail(USER_1_ID, "new@rentify.local"),
      ).rejects.toThrow("connection reset");
    });
  });

  it("marks a user's email as verified", async () => {
    const update = jest.fn(async () => undefined);
    const repository = new UsersRepository({
      user: {
        update,
      },
    } as any);

    await repository.markEmailVerified(USER_1_ID);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: USER_1_ID,
        },
        data: {
          emailVerified: true,
        },
      }),
    );
  });

  it("covers users repository helper branches for mapping and display names", () => {
    const repository = new UsersRepository({} as any) as unknown as {
      mapUser: (user: ReturnType<typeof createUserPersistence>) => unknown;
      createDisplayName: (input: {
        firstName?: string;
        lastName?: string;
      }) => string | null;
    };

    expect(() =>
      repository.mapUser(
        createUserPersistence({
          profile: null,
        }),
      ),
    ).toThrow(ConflictError);
    expect(
      repository.createDisplayName({
        firstName: "Jane",
        lastName: "Doe",
      }),
    ).toBe("Jane Doe");
    expect(
      repository.createDisplayName({
        firstName: undefined,
        lastName: undefined,
      }),
    ).toBeNull();
  });

  describe("findUserIdByEmail", () => {
    it("touches only the unique index instead of loading the auth graph", async () => {
      // The point of this probe over findUserByEmail: an availability check
      // wants existence, not the profile, identities and memberships that one
      // loads to answer the same question.
      const findUnique = jest.fn(async () => ({ id: USER_1_ID }));
      const repository = new UsersRepository({
        user: { findUnique },
      } as any);

      await expect(
        repository.findUserIdByEmail("  User@Example.COM "),
      ).resolves.toBe(USER_1_ID);

      expect(findUnique).toHaveBeenCalledWith({
        where: { email: "user@example.com" },
        select: { id: true },
      });
    });

    it("reports null for an address nobody holds", async () => {
      const findUnique = jest.fn(async () => null);
      const repository = new UsersRepository({
        user: { findUnique },
      } as any);

      await expect(
        repository.findUserIdByEmail("nobody@example.com"),
      ).resolves.toBeNull();
    });
  });
});
