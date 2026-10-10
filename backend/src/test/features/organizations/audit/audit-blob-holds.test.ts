import {
  buildAuditBlobReferences,
  listUnrecordedAuditHolds,
  recordPendingAuditHolds,
} from "@/features/organizations/audit/audit-blob-holds";

const LOGO_ENTRY = {
  id: "audit-1",
  resourceType: "organization",
  restorable: true,
  beforeSnapshot: { logoBlobName: "organizations/o/a.png" },
  afterSnapshot: {},
};

describe("audit blob holds", () => {
  it("builds a row per name a restorable entry holds, and none otherwise", () => {
    expect(
      buildAuditBlobReferences(LOGO_ENTRY).map(({ auditLogId, blobName }) => [
        auditLogId,
        blobName,
      ]),
    ).toEqual([["audit-1", "organizations/o/a.png"]]);
    expect(
      buildAuditBlobReferences({ ...LOGO_ENTRY, restorable: false }),
    ).toEqual([]);
  });

  it("reads the names held by restorable entries not recorded yet", async () => {
    const findMany = jest.fn(async (_args: unknown) => [LOGO_ENTRY]);

    await expect(
      listUnrecordedAuditHolds({
        organizationAuditLog: { findMany },
      } as never),
    ).resolves.toEqual(["organizations/o/a.png"]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        blobHoldsRecorded: false,
        restorable: true,
        resourceType: { in: ["organization", "posting"] },
      },
      select: { resourceType: true, beforeSnapshot: true, afterSnapshot: true },
    });
  });

  it("marks and records each pending entry once, in a transaction", async () => {
    const plain = { ...LOGO_ENTRY, id: "audit-2", restorable: false };
    const raced = { ...LOGO_ENTRY, id: "audit-3" };
    const updateMany = jest.fn(
      async ({ where }: { where: { id: string } }) => ({
        // Another run marked audit-3 first.
        count: where.id === "audit-3" ? 0 : 1,
      }),
    );
    const createMany = jest.fn(async (_args: unknown) => ({ count: 1 }));
    const findMany = jest.fn(async (_args: unknown) => [
      LOGO_ENTRY,
      plain,
      raced,
    ]);
    const prisma = {
      organizationAuditLog: { findMany },
      $transaction: jest.fn(async (run: (tx: unknown) => unknown) =>
        run({
          organizationAuditLog: { updateMany },
          organizationAuditBlobReference: { createMany },
        }),
      ),
    };

    await expect(recordPendingAuditHolds(prisma as never, 10)).resolves.toBe(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { blobHoldsRecorded: false },
        orderBy: { id: "asc" },
        take: 10,
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "audit-1", blobHoldsRecorded: false },
      data: { blobHoldsRecorded: true },
    });
    // Only the restorable entry this run marked gets rows.
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          auditLogId: "audit-1",
          blobName: "organizations/o/a.png",
        }),
      ],
    });
  });
});
