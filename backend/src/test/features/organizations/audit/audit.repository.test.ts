import { OrganizationAuditRepository } from "@/features/organizations/audit/audit.repository";
import { testUuid } from "../../../support/uuid";

const ORG_1_ID = testUuid(9000, 9234);
const USER_1_ID = testUuid(9000, 994257);

describe("OrganizationAuditRepository", () => {
  it("lists and maps organization audit history with filters and pagination", async () => {
    const findMany = jest.fn(async () => [
      {
        id: "audit-1",
        organizationId: ORG_1_ID,
        actor: {
          id: USER_1_ID,
          email: "owner@example.com",
          profile: {
            username: "owner-one",
            avatarUrl: "https://example.test/avatar.png",
          },
        },
        action: "organization.restored",
        resourceType: "organization",
        resourceId: null,
        organizationVersion: 2,
        resourceVersion: null,
        summary: "Restored organization profile",
        changes: [
          {
            field: "name",
            before: "Northwind",
            after: "Northwind Rentals",
          },
        ],
        beforeSnapshot: {
          logoBlobName: `organizations/${ORG_1_ID}/old-logo.png`,
        },
        afterSnapshot: {
          logoBlobName: `organizations/${ORG_1_ID}/new-logo.png`,
        },
        restorable: true,
        restoredFromAuditId: null,
        createdAt: new Date("2026-07-16T00:00:00.000Z"),
      },
    ]);
    const count = jest.fn(async () => 1);
    const repository = new OrganizationAuditRepository({
      organizationAuditLog: {
        findMany,
        count,
      },
    } as any);

    await expect(
      repository.list({
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        page: 2,
        pageSize: 1,
        action: "organization.restored",
        resourceType: "organization",
      }),
    ).resolves.toEqual({
      auditLogs: [
        {
          id: "audit-1",
          organizationId: ORG_1_ID,
          actor: {
            id: USER_1_ID,
            email: "owner@example.com",
            username: "owner-one",
            avatarUrl: "https://example.test/avatar.png",
          },
          action: "organization.restored",
          resourceType: "organization",
          resourceId: undefined,
          organizationVersion: 2,
          resourceVersion: undefined,
          summary: "Restored organization profile",
          changes: [
            {
              field: "name",
              before: "Northwind",
              after: "Northwind Rentals",
            },
          ],
          beforeSnapshot: {
            logoBlobName: `organizations/${ORG_1_ID}/old-logo.png`,
          },
          afterSnapshot: {
            logoBlobName: `organizations/${ORG_1_ID}/new-logo.png`,
          },
          restorable: true,
          restoredFromAuditId: undefined,
          createdAt: "2026-07-16T00:00:00.000Z",
        },
      ],
      pagination: {
        page: 2,
        pageSize: 1,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_1_ID,
        action: "organization.restored",
        resourceType: "organization",
      },
      skip: 1,
      take: 1,
      orderBy: {
        createdAt: "desc",
      },
      include: {
        actor: {
          include: {
            profile: true,
          },
        },
      },
    });
    expect(count).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_1_ID,
        action: "organization.restored",
        resourceType: "organization",
      },
    });
  });

  it("detects restorable organization snapshots that still reference a logo blob", async () => {
    const findMany = jest.fn(async () => [
      {
        beforeSnapshot: {
          logoBlobName: `organizations/${ORG_1_ID}/logo-a.png`,
        },
        afterSnapshot: null,
      },
      {
        beforeSnapshot: null,
        afterSnapshot: {
          logoBlobName: `organizations/${ORG_1_ID}/logo-b.png`,
        },
      },
    ]);
    const repository = new OrganizationAuditRepository({
      organizationAuditLog: {
        findMany,
      },
    } as any);

    await expect(
      repository.hasRestorableOrganizationLogoReference({
        organizationId: ORG_1_ID,
        blobName: `organizations/${ORG_1_ID}/logo-b.png`,
      }),
    ).resolves.toBe(true);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_1_ID,
        resourceType: "organization",
        restorable: true,
      },
      select: {
        beforeSnapshot: true,
        afterSnapshot: true,
      },
    });
  });

  it("returns false when no restorable snapshots reference the requested logo blob", async () => {
    const repository = new OrganizationAuditRepository({
      organizationAuditLog: {
        findMany: jest.fn(async () => [
          {
            beforeSnapshot: {
              logoBlobName: `organizations/${ORG_1_ID}/other-logo.png`,
            },
            afterSnapshot: {},
          },
        ]),
      },
    } as any);

    await expect(
      repository.hasRestorableOrganizationLogoReference({
        organizationId: ORG_1_ID,
        blobName: `organizations/${ORG_1_ID}/logo-a.png`,
      }),
    ).resolves.toBe(false);
  });
});
