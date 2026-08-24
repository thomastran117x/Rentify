import { Prisma } from "@/generated/prisma/client";
import {
  OrganizationSlugTakenError,
  OrganizationsProfileRepository,
} from "@/features/organizations/profile/profile.repository";

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

describe("OrganizationsProfileRepository", () => {
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
    const repository = new OrganizationsProfileRepository({
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
    const reservationCreate = jest.fn(async () => ({
      slug: "acme-rentals",
      organizationId: "org-9",
    }));
    const database = {
      $transaction: async <T>(
        callback: (client: {
          organization: { create: typeof organizationCreate };
          organizationMembership: { create: typeof membershipCreate };
          organizationSlugReservation: { create: typeof reservationCreate };
          organizationSearchReindexRun: {
            findFirst: typeof reindexRunFindFirst;
          };
          organizationSearchOutbox: { createMany: typeof outboxCreateMany };
        }) => Promise<T>,
      ) =>
        callback({
          organization: { create: organizationCreate },
          organizationMembership: { create: membershipCreate },
          organizationSlugReservation: { create: reservationCreate },
          organizationSearchReindexRun: { findFirst: reindexRunFindFirst },
          organizationSearchOutbox: { createMany: outboxCreateMany },
        }),
    };
    const repository = new OrganizationsProfileRepository(database as any);

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
    // Creation claims the slug through the same reservation key renames use, so
    // it cannot take one another organization has retired.
    expect(reservationCreate).toHaveBeenCalledWith({
      data: { slug: "acme-rentals", organizationId: "org-9" },
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

  it("reports a retired slug as taken when creating an organization", async () => {
    // The unique index on organizations.slug cannot see retired slugs, so the
    // reservation insert is the thing that rejects this. Without it a new
    // organization would inherit the original's old links.
    const reservationConflict = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`slug`)",
      { code: "P2002", clientVersion: "6.19.3" },
    );
    const database = {
      $transaction: async <T>(callback: (client: any) => Promise<T>) =>
        callback({
          organization: {
            create: jest.fn(async () => ({
              id: "org-9",
              name: "Harbor Rentals",
              createdAt: new Date("2026-06-01T00:00:00.000Z"),
              updatedAt: new Date("2026-06-01T00:00:00.000Z"),
            })),
          },
          organizationSlugReservation: {
            create: jest.fn(async () => {
              throw reservationConflict;
            }),
          },
        }),
    };
    const repository = new OrganizationsProfileRepository(database as any);

    await expect(
      repository.createOrganizationWithOwner({
        name: "Harbor Rentals",
        slug: "harbor",
        ownerUserId: "user-1",
      }),
    ).rejects.toBeInstanceOf(OrganizationSlugTakenError);
  });

  it("claims the new slug through a reservation when changing a slug", async () => {
    const reservationCreate = jest.fn(async () => ({
      slug: "harbor-new",
      organizationId: "org-1",
    }));
    const organizationUpdate = jest.fn(async () => ({
      id: "org-1",
      slug: "harbor-new",
      name: "Harbor",
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
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    }));
    const outboxCreateMany = jest.fn(async () => ({ count: 1 }));
    const database = {
      $transaction: async <T>(callback: (client: any) => Promise<T>) =>
        callback({
          organizationSlugReservation: { create: reservationCreate },
          organization: { update: organizationUpdate },
          organizationSearchReindexRun: {
            findFirst: jest.fn(async () => null),
          },
          organizationSearchOutbox: { createMany: outboxCreateMany },
        }),
    };
    const repository = new OrganizationsProfileRepository(database as any);

    const result = await repository.changeOrganizationSlug({
      organizationId: "org-1",
      nextSlug: "harbor-new",
    });

    // The new slug is reserved; the previous one keeps its existing reservation,
    // which is what makes it resolve forever and never be re-adopted.
    expect(reservationCreate).toHaveBeenCalledWith({
      data: { slug: "harbor-new", organizationId: "org-1" },
    });
    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { slug: "harbor-new" },
    });
    expect(result.slug).toBe("harbor-new");
  });

  it("reports a slug as taken when the reservation is already held", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`slug`)",
      { code: "P2002", clientVersion: "6.19.3" },
    );
    const database = {
      $transaction: async <T>(callback: (client: any) => Promise<T>) =>
        callback({
          organizationSlugReservation: {
            create: jest.fn(async () => {
              throw conflict;
            }),
          },
          organization: { update: jest.fn() },
        }),
    };
    const repository = new OrganizationsProfileRepository(database as any);

    await expect(
      repository.changeOrganizationSlug({
        organizationId: "org-1",
        nextSlug: "harbor",
      }),
    ).rejects.toBeInstanceOf(OrganizationSlugTakenError);
  });

  it("resolves a retired slug through its reservation", async () => {
    const organizationFindUnique = jest.fn(async () => null);
    const reservationFindUnique = jest.fn(async () => ({
      organization: { id: "org-1", slug: "harbor-new", name: "Harbor" },
    }));
    const database = {
      organization: { findUnique: organizationFindUnique },
      organizationSlugReservation: { findUnique: reservationFindUnique },
    };
    const repository = new OrganizationsProfileRepository(database as any);

    await expect(repository.resolveBySlug("harbor")).resolves.toEqual({
      organizationId: "org-1",
      canonicalSlug: "harbor-new",
      name: "Harbor",
      matchedBy: "alias",
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
    const repository = new OrganizationsProfileRepository(database as any);

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
    const repository = new OrganizationsProfileRepository(database as any);

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
});
