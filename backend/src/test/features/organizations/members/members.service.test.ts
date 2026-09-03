import BadRequestError from "@/errors/http/bad-request.error";
import { OrganizationMembersService } from "@/features/organizations/members/members.service";
import { testUuid } from "../../../support/uuid";

const MEMBERSHIP_1_ID = testUuid(9000, 649718);
const MEMBERSHIP_2_ID = testUuid(9000, 649719);
const ORG_1_ID = testUuid(9000, 9234);
const USER_1_ID = testUuid(9000, 994257);

function createUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_1_ID,
    email: "owner@example.com",
    emailVerified: true,
    preferredOrganizationId: ORG_1_ID,
    organizationMemberships: [],
    ...overrides,
  };
}

function createMembership(overrides: Record<string, unknown> = {}) {
  return {
    membershipId: MEMBERSHIP_1_ID,
    role: "primary_manager",
    organization: {
      id: ORG_1_ID,
      slug: "northwind",
      name: "Northwind",
    },
    ...overrides,
  };
}

function createMember(overrides: Record<string, unknown> = {}) {
  return {
    membershipId: MEMBERSHIP_2_ID,
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
      membershipId: MEMBERSHIP_2_ID,
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
        membershipId: MEMBERSHIP_1_ID,
        id: ORG_1_ID,
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

    await expect(service.listMine(USER_1_ID)).resolves.toEqual({
      memberships,
      activeOrganization: {
        id: ORG_1_ID,
        slug: "northwind",
        name: "Northwind",
        role: "primary_manager",
      },
    });
    expect(repository.listMembershipsByUserId).toHaveBeenCalledWith(
      USER_1_ID,
      ORG_1_ID,
    );
  });

  it("returns no active organization when the user has no memberships", async () => {
    const { service } = createService();

    await expect(service.listMine(USER_1_ID)).resolves.toEqual({
      memberships: [],
      activeOrganization: undefined,
    });
  });

  it("sets the active organization for an existing member", async () => {
    const { service, repository } = createService();

    await expect(
      service.setActiveOrganization({
        userId: USER_1_ID,
        organizationId: ORG_1_ID,
      }),
    ).resolves.toEqual({
      activeOrganization: {
        id: ORG_1_ID,
        slug: "northwind",
        name: "Northwind",
        role: "primary_manager",
      },
    });
    expect(repository.setPreferredOrganization).toHaveBeenCalledWith(
      USER_1_ID,
      ORG_1_ID,
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
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        membershipId: MEMBERSHIP_2_ID,
        role: "manager",
      }),
    ).resolves.toEqual({
      member: expect.objectContaining({
        membershipId: MEMBERSHIP_2_ID,
        role: "manager",
      }),
    });
    expect(repository.updateMembershipRole).toHaveBeenCalledWith(
      MEMBERSHIP_2_ID,
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
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        membershipId: MEMBERSHIP_2_ID,
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
              preferredOrganizationId: ORG_1_ID,
            }),
          ),
      },
    });

    await expect(
      service.removeMember({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        membershipId: MEMBERSHIP_2_ID,
      }),
    ).resolves.toEqual({
      removed: true,
      membershipId: MEMBERSHIP_2_ID,
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
            membershipId: MEMBERSHIP_1_ID,
            userId: USER_1_ID,
            role: "primary_manager",
          }),
        ),
      },
    });

    await expect(
      service.removeMember({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        membershipId: MEMBERSHIP_1_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
