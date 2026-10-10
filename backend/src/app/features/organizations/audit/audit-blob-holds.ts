import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { newUuid } from "@/configuration/validation/uuid";
import { listAuditSnapshotBlobNames } from "@/features/organizations/audit/audit.model";

/**
 * The image names restorable audit entries hold live in
 * `organization_audit_blob_references`, written with each entry by
 * AuditRepository.create, which also sets `blob_holds_recorded`. An entry
 * written any other way, such as by an instance still running the release
 * before that table existed, is left unmarked. Readers add the names such
 * entries hold from their snapshots, and the media cleanup records them, so a
 * hold is never missed while it is being recorded. Unmarked entries are
 * indexed, and there are normally none.
 */

type AuditClient = Pick<
  Prisma.TransactionClient,
  "organizationAuditLog" | "organizationAuditBlobReference"
>;

const HOLDING_RESOURCE_TYPES = ["organization", "posting"];

/** The rows that record what an entry holds, if anything. */
export function buildAuditBlobReferences(entry: {
  id: string;
  resourceType: string;
  restorable: boolean;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
}): Prisma.OrganizationAuditBlobReferenceCreateManyInput[] {
  if (!entry.restorable) {
    return [];
  }

  return listAuditSnapshotBlobNames(entry.resourceType, [
    entry.beforeSnapshot,
    entry.afterSnapshot,
  ]).map((blobName) => ({ id: newUuid(), auditLogId: entry.id, blobName }));
}

/**
 * The names held by restorable entries whose holds are not recorded yet,
 * optionally only an organization's, or one resource type's.
 */
export async function listUnrecordedAuditHolds(
  client: AuditClient,
  where: { organizationId?: string; resourceType?: string } = {},
): Promise<string[]> {
  const entries = await client.organizationAuditLog.findMany({
    where: {
      blobHoldsRecorded: false,
      restorable: true,
      resourceType: where.resourceType ?? { in: HOLDING_RESOURCE_TYPES },
      ...(where.organizationId ? { organizationId: where.organizationId } : {}),
    },
    select: { resourceType: true, beforeSnapshot: true, afterSnapshot: true },
  });

  return entries.flatMap((entry) =>
    listAuditSnapshotBlobNames(entry.resourceType, [
      entry.beforeSnapshot,
      entry.afterSnapshot,
    ]),
  );
}

/**
 * Records the holds of up to `limit` unmarked entries, and returns how many it
 * marked. Each entry is marked and recorded in one transaction, and only while
 * it is still unmarked, so concurrent runs record each entry once.
 */
export async function recordPendingAuditHolds(
  prisma: Pick<PrismaClient, "organizationAuditLog" | "$transaction">,
  limit: number,
): Promise<number> {
  const entries = await prisma.organizationAuditLog.findMany({
    where: { blobHoldsRecorded: false },
    select: {
      id: true,
      resourceType: true,
      restorable: true,
      beforeSnapshot: true,
      afterSnapshot: true,
    },
    orderBy: { id: "asc" },
    take: limit,
  });
  let recorded = 0;

  for (const entry of entries) {
    const marked = await prisma.$transaction(async (transaction) => {
      const claim = await transaction.organizationAuditLog.updateMany({
        where: { id: entry.id, blobHoldsRecorded: false },
        data: { blobHoldsRecorded: true },
      });

      if (claim.count === 0) {
        return false;
      }

      const references = buildAuditBlobReferences(entry);

      if (references.length > 0) {
        await transaction.organizationAuditBlobReference.createMany({
          data: references,
        });
      }

      return true;
    });

    if (marked) {
      recorded += 1;
    }
  }

  return recorded;
}
