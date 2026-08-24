import BadRequestError from "@/errors/http/bad-request.error";
import { OrganizationMembersService } from "@/features/organizations/members/members.service";

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
  auditService?: Record<string, jest.Mock>;
}) {
  const repository = {
    listMembershipsByUserId: jest.fn(async () => []),
    findMembershipAccess: jest.fn(async () => createMembership()),
    setPreferredOrganization: jest.fn(async () => undefined),
    findMemberById: jest.fn(async () => null),
    updateMembershipRole: jest.fn(async () => ({
      membershipId: "membership-2",
      userId: "user-2",
      email: "teammate@example.com",
      username: "teammate",
      role: "manager",
      joinedAt: "2026-05-02T00:00:00.000Z",
    })),
    removeMembership: jest.fn(async () => true),
    ...(overrides?.repository ?? {}),
  };
  const authRepository = {
    findUserById: jest.fn(async () => createUser()),
    ...(overrides?.authRepository ?? {}),
  };
  const auditService = {
    recordSafely: jest.fn(async () => undefined),
    ...(overrides?.auditService ?? {}),
  };

  return {
    service: new OrganizationMembersService(
      repository as any,
      repository as any,
      authRepository as any,
      auditService as any,
    ),
    repository,
    authRepository,
    auditService,
  };
}

describe("OrganizationMembersService", () => {
  it("lists memberships and resolves the active organization", async () => {
    const memberships = [
      {
        membershipId: "membership-1",
        id: "org-1",
        slug: "northwind",
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
        slug: "northwind",
        name: "Northwind",
        role: "primary_manager",
      },
    });
    expect(repository.listMembershipsByUserId).toHaveBeenCalledWith(
      "user-1",
      "org-1",
    );
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
        slug: "northwind",
        name: "Northwind",
        role: "primary_manager",
      },
    });
    expect(repository.setPreferredOrganization).toHaveBeenCalledWith(
      "user-1",
      "org-1",
    );
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

  it("blocks primary-manager role transfer during member updates", async () => {
    const { service } = createService({
      repository: {
        findMemberById: jest.fn(async () => createMember({ role: "manager" })),
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

  it("lets managers remove operators but not themselves", async () => {
    const { service, repository } = createService({
      repository: {
        findMembershipAccess: jest.fn(async () =>
          createMembership({
            membershipId: "membership-manager",
            role: "manager",
          }),
        ),
        findMemberById: jest.fn(async () => createMember()),
      },
      authRepository: {
        findUserById: jest
          .fn()
          .mockResolvedValueOnce(createUser())
          .mockResolvedValueOnce(
            createUser({
              id: "user-2",
              email: "teammate@example.com",
              preferredOrganizationId: "org-1",
            }),
          ),
      },
    });

    await expect(
      service.removeMember({
        organizationId: "org-1",
        actorUserId: "user-1",
        membershipId: "membership-2",
      }),
    ).resolves.toEqual({
      removed: true,
      membershipId: "membership-2",
    });
    expect(repository.setPreferredOrganization).toHaveBeenCalledWith(
      "user-2",
      null,
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
});
