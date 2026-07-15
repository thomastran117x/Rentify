import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { OrganizationsService } from "@/features/organizations/organizations.service";

function createUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "owner@example.com",
    emailVerified: true,
    preferredOrganizationId: "org-1",
    organizationMemberships: [],
    ...overrides,
  };
}

function createMembership(overrides: Record<string, unknown> = {}) {
  return {
    membershipId: "membership-1",
    role: "primary_manager",
    organization: {
      id: "org-1",
      name: "Northwind",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function createInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "invite-1",
    email: "teammate@example.com",
    emailHint: "t***@example.com",
    role: "operator",
    status: "pending",
    expiresAt: "2099-06-01T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    invitedBy: {
      id: "user-1",
      email: "owner@example.com",
      username: "owner-one",
    },
    organization: {
      id: "org-1",
      name: "Northwind",
    },
    ...overrides,
  };
}

function createService(overrides?: {
  repository?: Record<string, jest.Mock>;
  authRepository?: Record<string, jest.Mock>;
  emailService?: Record<string, jest.Mock>;
  auditService?: Record<string, jest.Mock>;
  postingsRepository?: Record<string, jest.Mock>;
  seasonalPricingRepository?: Record<string, jest.Mock>;
}) {
  const repository = {
    listMembershipsByUserId: jest.fn(async () => []),
    createOrganizationWithOwner: jest.fn(async () => ({
      membershipId: "membership-9",
      id: "org-9",
      name: "Acme Rentals",
      role: "primary_manager" as const,
      joinedAt: "2026-06-01T00:00:00.000Z",
      isActive: true,
    })),
    findMembershipAccess: jest.fn(async () => createMembership()),
    findOrganizationDetail: jest.fn(async () => ({
      organization: {
        id: "org-1",
        name: "Northwind",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      viewerRole: "operator",
      members: [],
      invitations: [],
    })),
    setPreferredOrganization: jest.fn(async () => undefined),
    updateOrganizationName: jest.fn(async () => ({
      id: "org-1",
      name: "Renamed",
      role: "operator",
    })),
    findMemberById: jest.fn(async () => null),
    findMemberByUserId: jest.fn(async () => null),
    findMemberByEmail: jest.fn(async () => null),
    updateMembershipRole: jest.fn(async () => ({
      membershipId: "membership-2",
      userId: "user-2",
      email: "teammate@example.com",
      username: "teammate",
      role: "manager",
      joinedAt: "2026-05-02T00:00:00.000Z",
    })),
    removeMembership: jest.fn(async () => true),
    reissueInvitation: jest.fn(async () => createInvitation()),
    findInvitationById: jest.fn(async () => createInvitation()),
    findInvitationByTokenHash: jest.fn(async () => createInvitation()),
    revokeInvitation: jest.fn(async () =>
      createInvitation({
        status: "revoked",
        revokedAt: "2026-05-03T00:00:00.000Z",
      }),
    ),
    expireInvitation: jest.fn(async () =>
      createInvitation({
        status: "expired",
      }),
    ),
    acceptInvitation: jest.fn(async () => ({
      invitation: createInvitation({
        status: "accepted",
        acceptedAt: "2026-05-03T00:00:00.000Z",
      }),
      membership: {
        membershipId: "membership-2",
        userId: "user-2",
        email: "teammate@example.com",
        username: "teammate",
        role: "operator",
        joinedAt: "2026-05-03T00:00:00.000Z",
      },
    })),
    ...(overrides?.repository ?? {}),
  };
  const authRepository = {
    findUserById: jest.fn(async () => createUser()),
    ...(overrides?.authRepository ?? {}),
  };
  const emailService = {
    sendOrganizationInviteEmail: jest.fn(async () => undefined),
    ...(overrides?.emailService ?? {}),
  };
  const auditService = {
    record: jest.fn(async (entry) => ({ id: "audit-1", ...entry })),
    list: jest.fn(async () => ({ auditLogs: [], pagination: {} })),
    requireRestorableAudit: jest.fn(),
    ...(overrides?.auditService ?? {}),
  };
  const postingsRepository = {
    restoreFromSnapshot: jest.fn(),
    restoreOwnerAvailabilityBlock: jest.fn(),
    ...(overrides?.postingsRepository ?? {}),
  };
  const seasonalPricingRepository = {
    restore: jest.fn(),
    ...(overrides?.seasonalPricingRepository ?? {}),
  };

  return {
    service: new OrganizationsService(
      repository as never,
      authRepository as never,
      emailService as never,
      auditService as never,
      postingsRepository as never,
      seasonalPricingRepository as never,
    ),
    repository,
    authRepository,
    emailService,
    auditService,
    postingsRepository,
    seasonalPricingRepository,
  };
}

describe("OrganizationsService", () => {
  it("lists memberships and resolves the active organization", async () => {
    const memberships = [
      {
        membershipId: "membership-1",
        id: "org-1",
        name: "Northwind",
        role: "primary_manager",
        joinedAt: "2026-05-01T00:00:00.000Z",
        isActive: true,
      },
    ];
    const { service, repository } = createService({
      repository: {
        listMembershipsByUserId: jest.fn(async () => memberships),
      },
    });

    await expect(service.listMine("user-1")).resolves.toEqual({
      memberships,
      activeOrganization: {
        id: "org-1",
        name: "Northwind",
        role: "primary_manager",
      },
    });
    expect(repository.listMembershipsByUserId).toHaveBeenCalledWith(
      "user-1",
      "org-1",
    );
  });

  it("creates an organization, assigns the creator as primary manager, and sets it active", async () => {
    const membership = {
      membershipId: "membership-9",
      id: "org-9",
      name: "Acme Rentals",
      role: "primary_manager" as const,
      joinedAt: "2026-06-01T00:00:00.000Z",
      isActive: true,
    };
    const { service, repository } = createService({
      repository: {
        createOrganizationWithOwner: jest.fn(async () => membership),
      },
    });

    const result = await service.createOrganization({
      actorUserId: "user-1",
      name: "  Acme Rentals  ",
    });

    expect(repository.createOrganizationWithOwner).toHaveBeenCalledWith({
      name: "Acme Rentals",
      ownerUserId: "user-1",
    });
    expect(repository.setPreferredOrganization).toHaveBeenCalledWith(
      "user-1",
      "org-9",
    );
    expect(result).toEqual({
      organization: {
        id: "org-9",
        name: "Acme Rentals",
        role: "primary_manager",
      },
      membership: { ...membership, isActive: true },
    });
  });

  it("rejects organization creation for a missing user", async () => {
    const { service, repository } = createService({
      authRepository: {
        findUserById: jest.fn(async () => null),
      },
      repository: {
        createOrganizationWithOwner: jest.fn(async () => {
          throw new Error("should not be called");
        }),
      },
    });

    await expect(
      service.createOrganization({ actorUserId: "ghost", name: "Acme" }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(repository.createOrganizationWithOwner).not.toHaveBeenCalled();
  });

  it("allows a primary manager to create a manager invitation and sends email", async () => {
    const { service, repository, emailService } = createService();

    const result = await service.createInvitation({
      organizationId: "org-1",
      actorUserId: "user-1",
      email: "Teammate@Example.com",
      role: "manager",
    });

    expect(repository.reissueInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        invitedByUserId: "user-1",
        email: "teammate@example.com",
        role: "manager",
      }),
    );
    expect(emailService.sendOrganizationInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "teammate@example.com",
        organizationName: "Northwind",
        role: "manager",
        token: expect.any(String),
      }),
    );
    expect(result.invitation.email).toBe("teammate@example.com");
  });

  it("prevents managers from inviting other managers", async () => {
    const { service } = createService({
      repository: {
        findMembershipAccess: jest.fn(async () =>
          createMembership({
            role: "manager",
          }),
        ),
      },
    });

    await expect(
      service.createInvitation({
        organizationId: "org-1",
        actorUserId: "user-1",
        email: "teammate@example.com",
        role: "manager",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("previews invitations with viewer eligibility details", async () => {
    const { service } = createService({
      authRepository: {
        findUserById: jest.fn(async () =>
          createUser({
            id: "user-2",
            email: "teammate@example.com",
            emailVerified: true,
          }),
        ),
      },
    });

    await expect(
      service.previewInvitation({
        token: "token-123",
        userId: "user-2",
      }),
    ).resolves.toEqual({
      invitation: {
        organizationId: "org-1",
        organizationName: "Northwind",
        emailHint: "t***@example.com",
        role: "operator",
        status: "pending",
        expiresAt: "2099-06-01T00:00:00.000Z",
      },
      viewer: {
        authenticated: true,
        email: "teammate@example.com",
        emailVerified: true,
        matchesEmail: true,
        canAccept: true,
      },
    });
  });

  it("requires verified email before accepting an invitation", async () => {
    const { service } = createService({
      authRepository: {
        findUserById: jest.fn(async () =>
          createUser({
            id: "user-2",
            email: "teammate@example.com",
            emailVerified: false,
            preferredOrganizationId: null,
          }),
        ),
      },
    });

    await expect(
      service.acceptInvitation({
        token: "token-123",
        userId: "user-2",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects invitations when the signed-in email does not match", async () => {
    const { service } = createService({
      authRepository: {
        findUserById: jest.fn(async () =>
          createUser({
            id: "user-2",
            email: "other@example.com",
            preferredOrganizationId: null,
          }),
        ),
      },
    });

    await expect(
      service.acceptInvitation({
        token: "token-123",
        userId: "user-2",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("accepts invitations and sets the preferred organization for first-time members", async () => {
    const { service, repository } = createService({
      authRepository: {
        findUserById: jest.fn(async () =>
          createUser({
            id: "user-2",
            email: "teammate@example.com",
            preferredOrganizationId: null,
          }),
        ),
      },
      repository: {
        listMembershipsByUserId: jest.fn(async () => [
          {
            membershipId: "membership-2",
            id: "org-1",
            name: "Northwind",
            role: "operator",
            joinedAt: "2026-05-03T00:00:00.000Z",
            isActive: true,
          },
        ]),
      },
    });

    await expect(
      service.acceptInvitation({
        token: "token-123",
        userId: "user-2",
      }),
    ).resolves.toEqual({
      accepted: true,
      organization: {
        id: "org-1",
        name: "Northwind",
        role: "operator",
      },
      membership: {
        membershipId: "membership-2",
        id: "org-1",
        name: "Northwind",
        role: "operator",
        joinedAt: "2026-05-03T00:00:00.000Z",
        isActive: true,
      },
    });
    expect(repository.setPreferredOrganization).toHaveBeenCalledWith(
      "user-2",
      "org-1",
    );
  });

  it("lets managers remove operators but not themselves", async () => {
    const { service, repository } = createService({
      repository: {
        findMembershipAccess: jest.fn(async () =>
          createMembership({
            membershipId: "membership-manager",
            role: "manager",
          }),
        ),
        findMemberById: jest.fn(async () => ({
          membershipId: "membership-operator",
          userId: "user-2",
          email: "operator@example.com",
          username: "operator",
          role: "operator",
          joinedAt: "2026-05-03T00:00:00.000Z",
        })),
      },
      authRepository: {
        findUserById: jest
          .fn()
          .mockResolvedValueOnce(createUser())
          .mockResolvedValueOnce(
            createUser({
              id: "user-2",
              email: "operator@example.com",
              preferredOrganizationId: "org-1",
            }),
          ),
      },
    });

    await expect(
      service.removeMember({
        organizationId: "org-1",
        actorUserId: "user-1",
        membershipId: "membership-operator",
      }),
    ).resolves.toEqual({
      removed: true,
      membershipId: "membership-operator",
    });
    expect(repository.setPreferredOrganization).toHaveBeenCalledWith(
      "user-2",
      null,
    );
  });

  it("blocks primary-manager role transfer during member updates", async () => {
    const { service } = createService({
      repository: {
        findMemberById: jest.fn(async () => ({
          membershipId: "membership-2",
          userId: "user-2",
          email: "teammate@example.com",
          username: "teammate",
          role: "manager",
          joinedAt: "2026-05-02T00:00:00.000Z",
        })),
      },
    });

    await expect(
      service.updateMemberRole({
        organizationId: "org-1",
        actorUserId: "user-1",
        membershipId: "membership-2",
        role: "primary_manager",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

