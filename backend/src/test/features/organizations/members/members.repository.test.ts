import { OrganizationsMembersRepository } from "@/features/organizations/members/members.repository";
import { testUuid } from "../../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);

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

describe("OrganizationsMembersRepository", () => {
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
    const repository = new OrganizationsMembersRepository({
      organizationMembership: {
        findMany,
      },
    } as any);

    const result = await repository.listMembershipsByUserId(USER_1_ID, "org-2");

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: USER_1_ID,
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
});
