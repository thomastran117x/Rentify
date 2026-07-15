import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
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

function createMember(overrides: Record<string, unknown> = {}) {
  return {
    membershipId: "membership-2",
    userId: "user-2",
    email: "teammate@example.com",
    username: "teammate",
    role: "operator",
    joinedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}

function createAuditLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "audit-original",
    organizationId: "org-1",
    actor: null,
    action: "organization.renamed",
    resourceType: "organization",
    resourceId: "org-1",
    organizationVersion: 1,
    resourceVersion: 1,
    summary: "Original change",
    changes: [],
    beforeSnapshot: {
      id: "org-1",
      name: "Northwind",
    },
    afterSnapshot: {
      id: "org-1",
      name: "Renamed",
    },
    restorable: true,
    restoredFromAuditId: null,
    createdAt: "2026-05-03T00:00:00.000Z",
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

  it("returns no active organization when the user has no memberships", async () => {
    const { service } = createService();

    await expect(service.listMine("user-1")).resolves.toEqual({
      memberships: [],
      activeOrganization: undefined,
    });
  });

  it("sets the active organization for an existing member", async () => {
    const { service, repository } = createService();

    await expect(
      service.setActiveOrganization({
        userId: "user-1",
        organizationId: "org-1",
      }),
    ).resolves.toEqual({
      activeOrganization: {
        id: "org-1",
        name: "Northwind",
        role: "primary_manager",
      },
    });
    expect(repository.setPreferredOrganization).toHaveBeenCalledWith(
      "user-1",
      "org-1",
    );
  });

  it("expires pending invitations while loading organization details", async () => {
    const expiredInvitation = createInvitation({
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    const detail = {
      organization: {
        id: "org-1",
        name: "Northwind",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      viewerRole: "operator",
      members: [],
      invitations: [expiredInvitation],
    };
    const refreshedDetail = {
      ...detail,
      invitations: [
        createInvitation({
          status: "expired",
          expiresAt: "2000-01-01T00:00:00.000Z",
        }),
      ],
    };
    const { service, repository, auditService } = createService({
      repository: {
        findOrganizationDetail: jest
          .fn()
          .mockResolvedValueOnce(detail)
          .mockResolvedValueOnce(refreshedDetail),
      },
    });

    await expect(service.getById("org-1", "user-1")).resolves.toEqual({
      ...refreshedDetail,
      viewerRole: "primary_manager",
    });
    expect(repository.expireInvitation).toHaveBeenCalledWith(
      "invite-1",
      expect.any(Date),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "invitation.expired",
        resourceType: "invitation",
        restorable: true,
      }),
    );
  });

  it("delegates audit listing with the caller filters", async () => {
    const auditResult = {
      auditLogs: [createAuditLog()],
      pagination: { limit: 20, offset: 0, total: 1 },
    };
    const { service, auditService } = createService({
      auditService: {
        list: jest.fn(async () => auditResult),
      },
    });

    await expect(
      service.listAudit({
        organizationId: "org-1",
        actorUserId: "user-1",
        resourceType: "organization",
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toBe(auditResult);
    expect(auditService.list).toHaveBeenCalledWith({
      organizationId: "org-1",
      actorUserId: "user-1",
      resourceType: "organization",
      page: 1,
      pageSize: 20,
    });
  });

  it("renames organizations and does not fail the rename if audit recording fails", async () => {
    const { service, repository, auditService } = createService({
      auditService: {
        record: jest.fn(async () => {
          throw new Error("audit unavailable");
        }),
      },
    });

    await expect(
      service.update({
        organizationId: "org-1",
        actorUserId: "user-1",
        name: "  Better Northwind  ",
      }),
    ).resolves.toEqual({
      id: "org-1",
      name: "Renamed",
      role: "primary_manager",
    });
    expect(repository.updateOrganizationName).toHaveBeenCalledWith(
      "org-1",
      "Better Northwind",
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "organization.renamed",
        changes: [
          {
            field: "name",
            before: "Northwind",
            after: "Renamed",
          },
        ],
      }),
    );
  });

  it("revokes an operator invitation as a manager", async () => {
    const { service, repository } = createService({
      repository: {
        findMembershipAccess: jest.fn(async () =>
          createMembership({
            role: "manager",
          }),
        ),
        findInvitationById: jest.fn(async () =>
          createInvitation({
            role: "operator",
          }),
        ),
      },
    });

    await expect(
      service.revokeInvitation({
        organizationId: "org-1",
        actorUserId: "user-1",
        invitationId: "invite-1",
      }),
    ).resolves.toEqual({
      invitation: expect.objectContaining({
        id: "invite-1",
        status: "revoked",
      }),
    });
    expect(repository.revokeInvitation).toHaveBeenCalledWith(
      "invite-1",
      expect.any(Date),
    );
  });

  it("rejects revoking invitations that are no longer pending", async () => {
    const { service } = createService({
      repository: {
        findInvitationById: jest.fn(async () =>
          createInvitation({
            status: "accepted",
          }),
        ),
      },
    });

    await expect(
      service.revokeInvitation({
        organizationId: "org-1",
        actorUserId: "user-1",
        invitationId: "invite-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("previews anonymous invitations without viewer eligibility", async () => {
    const { service } = createService();

    await expect(
      service.previewInvitation({
        token: "token-123",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        viewer: {
          authenticated: false,
          email: undefined,
          emailVerified: undefined,
          matchesEmail: false,
          canAccept: false,
        },
      }),
    );
  });

  it("returns the existing membership when an invitation was already accepted", async () => {
    const { service } = createService({
      authRepository: {
        findUserById: jest.fn(async () =>
          createUser({
            id: "user-2",
            email: "teammate@example.com",
          }),
        ),
      },
      repository: {
        findInvitationByTokenHash: jest.fn(async () =>
          createInvitation({
            status: "accepted",
          }),
        ),
        findMemberByUserId: jest.fn(async () => createMember()),
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
  });

  it("updates member roles when the actor is the primary manager", async () => {
    const { service, repository } = createService({
      repository: {
        findMemberById: jest.fn(async () => createMember()),
      },
    });

    await expect(
      service.updateMemberRole({
        organizationId: "org-1",
        actorUserId: "user-1",
        membershipId: "membership-2",
        role: "manager",
      }),
    ).resolves.toEqual({
      member: expect.objectContaining({
        membershipId: "membership-2",
        role: "manager",
      }),
    });
    expect(repository.updateMembershipRole).toHaveBeenCalledWith(
      "membership-2",
      "manager",
    );
  });

  it("rejects removing your own organization membership", async () => {
    const { service } = createService({
      repository: {
        findMemberById: jest.fn(async () =>
          createMember({
            membershipId: "membership-1",
            userId: "user-1",
            role: "primary_manager",
          }),
        ),
      },
    });

    await expect(
      service.removeMember({
        organizationId: "org-1",
        actorUserId: "user-1",
        membershipId: "membership-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("restores organization audit snapshots and records a compensating audit", async () => {
    const { service, auditService } = createService({
      auditService: {
        requireRestorableAudit: jest.fn(async () => createAuditLog()),
      },
    });

    await expect(
      service.restoreVersion({
        organizationId: "org-1",
        actorUserId: "user-1",
        auditId: "audit-original",
      }),
    ).resolves.toEqual({
      restored: true,
      auditLog: expect.objectContaining({
        action: "organization.restored",
      }),
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "organization.restored",
        summary: "Organization restored to Northwind.",
        restoredFromAuditId: "audit-original",
        restorable: false,
      }),
    );
  });

  it("restores member audit snapshots and records a compensating audit", async () => {
    const { service, repository, auditService } = createService({
      repository: {
        restoreMembership: jest.fn(async () => createMember()),
      },
      auditService: {
        requireRestorableAudit: jest.fn(async () =>
          createAuditLog({
            resourceType: "member",
            resourceId: "membership-2",
            beforeSnapshot: createMember(),
            afterSnapshot: createMember({ role: "manager" }),
          }),
        ),
      },
    });

    await service.restoreVersion({
      organizationId: "org-1",
      actorUserId: "user-1",
      auditId: "audit-original",
    });

    expect(repository.restoreMembership).toHaveBeenCalledWith({
      membershipId: "membership-2",
      organizationId: "org-1",
      userId: "user-2",
      role: "operator",
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member.restored",
        summary: "teammate was restored as operator.",
      }),
    );
  });

  it("restores posting snapshots through the postings repository", async () => {
    const restored = { id: "posting-1", name: "Camera Kit" };
    const { service, postingsRepository, auditService } = createService({
      postingsRepository: {
        restoreFromSnapshot: jest.fn(async () => restored),
      },
      auditService: {
        requireRestorableAudit: jest.fn(async () =>
          createAuditLog({
            resourceType: "posting",
            resourceId: "posting-1",
            beforeSnapshot: restored,
            afterSnapshot: null,
          }),
        ),
      },
    });

    await service.restoreVersion({
      organizationId: "org-1",
      actorUserId: "user-1",
      auditId: "audit-original",
    });

    expect(postingsRepository.restoreFromSnapshot).toHaveBeenCalledWith(restored);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "posting.restored",
        resourceType: "posting",
      }),
    );
  });

  it("restores posting availability snapshots through the postings repository", async () => {
    const restored = { id: "block-1" };
    const { service, postingsRepository, auditService } = createService({
      postingsRepository: {
        restoreOwnerAvailabilityBlock: jest.fn(async () => restored),
      },
      auditService: {
        requireRestorableAudit: jest.fn(async () =>
          createAuditLog({
            resourceType: "posting_availability",
            resourceId: "block-1",
            beforeSnapshot: restored,
            afterSnapshot: null,
          }),
        ),
      },
    });

    await service.restoreVersion({
      organizationId: "org-1",
      actorUserId: "user-1",
      auditId: "audit-original",
    });

    expect(postingsRepository.restoreOwnerAvailabilityBlock).toHaveBeenCalledWith(
      restored,
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "posting_availability.restored",
        resourceType: "posting_availability",
      }),
    );
  });

  it("restores seasonal pricing snapshots through the seasonal pricing repository", async () => {
    const restored = { id: "price-1", name: "Summer" };
    const { service, seasonalPricingRepository, auditService } = createService({
      seasonalPricingRepository: {
        restore: jest.fn(async () => restored),
      },
      auditService: {
        requireRestorableAudit: jest.fn(async () =>
          createAuditLog({
            resourceType: "seasonal_pricing",
            resourceId: "price-1",
            beforeSnapshot: restored,
            afterSnapshot: null,
          }),
        ),
      },
    });

    await service.restoreVersion({
      organizationId: "org-1",
      actorUserId: "user-1",
      auditId: "audit-original",
    });

    expect(seasonalPricingRepository.restore).toHaveBeenCalledWith(restored);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "seasonal_pricing.restored",
        resourceType: "seasonal_pricing",
      }),
    );
  });

  it("restores invitations by issuing a fresh invite token", async () => {
    const { service, repository, emailService, auditService } = createService({
      auditService: {
        requireRestorableAudit: jest.fn(async () =>
          createAuditLog({
            resourceType: "invitation",
            resourceId: "invite-1",
            beforeSnapshot: createInvitation(),
            afterSnapshot: createInvitation({ status: "revoked" }),
          }),
        ),
      },
    });

    await expect(
      service.restoreVersion({
        organizationId: "org-1",
        actorUserId: "user-1",
        auditId: "audit-original",
      }),
    ).resolves.toEqual({
      restored: true,
      auditLog: expect.objectContaining({
        action: "invitation.restored",
      }),
    });
    expect(repository.reissueInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "teammate@example.com",
        role: "operator",
        tokenHash: expect.any(String),
      }),
    );
    expect(emailService.sendOrganizationInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "teammate@example.com",
        role: "operator",
        token: expect.any(String),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "invitation.restored",
        restoredFromAuditId: "audit-original",
      }),
    );
  });

  it("rejects unrestorable organization snapshots", async () => {
    const { service } = createService({
      auditService: {
        requireRestorableAudit: jest.fn(async () =>
          createAuditLog({
            beforeSnapshot: {
              id: "org-1",
            },
          }),
        ),
      },
    });

    await expect(
      service.restoreVersion({
        organizationId: "org-1",
        actorUserId: "user-1",
        auditId: "audit-original",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
