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
            avatarVariants: null,
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

  it("detects a logo a restorable organization entry still holds, by an indexed lookup", async () => {
    const count = jest.fn(async (_args: unknown) => 1);
    const repository = new OrganizationAuditRepository({
      organizationAuditBlobReference: { count },
    } as any);

    await expect(
      repository.hasRestorableOrganizationLogoReference({
        organizationId: ORG_1_ID,
        blobName: `organizations/${ORG_1_ID}/logo-b.png`,
      }),
    ).resolves.toBe(true);
    expect(count).toHaveBeenCalledWith({
      where: {
        blobName: `organizations/${ORG_1_ID}/logo-b.png`,
        auditLog: { organizationId: ORG_1_ID, resourceType: "organization" },
      },
    });

    count.mockResolvedValueOnce(0);
    await expect(
      repository.hasRestorableOrganizationLogoReference({
        organizationId: ORG_1_ID,
        blobName: `organizations/${ORG_1_ID}/logo-a.png`,
      }),
    ).resolves.toBe(false);
  });

  describe("create", () => {
    function createWritingRepository() {
      const transaction = {
        $queryRaw: jest.fn(async () => [{ acquired: 1 }]),
        organizationAuditLog: {
          aggregate: jest.fn(async () => ({
            _max: { organizationVersion: 4, resourceVersion: 1 },
          })),
          create: jest.fn(async ({ data }: { data: Record<string, any> }) => ({
            ...data,
            actor: null,
            createdAt: new Date("2026-10-09T12:00:00.000Z"),
          })),
        },
        organizationAuditBlobReference: {
          createMany: jest.fn(async () => ({ count: 0 })),
        },
      };
      const repository = new OrganizationAuditRepository({
        $transaction: jest.fn(async (run: (tx: unknown) => unknown) =>
          run(transaction),
        ),
      } as any);

      return { repository, transaction };
    }

    it("records the images a restorable entry holds beside it", async () => {
      const { repository, transaction } = createWritingRepository();

      const created = await repository.create({
        organizationId: ORG_1_ID,
        action: "posting.updated",
        resourceType: "posting",
        resourceId: "posting-1",
        summary: "Updated posting",
        beforeSnapshot: {
          photos: [
            {
              blobName: " media/images/u/a.webp ",
              thumbnailBlobName: "media/images/u/thumbnails/a.webp",
            },
          ],
        },
        afterSnapshot: {
          photos: [{ blobName: "media/images/u/a.webp" }, null],
        },
        restorable: true,
      });

      const [[{ data }]] = transaction.organizationAuditBlobReference.createMany
        .mock.calls as unknown as [
        [{ data: Array<{ id: string; auditLogId: string; blobName: string }> }],
      ];
      expect(
        data.map(({ auditLogId, blobName }) => [auditLogId, blobName]),
      ).toEqual([
        [created.id, "media/images/u/a.webp"],
        [created.id, "media/images/u/thumbnails/a.webp"],
      ]);
    });

    it("records nothing for an entry that cannot be restored, or holds no image", async () => {
      const { repository, transaction } = createWritingRepository();

      await repository.create({
        organizationId: ORG_1_ID,
        action: "organization.renamed",
        resourceType: "organization",
        summary: "Updated organization",
        beforeSnapshot: { logoBlobName: "organizations/x/logo.png" },
        restorable: false,
      });
      await repository.create({
        organizationId: ORG_1_ID,
        action: "organization.renamed",
        resourceType: "organization",
        summary: "Updated organization",
        beforeSnapshot: { logoBlobName: null },
        afterSnapshot: { name: "Northwind" },
        restorable: true,
      });

      expect(
        transaction.organizationAuditBlobReference.createMany,
      ).not.toHaveBeenCalled();
    });
  });
});
