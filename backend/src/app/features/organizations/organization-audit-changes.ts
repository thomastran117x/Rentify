import {
  createAuditChanges,
  toAuditSnapshotRecord,
  type OrganizationAuditChange,
} from "@/features/organizations/audit/audit.model";

/**
 * Builds an audit changeset. With no `fields`, diffs every key present on
 * either snapshot (`createAuditChanges`). With `fields`, diffs only those
 * keys — used where a snapshot carries data outside the editable fields
 * being audited (e.g. a role change alongside membership metadata).
 */
export function createChanges(
  beforeSnapshot: unknown,
  afterSnapshot: unknown,
  fields?: string[],
): OrganizationAuditChange[] {
  if (!fields) {
    return createAuditChanges(beforeSnapshot, afterSnapshot);
  }

  const beforeRecord = toAuditSnapshotRecord(beforeSnapshot);
  const afterRecord = toAuditSnapshotRecord(afterSnapshot);

  return fields
    .filter(
      (key) =>
        JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key]),
    )
    .map((key) => ({
      field: key,
      before: beforeRecord[key] ?? null,
      after: afterRecord[key] ?? null,
    }));
}
