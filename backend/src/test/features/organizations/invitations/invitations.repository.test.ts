import { OrganizationsInvitationsRepository } from "@/features/organizations/invitations/invitations.repository";
import { testUuid } from "../../../support/uuid";
const INVITE_1_ID = testUuid(9000, 479992);
const INVITE_2_ID = testUuid(9000, 479993);

const ORG_1_ID = testUuid(9000, 9234);
const USER_1_ID = testUuid(9000, 994257);
const USER_9_ID = testUuid(9000, 994265);

function createMembershipPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "membership-1",
    organizationId: ORG_1_ID,
    role: "manager",
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    organization: {
      id: ORG_1_ID,
      name: "Northwind",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    },
    user: {
      id: USER_1_ID,
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
    id: INVITE_1_ID,
    organizationId: ORG_1_ID,
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
      id: ORG_1_ID,
      name: "Northwind",
    },
    invitedByUser: {
      id: USER_1_ID,
      email: "owner@example.com",
      profile: {
        username: "northwind-owner",
      },
    },
    acceptedByUser: null,
    ...overrides,
  };
}

/**
 * Builds a database double whose interactive transaction hands the callback
 * the given invitation (and optionally membership) delegates.
 */
function createTransactionDatabase(
  organizationInvitation: Record<string, unknown>,
  organizationMembership: Record<string, unknown> = {},
) {
  return {
    $transaction: async <T>(callback: (client: unknown) => Promise<T>) =>
      callback({ organizationInvitation, organizationMembership }),
  } as any;
}

describe("OrganizationsInvitationsRepository", () => {
  it("reissues invitations by revoking prior pending rows and mapping the new invite", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const create = jest.fn(async () => createInvitationPersistence());
    const repository = new OrganizationsInvitationsRepository(
      createTransactionDatabase({ updateMany, create }),
    );
    const now = new Date("2026-06-01T00:00:00.000Z");
    const expiresAt = new Date("2026-06-08T00:00:00.000Z");

    const result = await repository.reissueInvitation({
      organizationId: ORG_1_ID,
      invitedByUserId: USER_1_ID,
      email: "teammate@example.com",
      role: "operator",
      tokenHash: "token-hash-2",
      expiresAt,
      now,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_1_ID,
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
        organizationId: ORG_1_ID,
        invitedByUserId: USER_1_ID,
        email: "teammate@example.com",
        role: "operator",
        tokenHash: "token-hash-2",
        expiresAt,
      }),
      include: expect.any(Object),
    });
    expect(result.emailHint).toBe("t***@example.com");
  });

  it("revokes an invitation only while it is still pending", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const findUniqueOrThrow = jest.fn(async () =>
      createInvitationPersistence({
        status: "revoked",
        revokedAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
    );
    const repository = new OrganizationsInvitationsRepository(
      createTransactionDatabase({ updateMany, findUniqueOrThrow }),
    );
    const now = new Date("2026-06-01T00:00:00.000Z");

    const result = await repository.revokeInvitation(INVITE_1_ID, now);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: INVITE_1_ID,
        status: "pending",
      },
      data: {
        status: "revoked",
        revokedAt: now,
      },
    });
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: {
        id: INVITE_1_ID,
      },
      include: expect.any(Object),
    });
    expect(result).toMatchObject({
      id: INVITE_1_ID,
      status: "revoked",
      revokedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("returns null when revoking a missing or non-pending invitation", async () => {
    const updateMany = jest.fn(async () => ({ count: 0 }));
    const findUniqueOrThrow = jest.fn();
    const repository = new OrganizationsInvitationsRepository(
      createTransactionDatabase({ updateMany, findUniqueOrThrow }),
    );

    await expect(
      repository.revokeInvitation(
        INVITE_2_ID,
        new Date("2026-06-01T00:00:00.000Z"),
      ),
    ).resolves.toBeNull();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("expires an invitation only while it is still pending", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const findUniqueOrThrow = jest.fn(async () =>
      createInvitationPersistence({
        status: "expired",
      }),
    );
    const repository = new OrganizationsInvitationsRepository(
      createTransactionDatabase({ updateMany, findUniqueOrThrow }),
    );
    const now = new Date("2026-06-01T00:00:00.000Z");

    const result = await repository.expireInvitation(INVITE_1_ID, now);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: INVITE_1_ID,
        status: "pending",
      },
      data: {
        status: "expired",
        updatedAt: now,
      },
    });
    expect(result).toMatchObject({
      id: INVITE_1_ID,
      status: "expired",
    });
  });

  it("returns null when expiring an invitation that is no longer pending", async () => {
    const updateMany = jest.fn(async () => ({ count: 0 }));
    const findUniqueOrThrow = jest.fn();
    const repository = new OrganizationsInvitationsRepository(
      createTransactionDatabase({ updateMany, findUniqueOrThrow }),
    );

    await expect(
      repository.expireInvitation(
        INVITE_1_ID,
        new Date("2026-06-01T00:00:00.000Z"),
      ),
    ).resolves.toBeNull();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("accepts invitations and maps both the invitation and created membership", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const upsert = jest.fn(async () =>
      createMembershipPersistence({
        id: "membership-9",
        role: "operator",
      }),
    );
    const findUniqueOrThrow = jest.fn(async () =>
      createInvitationPersistence({
        status: "accepted",
        acceptedAt: new Date("2026-06-01T00:00:00.000Z"),
        acceptedByUser: {
          id: USER_9_ID,
          email: "new.member@example.com",
          profile: {
            username: "new-member",
          },
        },
      }),
    );
    const repository = new OrganizationsInvitationsRepository(
      createTransactionDatabase({ updateMany, findUniqueOrThrow }, { upsert }),
    );
    const now = new Date("2026-06-01T00:00:00.000Z");

    const result = await repository.acceptInvitation({
      invitationId: INVITE_1_ID,
      organizationId: ORG_1_ID,
      userId: USER_9_ID,
      role: "operator",
      now,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: INVITE_1_ID,
        status: "pending",
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      data: {
        status: "accepted",
        acceptedByUserId: USER_9_ID,
        acceptedAt: now,
      },
    });
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      upsert.mock.invocationCallOrder[0],
    );
    expect(upsert).toHaveBeenCalledWith({
      where: {
        organizationId_userId: {
          organizationId: ORG_1_ID,
          userId: USER_9_ID,
        },
      },
      update: {},
      create: expect.objectContaining({
        id: expect.any(String),
        organizationId: ORG_1_ID,
        userId: USER_9_ID,
        role: "operator",
      }),
      include: expect.any(Object),
    });
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: {
        id: INVITE_1_ID,
      },
      include: expect.any(Object),
    });
    expect(result).toEqual({
      invitation: {
        id: INVITE_1_ID,
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
          id: USER_1_ID,
          email: "owner@example.com",
          username: "northwind-owner",
        },
        acceptedBy: {
          id: USER_9_ID,
          email: "new.member@example.com",
          username: "new-member",
        },
      },
      membership: {
        membershipId: "membership-9",
        userId: USER_1_ID,
        email: "owner@example.com",
        firstName: "Casey",
        lastName: "Doe",
        username: "northwind-owner",
        avatarUrl: "https://example.test/avatar.png",
        avatarVariants: null,
        role: "operator",
        joinedAt: "2026-05-01T00:00:00.000Z",
      },
    });
  });

  it("returns null without creating a membership when the invitation can no longer be accepted", async () => {
    const updateMany = jest.fn(async () => ({ count: 0 }));
    const upsert = jest.fn();
    const findUniqueOrThrow = jest.fn();
    const repository = new OrganizationsInvitationsRepository(
      createTransactionDatabase({ updateMany, findUniqueOrThrow }, { upsert }),
    );

    await expect(
      repository.acceptInvitation({
        invitationId: INVITE_1_ID,
        organizationId: ORG_1_ID,
        userId: USER_9_ID,
        role: "operator",
        now: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).resolves.toBeNull();
    expect(upsert).not.toHaveBeenCalled();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
