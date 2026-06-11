import { OrganizationsRepository } from "@/features/organizations/organizations.repository";

function createMembershipPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "membership-1",
    organizationId: "org-1",
    role: "manager",
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    organization: {
      id: "org-1",
      name: "Northwind",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    },
    user: {
      id: "user-1",
      email: "owner@example.com",
      firstName: "Casey",
      lastName: "Doe",
      profile: {
        username: "northwind-owner",
        avatarUrl: "https://example.test/avatar.png",
      },
    },
    ...overrides,
  };
}

function createInvitationPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "invite-1",
    organizationId: "org-1",
    email: "teammate@example.com",
    role: "operator",
    status: "pending",
    tokenHash: "token-hash-1",
    expiresAt: new Date("2099-06-01T00:00:00.000Z"),
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    acceptedAt: null,
    revokedAt: null,
    organization: {
      id: "org-1",
      name: "Northwind",
    },
    invitedByUser: {
      id: "user-1",
      email: "owner@example.com",
      profile: {
        username: "northwind-owner",
      },
    },
    acceptedByUser: null,
    ...overrides,
  };
}

describe("OrganizationsRepository", () => {
  it("lists memberships and resolves the active organization", async () => {
    const findMany = jest.fn(async () => [
      createMembershipPersistence(),
      createMembershipPersistence({
        id: "membership-2",
        organizationId: "org-2",
        role: "operator",
        createdAt: new Date("2026-05-03T00:00:00.000Z"),
        organization: {
          id: "org-2",
          name: "Zed Labs",
          createdAt: new Date("2026-05-03T00:00:00.000Z"),
          updatedAt: new Date("2026-05-04T00:00:00.000Z"),
        },
      }),
    ]);
    const repository = new OrganizationsRepository({
      organizationMembership: {
        findMany,
      },
    } as never);

    const result = await repository.listMembershipsByUserId("user-1", "org-2");

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
      },
      include: {
        organization: true,
        user: {
          include: {
            profile: true,
          },
        },
      },
      orderBy: [
        {
          organization: {
            name: "asc",
          },
        },
        {
          createdAt: "asc",
        },
      ],
    });
    expect(result).toEqual([
      {
        membershipId: "membership-1",
        id: "org-1",
        name: "Northwind",
        role: "manager",
        joinedAt: "2026-05-01T00:00:00.000Z",
        isActive: false,
      },
      {
        membershipId: "membership-2",
        id: "org-2",
        name: "Zed Labs",
        role: "operator",
        joinedAt: "2026-05-03T00:00:00.000Z",
        isActive: true,
      },
    ]);
  });

  it("maps organization detail members and invitation actors", async () => {
    const findUnique = jest.fn(async () => ({
      id: "org-1",
      name: "Northwind",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-02T00:00:00.000Z"),
      memberships: [
        createMembershipPersistence(),
        createMembershipPersistence({
          id: "membership-2",
          role: "operator",
          user: {
            id: "user-2",
            email: "operator@example.com",
            firstName: null,
            lastName: null,
            profile: null,
          },
        }),
      ],
      invitations: [
        createInvitationPersistence({
          acceptedByUser: {
            id: "user-2",
            email: "accepted@example.com",
            profile: null,
          },
        }),
      ],
    }));
    const repository = new OrganizationsRepository({
      organization: {
        findUnique,
      },
    } as never);

    const result = await repository.findOrganizationDetail("org-1");

    expect(result).toEqual({
      organization: {
        id: "org-1",
        name: "Northwind",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      },
      viewerRole: "operator",
      members: [
        {
          membershipId: "membership-1",
          userId: "user-1",
          email: "owner@example.com",
          firstName: "Casey",
          lastName: "Doe",
          username: "northwind-owner",
          avatarUrl: "https://example.test/avatar.png",
          role: "manager",
          joinedAt: "2026-05-01T00:00:00.000Z",
        },
        {
          membershipId: "membership-2",
          userId: "user-2",
          email: "operator@example.com",
          firstName: undefined,
          lastName: undefined,
          username: "operator@example.com",
          avatarUrl: undefined,
          role: "operator",
          joinedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      invitations: [
        {
          id: "invite-1",
          email: "teammate@example.com",
          emailHint: "t***@example.com",
          role: "operator",
          status: "pending",
          expiresAt: "2099-06-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
          acceptedAt: undefined,
          revokedAt: undefined,
          invitedBy: {
            id: "user-1",
            email: "owner@example.com",
            username: "northwind-owner",
          },
          acceptedBy: {
            id: "user-2",
            email: "accepted@example.com",
            username: "accepted@example.com",
          },
        },
      ],
    });
  });

  it("reissues invitations by revoking prior pending rows and mapping the new invite", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const create = jest.fn(async () => createInvitationPersistence());
    const database = {
      $transaction: async <T>(
        callback: (client: {
          organizationInvitation: {
            updateMany: typeof updateMany;
            create: typeof create;
          };
        }) => Promise<T>,
      ) =>
        callback({
          organizationInvitation: {
            updateMany,
            create,
          },
        }),
    };
    const repository = new OrganizationsRepository(database as never);
    const now = new Date("2026-06-01T00:00:00.000Z");
    const expiresAt = new Date("2026-06-08T00:00:00.000Z");

    const result = await repository.reissueInvitation({
      organizationId: "org-1",
      invitedByUserId: "user-1",
      email: "teammate@example.com",
      role: "operator",
      tokenHash: "token-hash-2",
      expiresAt,
      now,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        email: "teammate@example.com",
        status: "pending",
      },
      data: {
        status: "revoked",
        revokedAt: now,
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        organizationId: "org-1",
        invitedByUserId: "user-1",
        email: "teammate@example.com",
        role: "operator",
        tokenHash: "token-hash-2",
        expiresAt,
      }),
      include: expect.any(Object),
    });
    expect(result.emailHint).toBe("t***@example.com");
  });

  it("returns null when revoking a missing or non-pending invitation", async () => {
    const findUnique = jest
      .fn(async () => null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        createInvitationPersistence({
          status: "accepted",
        }),
      );
    const update = jest.fn(async () => createInvitationPersistence());
    const database = {
      $transaction: async <T>(
        callback: (client: {
          organizationInvitation: {
            findUnique: typeof findUnique;
            update: typeof update;
          };
        }) => Promise<T>,
      ) =>
        callback({
          organizationInvitation: {
            findUnique,
            update,
          },
        }),
    };
    const repository = new OrganizationsRepository(database as never);
    const now = new Date("2026-06-01T00:00:00.000Z");

    await expect(
      repository.revokeInvitation("invite-1", now),
    ).resolves.toBeNull();
    await expect(
      repository.revokeInvitation("invite-2", now),
    ).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("accepts invitations and maps both the invitation and created membership", async () => {
    const upsert = jest.fn(async () =>
      createMembershipPersistence({
        id: "membership-9",
        role: "operator",
      }),
    );
    const update = jest.fn(async () =>
      createInvitationPersistence({
        status: "accepted",
        acceptedAt: new Date("2026-06-01T00:00:00.000Z"),
        acceptedByUser: {
          id: "user-9",
          email: "new.member@example.com",
          profile: {
            username: "new-member",
          },
        },
      }),
    );
    const database = {
      $transaction: async <T>(
        callback: (client: {
          organizationMembership: {
            upsert: typeof upsert;
          };
          organizationInvitation: {
            update: typeof update;
          };
        }) => Promise<T>,
      ) =>
        callback({
          organizationMembership: {
            upsert,
          },
          organizationInvitation: {
            update,
          },
        }),
    };
    const repository = new OrganizationsRepository(database as never);
    const now = new Date("2026-06-01T00:00:00.000Z");

    const result = await repository.acceptInvitation({
      invitationId: "invite-1",
      organizationId: "org-1",
      userId: "user-9",
      role: "operator",
      now,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        organizationId_userId: {
          organizationId: "org-1",
          userId: "user-9",
        },
      },
      update: {},
      create: expect.objectContaining({
        id: expect.any(String),
        organizationId: "org-1",
        userId: "user-9",
        role: "operator",
      }),
      include: expect.any(Object),
    });
    expect(update).toHaveBeenCalledWith({
      where: {
        id: "invite-1",
      },
      data: {
        status: "accepted",
        acceptedByUserId: "user-9",
        acceptedAt: now,
        revokedAt: null,
      },
      include: expect.any(Object),
    });
    expect(result).toEqual({
      invitation: {
        id: "invite-1",
        email: "teammate@example.com",
        emailHint: "t***@example.com",
        role: "operator",
        status: "accepted",
        expiresAt: "2099-06-01T00:00:00.000Z",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
        acceptedAt: "2026-06-01T00:00:00.000Z",
        revokedAt: undefined,
        invitedBy: {
          id: "user-1",
          email: "owner@example.com",
          username: "northwind-owner",
        },
        acceptedBy: {
          id: "user-9",
          email: "new.member@example.com",
          username: "new-member",
        },
      },
      membership: {
        membershipId: "membership-9",
        userId: "user-1",
        email: "owner@example.com",
        firstName: "Casey",
        lastName: "Doe",
        username: "northwind-owner",
        avatarUrl: "https://example.test/avatar.png",
        role: "operator",
        joinedAt: "2026-05-01T00:00:00.000Z",
      },
    });
  });
});
