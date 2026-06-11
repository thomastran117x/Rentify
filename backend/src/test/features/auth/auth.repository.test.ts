import { Prisma } from "@prisma/client";
import { AuthRepository } from "@/features/auth/auth.repository";
import ConflictError from "@/errors/http/conflict.error";

function createOrganizationMembershipPersistence(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "membership-1",
    organizationId: "org-1",
    userId: "user-1",
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
    userId: "user-1",
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
    userId: "user-1",
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
    id: "user-1",
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

function createOAuthProfile(overrides: Record<string, unknown> = {}) {
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

describe("AuthRepository", () => {
  it("finds session validation data and token versions", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        tokenVersion: 7,
        role: "admin",
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        tokenVersion: 9,
        role: "owner",
      });
    const repository = new AuthRepository({
      user: {
        findUnique,
      },
    } as never);

    await expect(
      repository.findSessionValidationByUserId("user-1"),
    ).resolves.toEqual({
      tokenVersion: 7,
      role: "admin",
    });
    await expect(
      repository.findSessionValidationByUserId("missing-user"),
    ).resolves.toBeNull();
    await expect(repository.findTokenVersionByUserId("user-2")).resolves.toBe(
      9,
    );
  });

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
    const repository = new AuthRepository({
      user: {
        findUnique,
      },
    } as never);

    const byId = await repository.findUserById("user-1");
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
      id: "user-1",
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

  it("creates local users with collision-safe usernames and activates pending local users", async () => {
    const profileFindUnique = jest
      .fn()
      .mockResolvedValueOnce({
        id: "taken-profile",
      })
      .mockResolvedValueOnce(null);
    const create = jest.fn(async () =>
      createUserPersistence({
        email: "new@example.com",
        emailVerified: false,
        profile: createProfilePersistence({
          username: "new2",
        }),
      }),
    );
    const update = jest.fn(async () =>
      createUserPersistence({
        email: "pending@example.com",
        emailVerified: true,
        passwordHash: "fresh-hash",
      }),
    );
    const repository = new AuthRepository({
      profile: {
        findUnique: profileFindUnique,
      },
      user: {
        create,
        update,
      },
    } as never);

    const created = await repository.createLocalUser(
      {
        email: "New@Example.com",
        firstName: "New",
        lastName: "User",
      },
      "password-hash",
    );
    const activated = await repository.activatePendingLocalUser("user-2", {
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
              username: "new2",
            }),
          },
        }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "user-2",
        },
        data: expect.objectContaining({
          passwordHash: "fresh-hash",
          emailVerified: true,
        }),
      }),
    );
    expect(created.profile.username).toBe("new2");
    expect(activated.emailVerified).toBe(true);
  });

  it("creates oauth users, finds them by identity, and lists linked identities", async () => {
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
    const findMany = jest.fn(async () => [
      createOAuthIdentityPersistence(),
      createOAuthIdentityPersistence({
        id: "oauth-2",
        provider: "apple",
        providerUserId: "apple-user-1",
        providerEmail: null,
        displayName: null,
      }),
    ]);
    const repository = new AuthRepository({
      profile: {
        findUnique: profileFindUnique,
      },
      user: {
        create,
      },
      oAuthIdentity: {
        findUnique,
        findMany,
      },
    } as never);

    const created = await repository.createOAuthUser(createOAuthProfile());
    const found = await repository.findUserByOAuthIdentity(
      "google",
      "google-user-1",
    );
    const identities = await repository.listOAuthIdentitiesByUserId("user-1");

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
    expect(found?.id).toBe("user-1");
    expect(identities).toEqual([
      expect.objectContaining({
        provider: "google",
      }),
      expect.objectContaining({
        provider: "apple",
        providerEmail: undefined,
        displayName: undefined,
      }),
    ]);
    expect(created.passwordHash).toBeUndefined();
  });

  it("links oauth identities and remaps duplicate-link races to conflicts", async () => {
    const create = jest.fn(async () =>
      createOAuthIdentityPersistence({
        provider: "microsoft",
        providerUserId: "ms-user-1",
      }),
    );
    const repository = new AuthRepository({
      oAuthIdentity: {
        create,
      },
    } as never);

    const linked = await repository.linkOAuthIdentity(
      "user-1",
      createOAuthProfile({
        provider: "microsoft",
        providerUserId: "ms-user-1",
      }),
    );

    expect(linked).toMatchObject({
      provider: "microsoft",
      providerUserId: "ms-user-1",
    });

    const duplicateError = Object.assign(new Error("duplicate identity"), {
      code: "P2002",
      clientVersion: "test",
    });
    Object.setPrototypeOf(
      duplicateError,
      Prisma.PrismaClientKnownRequestError.prototype,
    );
    const duplicateRepository = new AuthRepository({
      oAuthIdentity: {
        create: jest.fn(async () => {
          throw duplicateError;
        }),
      },
    } as never);

    await expect(
      duplicateRepository.linkOAuthIdentity("user-1", createOAuthProfile()),
    ).rejects.toThrow("This OAuth provider is already linked to an account.");
  });

  it("unlinks identities and updates email verification, passwords, and token versions", async () => {
    const deleteMany = jest.fn(async () => ({
      count: 1,
    }));
    const update = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        tokenVersion: 12,
      });
    const repository = new AuthRepository({
      oAuthIdentity: {
        deleteMany,
      },
      user: {
        update,
      },
    } as never);

    await expect(
      repository.unlinkOAuthIdentity("user-1", "google"),
    ).resolves.toBe(true);
    await repository.markEmailVerified("user-1");
    await repository.updatePasswordHash("user-1", "new-hash");
    await expect(repository.rotateTokenVersion("user-1")).resolves.toBe(12);

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        provider: "google",
      },
    });
    expect(update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: {
          emailVerified: true,
        },
      }),
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: {
          passwordHash: "new-hash",
        },
      }),
    );
    expect(update).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
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
  });

  it("covers auth repository helper branches for mapping, usernames, and display names", async () => {
    const profileFindUnique = jest.fn(async () => ({
      id: "taken",
    }));
    const repository = new AuthRepository({
      profile: {
        findUnique: profileFindUnique,
      },
    } as never) as unknown as {
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
});
