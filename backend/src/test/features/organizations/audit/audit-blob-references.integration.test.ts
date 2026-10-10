import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asUuid } from "@/configuration/validation/uuid";
import type { CreateOrganizationAuditLogInput } from "@/features/organizations/audit/audit.model";
import { BlobCleanupRepository } from "@/features/blob/blob-cleanup.repository";
import { MediaRepository } from "@/features/media/media.repository";
import { OrganizationAuditRepository } from "@/features/organizations/audit/audit.repository";
import {
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../../support/persistence-test-app";

const BACKFILL_MIGRATION = join(
  process.cwd(),
  "prisma",
  "migrations",
  "20261009130000_organization_audit_blob_references",
  "migration.sql",
);

/** The migration's backfill statement, as it ran against older entries. */
function readBackfillStatement(): string {
  const migration = readFileSync(BACKFILL_MIGRATION, "utf8");
  const start = migration.indexOf(
    "INSERT INTO `organization_audit_blob_references`",
  );

  expect(start).toBeGreaterThan(-1);
  return migration.slice(start).trim().replace(/;$/, "");
}

describe("Organization audit blob references persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  function listReferences() {
    return persistenceApp.prisma.organizationAuditBlobReference.findMany({
      select: { auditLogId: true, blobName: true },
      orderBy: [{ auditLogId: "asc" }, { blobName: "asc" }],
    });
  }

  it("backfills older entries with exactly the names new entries record", async () => {
    const organization =
      await persistenceApp.prisma.organization.findFirstOrThrow();
    const repository = new OrganizationAuditRepository(persistenceApp.prisma);
    const entries: Array<
      Pick<
        CreateOrganizationAuditLogInput,
        | "action"
        | "resourceType"
        | "resourceId"
        | "beforeSnapshot"
        | "afterSnapshot"
        | "restorable"
      >
    > = [
      {
        action: "organization.renamed",
        resourceType: "organization",
        beforeSnapshot: { logoBlobName: " organizations/o/a.png " },
        afterSnapshot: { logoBlobName: null },
        restorable: true,
      },
      {
        action: "organization.renamed",
        resourceType: "organization",
        beforeSnapshot: { logoBlobName: "organizations/o/b.png" },
        afterSnapshot: { logoBlobName: "organizations/o/b.png" },
        restorable: true,
      },
      {
        action: "posting.updated",
        resourceType: "posting",
        resourceId: "posting-1",
        beforeSnapshot: {
          photos: [
            { blobName: "p/1.jpg", thumbnailBlobName: "p/t1.webp" },
            null,
            "not a photo",
            { blobName: 5 },
          ],
        },
        afterSnapshot: { photos: "invalid" },
        restorable: true,
      },
      {
        action: "posting.updated",
        resourceType: "posting",
        resourceId: "posting-1",
        beforeSnapshot: {
          photos: [{ blobName: "p/2.jpg", thumbnailBlobName: null }],
        },
        afterSnapshot: {
          photos: [{ blobName: "p/2.jpg" }, { blobName: "  " }],
        },
        restorable: true,
      },
      {
        action: "posting.updated",
        resourceType: "posting",
        resourceId: "posting-1",
        beforeSnapshot: { photos: [{ blobName: "p/not-restorable.jpg" }] },
        restorable: false,
      },
    ];

    for (const entry of entries) {
      await repository.create({
        ...entry,
        organizationId: asUuid(organization.id),
        summary: "Held by the backfill test.",
      });
    }

    const recorded = await listReferences();
    expect(recorded.map((row) => row.blobName).sort()).toEqual([
      "organizations/o/a.png",
      "organizations/o/b.png",
      "p/1.jpg",
      "p/2.jpg",
      "p/t1.webp",
    ]);

    await persistenceApp.prisma.organizationAuditBlobReference.deleteMany();
    await persistenceApp.prisma.$executeRawUnsafe(readBackfillStatement());

    await expect(listReferences()).resolves.toEqual(recorded);
  });

  it("finds a held name by index, and drops it with its entry", async () => {
    const organization =
      await persistenceApp.prisma.organization.findFirstOrThrow();
    const repository = new OrganizationAuditRepository(persistenceApp.prisma);
    const entry = await repository.create({
      organizationId: asUuid(organization.id),
      action: "organization.renamed",
      resourceType: "organization",
      summary: "Held by the index test.",
      beforeSnapshot: { logoBlobName: "organizations/o/held.png" },
      afterSnapshot: {},
      restorable: true,
    });

    await expect(
      repository.hasRestorableOrganizationLogoReference({
        organizationId: asUuid(organization.id),
        blobName: "organizations/o/held.png",
      }),
    ).resolves.toBe(true);

    await persistenceApp.prisma.organizationAuditLog.delete({
      where: { id: entry.id },
    });
    await expect(listReferences()).resolves.toEqual([]);
  });

  it("keeps what an older instance's entry holds, then records it", async () => {
    const organization =
      await persistenceApp.prisma.organization.findFirstOrThrow();
    const latest = await persistenceApp.prisma.organizationAuditLog.aggregate({
      where: { organizationId: organization.id },
      _max: { organizationVersion: true },
    });
    const held = "organizations/o/written-by-old-release.png";
    // Written the way the release before the side table wrote entries: no
    // rows beside it, and blob_holds_recorded left at its default.
    const entry = await persistenceApp.prisma.organizationAuditLog.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        action: "organization.renamed",
        resourceType: "organization",
        organizationVersion: (latest._max.organizationVersion ?? 0) + 1,
        summary: "Written during a rolling deploy.",
        beforeSnapshot: { logoBlobName: held },
        afterSnapshot: {},
        restorable: true,
      },
    });
    const mediaRepository = new MediaRepository(persistenceApp.prisma);
    const auditRepository = new OrganizationAuditRepository(
      persistenceApp.prisma,
    );

    // Every reader keeps the image before its hold is recorded.
    await expect(
      mediaRepository.listAuditHeldBlobNames([held, "organizations/o/x.png"]),
    ).resolves.toEqual(new Set([held]));
    await expect(
      auditRepository.hasRestorableOrganizationLogoReference({
        organizationId: asUuid(organization.id),
        blobName: held,
      }),
    ).resolves.toBe(true);
    const { blobNames } = await new BlobCleanupRepository(
      persistenceApp.prisma,
    ).loadReferences();
    expect(blobNames.has(held)).toBe(true);

    // The media cleanup records it once, and the readers then find it by
    // index.
    await expect(
      mediaRepository.recordPendingAuditHolds(100),
    ).resolves.toBeGreaterThanOrEqual(1);
    await expect(mediaRepository.recordPendingAuditHolds(100)).resolves.toBe(0);
    await expect(
      persistenceApp.prisma.organizationAuditLog.findUniqueOrThrow({
        where: { id: entry.id },
      }),
    ).resolves.toMatchObject({ blobHoldsRecorded: true });
    await expect(
      persistenceApp.prisma.organizationAuditBlobReference.findMany({
        where: { auditLogId: entry.id },
        select: { blobName: true },
      }),
    ).resolves.toEqual([{ blobName: held }]);
    await expect(
      mediaRepository.listAuditHeldBlobNames([held]),
    ).resolves.toEqual(new Set([held]));
  });
});
