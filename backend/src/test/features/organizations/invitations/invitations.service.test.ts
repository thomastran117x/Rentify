import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import { OrganizationInvitationsService } from "@/features/organizations/invitations/invitations.service";

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
      slug: "northwind",
      name: "Northwind",
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
      slug: "northwind",
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

function createService(overrides?: {
  repository?: Record<string, jest.Mock>;
  authRepository?: Record<string, jest.Mock>;
  emailService?: Record<string, jest.Mock>;
  auditService?: Record<string, jest.Mock>;
}) {
  const repository = {
    findMembershipAccess: jest.fn(async () => createMembership()),
    findMemberByEmail: jest.fn(async () => null),
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
      createInvitation({ status: "expired" }),
    ),
    findMemberByUserId: jest.fn(async () => null),
    listMembershipsByUserId: jest.fn(async () => []),
    acceptInvitation: jest.fn(async () => ({
      invitation: createInvitation({
        status: "accepted",
        acceptedAt: "2026-05-03T00:00:00.000Z",
      }),
      membership: createMember(),
    })),
    setPreferredOrganization: jest.fn(async () => undefined),
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
    recordSafely: jest.fn(async () => undefined),
    ...(overrides?.auditService ?? {}),
  };

  return {
    service: new OrganizationInvitationsService(
      repository as any,
      authRepository as any,
      emailService as any,
      auditService as any,
    ),
    repository,
    authRepository,
    emailService,
    auditService,
  };
}

describe("OrganizationInvitationsService", () => {
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
          createMembership({ role: "manager" }),
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

  it("previews anonymous invitations without viewer eligibility", async () => {
    const { service } = createService();

    await expect(
      service.previewInvitation({ token: "token-123" }),
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
      service.acceptInvitation({ token: "token-123", userId: "user-2" }),
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
      service.acceptInvitation({ token: "token-123", userId: "user-2" }),
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
      service.acceptInvitation({ token: "token-123", userId: "user-2" }),
    ).resolves.toEqual({
      accepted: true,
      organization: {
        id: "org-1",
        slug: "northwind",
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

  it("returns the existing membership when an invitation was already accepted", async () => {
    const { service } = createService({
      authRepository: {
        findUserById: jest.fn(async () =>
          createUser({ id: "user-2", email: "teammate@example.com" }),
        ),
      },
      repository: {
        findInvitationByTokenHash: jest.fn(async () =>
          createInvitation({ status: "accepted" }),
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
      service.acceptInvitation({ token: "token-123", userId: "user-2" }),
    ).resolves.toEqual({
      accepted: true,
      organization: {
        id: "org-1",
        slug: "northwind",
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

  it("revokes an operator invitation as a manager", async () => {
    const { service, repository } = createService({
      repository: {
        findMembershipAccess: jest.fn(async () =>
          createMembership({ role: "manager" }),
        ),
        findInvitationById: jest.fn(async () =>
          createInvitation({ role: "operator" }),
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
          createInvitation({ status: "accepted" }),
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

  it("expires pending invitations in bulk and records an audit entry per invitation", async () => {
    const { service, repository, auditService } = createService();
    const expiredInvitation = createInvitation({
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    await expect(
      service.expirePendingInvitations("org-1", [expiredInvitation]),
    ).resolves.toBe(true);
    expect(repository.expireInvitation).toHaveBeenCalledWith(
      "invite-1",
      expect.any(Date),
    );
    expect(auditService.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "invitation.expired",
        resourceType: "invitation",
        restorable: true,
      }),
    );
  });

  it("is a no-op when no invitations are past their expiry", async () => {
    const { service, repository } = createService();

    await expect(
      service.expirePendingInvitations("org-1", [createInvitation()]),
    ).resolves.toBe(false);
    expect(repository.expireInvitation).not.toHaveBeenCalled();
  });
});
