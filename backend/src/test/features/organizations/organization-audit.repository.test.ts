import { OrganizationAuditRepository } from "@/features/organizations/organization-audit.repository";

describe("OrganizationAuditRepository", () => {
  it("lists and maps organization audit history with filters and pagination", async () => {
    const findMany = jest.fn(async () => [
      {
        id: "audit-1",
        organizationId: "org-1",
        actor: {
          id: "user-1",
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
          logoBlobName: "organizations/org-1/old-logo.png",
        },
        afterSnapshot: {
          logoBlobName: "organizations/org-1/new-logo.png",
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
        organizationId: "org-1",
        actorUserId: "user-1",
        page: 2,
        pageSize: 1,
        action: "organization.restored",
        resourceType: "organization",
      }),
    ).resolves.toEqual({
      auditLogs: [
        {
          id: "audit-1",
          organizationId: "org-1",
          actor: {
            id: "user-1",
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
            logoBlobName: "organizations/org-1/old-logo.png",
          },
          afterSnapshot: {
            logoBlobName: "organizations/org-1/new-logo.png",
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
        organizationId: "org-1",
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
        organizationId: "org-1",
        action: "organization.restored",
        resourceType: "organization",
      },
    });
  });

  it("detects restorable organization snapshots that still reference a logo blob", async () => {
    const findMany = jest.fn(async () => [
      {
        beforeSnapshot: {
          logoBlobName: "organizations/org-1/logo-a.png",
        },
        afterSnapshot: null,
      },
      {
        beforeSnapshot: null,
        afterSnapshot: {
          logoBlobName: "organizations/org-1/logo-b.png",
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
        organizationId: "org-1",
        blobName: "organizations/org-1/logo-b.png",
      }),
    ).resolves.toBe(true);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
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
              logoBlobName: "organizations/org-1/other-logo.png",
            },
            afterSnapshot: {},
          },
        ]),
      },
    } as any);

    await expect(
      repository.hasRestorableOrganizationLogoReference({
        organizationId: "org-1",
        blobName: "organizations/org-1/logo-a.png",
      }),
    ).resolves.toBe(false);
  });
});
