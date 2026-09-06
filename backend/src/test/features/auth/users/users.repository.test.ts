import { UsersRepository } from "@/features/auth/users/users.repository";
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
      },
      "password-hash",
    );
    const activated = await repository.activatePendingLocalUser(USER_2_ID, {
      username: "Pending-User",
      passwordHash: "fresh-hash",
      firstName: "Pending",
      lastName: "User",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "new@example.com",
          passwordHash: "password-hash",
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

    const created = await repository.createOAuthUser(createOAuthProfile());
    const found = await repository.findUserByOAuthIdentity(
      "google",
      "google-user-1",
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "user@example.com",
          passwordHash: null,
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

  it("covers users repository helper branches for mapping, usernames, and display names", async () => {
    const profileFindUnique = jest.fn(async () => ({
      id: "taken",
    }));
    const repository = new UsersRepository({
      profile: {
        findUnique: profileFindUnique,
      },
    } as any) as unknown as {
      mapUser: (user: ReturnType<typeof createUserPersistence>) => unknown;
      sanitizeUsername: (value: string) => string;
      createDisplayName: (input: {
        firstName?: string;
        lastName?: string;
      }) => string | null;
      generateAvailableUsername: (email: string) => Promise<string>;
    };

    expect(() =>
      repository.mapUser(
        createUserPersistence({
          profile: null,
        }),
      ),
    ).toThrow(ConflictError);
    expect(repository.sanitizeUsername("  Jane.Doe  ")).toBe("jane.doe");
    expect(repository.sanitizeUsername("  $$$  ")).toBe("user");
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

    const fallbackUsername = await repository.generateAvailableUsername(
      "Very.Long+Alias@Example.com",
    );
    expect(fallbackUsername).toMatch(/^very\.long-alias-[a-f0-9]{8}$/);
  });

  describe("generateAvailableUsername screening", () => {
    function createGenerator(findUnique: jest.Mock) {
      return new UsersRepository({
        profile: { findUnique },
      } as any) as unknown as {
        generateAvailableUsername: (
          email: string,
          isLikelyTaken?: (candidate: string) => boolean,
        ) => Promise<string>;
      };
    }

    it("probes every candidate in turn without a screen", async () => {
      // The unscreened walk this replaces: nine taken names plus the free one
      // cost ten queries on a single OAuth signup.
      const taken = new Set([
        "john",
        ...Array.from({ length: 8 }, (_, index) => `john${index + 2}`),
      ]);
      const findUnique = jest.fn(async ({ where }: any) =>
        taken.has(where.username) ? { id: "taken" } : null,
      );
      const repository = createGenerator(findUnique);

      await expect(
        repository.generateAvailableUsername("john@example.com"),
      ).resolves.toBe("john10");
      expect(findUnique).toHaveBeenCalledTimes(10);
    });

    it("skips screened-out candidates and confirms the first survivor once", async () => {
      const taken = new Set([
        "john",
        ...Array.from({ length: 8 }, (_, index) => `john${index + 2}`),
      ]);
      const findUnique = jest.fn(async ({ where }: any) =>
        taken.has(where.username) ? { id: "taken" } : null,
      );
      const repository = createGenerator(findUnique);

      await expect(
        repository.generateAvailableUsername("john@example.com", (candidate) =>
          taken.has(candidate),
        ),
      ).resolves.toBe("john10");
      // One confirming probe instead of ten.
      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { username: "john10" } }),
      );
    });

    it("still confirms against the database, since the screen is only a cache", async () => {
      const findUnique = jest
        .fn()
        .mockResolvedValueOnce({ id: "taken" })
        .mockResolvedValueOnce(null);
      const repository = createGenerator(findUnique);

      await expect(
        repository.generateAvailableUsername("john@example.com", () => false),
      ).resolves.toBe("john2");
      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it("probes normally when the screen has no opinion", async () => {
      // An unavailable filter must read as "no opinion", not "taken" — treating
      // it as taken would skip every candidate and push each new OAuth user
      // onto the random-suffix fallback.
      const findUnique = jest.fn(async () => null);
      const repository = createGenerator(findUnique);

      await expect(
        repository.generateAvailableUsername("john@example.com", () => false),
      ).resolves.toBe("john");
      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it("falls back to a random suffix when the screen rejects every candidate", async () => {
      const findUnique = jest.fn(async () => null);
      const repository = createGenerator(findUnique);

      await expect(
        repository.generateAvailableUsername("john@example.com", () => true),
      ).resolves.toMatch(/^john-[a-f0-9]{8}$/);
      expect(findUnique).not.toHaveBeenCalled();
    });
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
