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
    } as any);

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
      description: "A rental cooperative.",
      websiteUrl: "https://northwind.example.com",
      contactEmail: "hi@northwind.example.com",
      contactPhone: "+1 (555) 010-0100",
      addressLine1: "1 Main St",
      addressLine2: null,
      city: "Seattle",
      region: "Washington",
      country: "United States",
      postalCode: "98101",
      logoUrl: "https://northwind.example.com/logo.png",
      logoBlobName: "organizations/logo.png",
      customFields: { Founded: "2001" },
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
    } as any);

    const result = await repository.findOrganizationDetail("org-1");

    expect(result).toEqual({
      organization: {
        id: "org-1",
        name: "Northwind",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
        description: "A rental cooperative.",
        websiteUrl: "https://northwind.example.com",
        contactEmail: "hi@northwind.example.com",
        contactPhone: "+1 (555) 010-0100",
        addressLine1: "1 Main St",
        addressLine2: null,
        city: "Seattle",
        region: "Washington",
        country: "United States",
        postalCode: "98101",
        logoUrl: "https://northwind.example.com/logo.png",
        logoBlobName: "organizations/logo.png",
        customFields: { Founded: "2001" },
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

  it("creates an organization with the owner as primary manager", async () => {
    const organizationCreate = jest.fn(async () => ({
      id: "org-9",
      name: "Acme Rentals",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    }));
    const membershipCreate = jest.fn(async () =>
      createMembershipPersistence({
        id: "membership-9",
        organizationId: "org-9",
        role: "primary_manager",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        organization: {
          id: "org-9",
          name: "Acme Rentals",
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          updatedAt: new Date("2026-06-01T00:00:00.000Z"),
        },
      }),
    );
    const reindexRunFindFirst = jest.fn(async () => null);
    const outboxCreateMany = jest.fn(async () => ({ count: 1 }));
    const database = {
      $transaction: async <T>(
        callback: (client: {
          organization: { create: typeof organizationCreate };
          organizationMembership: { create: typeof membershipCreate };
          organizationSearchReindexRun: {
            findFirst: typeof reindexRunFindFirst;
          };
          organizationSearchOutbox: { createMany: typeof outboxCreateMany };
        }) => Promise<T>,
      ) =>
        callback({
          organization: { create: organizationCreate },
          organizationMembership: { create: membershipCreate },
          organizationSearchReindexRun: { findFirst: reindexRunFindFirst },
          organizationSearchOutbox: { createMany: outboxCreateMany },
        }),
    };
    const repository = new OrganizationsRepository(database as any);

    const result = await repository.createOrganizationWithOwner({
      name: "Acme Rentals",
      slug: "acme-rentals",
      ownerUserId: "user-1",
    });

    expect(organizationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        slug: "acme-rentals",
        name: "Acme Rentals",
      }),
    });
    // The organization write enqueues a search-index upsert in the same
    // transaction so the Elasticsearch index stays in sync.
    expect(outboxCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          organizationId: "org-9",
          operation: "upsert",
        }),
      ]),
    });
    expect(membershipCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        organizationId: "org-9",
        userId: "user-1",
        role: "primary_manager",
      }),
      include: expect.any(Object),
    });
    expect(result).toEqual({
      membershipId: "membership-9",
      id: "org-9",
      name: "Acme Rentals",
      role: "primary_manager",
      joinedAt: "2026-06-01T00:00:00.000Z",
      isActive: true,
    });
  });

  it("enqueues a search-index upsert when updating an organization", async () => {
    const organizationUpdate = jest.fn(async () => ({
      id: "org-1",
      name: "Renamed Org",
      description: "Updated description",
      websiteUrl: null,
      contactEmail: null,
      contactPhone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      country: null,
      postalCode: null,
      logoUrl: null,
      logoBlobName: null,
      customFields: null,
    }));
    const reindexRunFindFirst = jest.fn(async () => null);
    const outboxCreateMany = jest.fn(async () => ({ count: 1 }));
    const database = {
      $transaction: async <T>(
        callback: (client: {
          organization: { update: typeof organizationUpdate };
          organizationSearchReindexRun: {
            findFirst: typeof reindexRunFindFirst;
          };
          organizationSearchOutbox: { createMany: typeof outboxCreateMany };
        }) => Promise<T>,
      ) =>
        callback({
          organization: { update: organizationUpdate },
          organizationSearchReindexRun: { findFirst: reindexRunFindFirst },
          organizationSearchOutbox: { createMany: outboxCreateMany },
        }),
    };
    const repository = new OrganizationsRepository(database as any);

    const result = await repository.updateOrganization("org-1", {
      description: "Updated description",
    });

    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: expect.objectContaining({ description: "Updated description" }),
    });
    expect(outboxCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          organizationId: "org-1",
          operation: "upsert",
        }),
      ]),
    });
    expect(result).toEqual(
      expect.objectContaining({ id: "org-1", name: "Renamed Org" }),
    );
  });

  it("also enqueues a reindex-scoped outbox entry while a reindex run is active", async () => {
    const organizationUpdate = jest.fn(async () => ({
      id: "org-1",
      name: "Org",
      description: null,
      websiteUrl: null,
      contactEmail: null,
      contactPhone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      country: null,
      postalCode: null,
      logoUrl: null,
      logoBlobName: null,
      customFields: null,
    }));
    const reindexRunFindFirst = jest.fn(async () => ({
      id: "reindex-1",
      targetIndexName: "organizations_v123",
    }));
    const outboxCreateMany = jest.fn(async () => ({ count: 2 }));
    const database = {
      $transaction: async <T>(
        callback: (client: {
          organization: { update: typeof organizationUpdate };
          organizationSearchReindexRun: {
            findFirst: typeof reindexRunFindFirst;
          };
          organizationSearchOutbox: { createMany: typeof outboxCreateMany };
        }) => Promise<T>,
      ) =>
        callback({
          organization: { update: organizationUpdate },
          organizationSearchReindexRun: { findFirst: reindexRunFindFirst },
          organizationSearchOutbox: { createMany: outboxCreateMany },
        }),
    };
    const repository = new OrganizationsRepository(database as any);

    await repository.updateOrganization("org-1", { city: "Berlin" });

    const outboxCalls = (outboxCreateMany as jest.Mock).mock.calls as Array<
      [{ data: unknown[] }]
    >;
    const outboxArgs = outboxCalls[0]![0];
    expect(outboxArgs.data).toHaveLength(2);
    expect(outboxArgs.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: "org-1",
          reindexRunId: "reindex-1",
          targetIndexName: "organizations_v123",
        }),
      ]),
    );
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
    const repository = new OrganizationsRepository(database as any);
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
      .fn()
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
    const repository = new OrganizationsRepository(database as any);
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
    const repository = new OrganizationsRepository(database as any);
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
