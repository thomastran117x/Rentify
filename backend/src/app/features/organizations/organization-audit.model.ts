import { z } from "zod";
import { organizationResourceIdSchema } from "@/features/organizations/organizations.model";

export const organizationAuditActionSchema = z.enum([
  "organization.created",
  "organization.renamed",
  "organization.restored",
  "invitation.created",
  "invitation.reissued",
  "invitation.revoked",
  "invitation.accepted",
  "invitation.expired",
  "invitation.restored",
  "member.role_updated",
  "member.removed",
  "member.restored",
  "posting.created",
  "posting.updated",
  "posting.duplicated",
  "posting.published",
  "posting.paused",
  "posting.unpaused",
  "posting.archived",
  "posting.restored",
  "posting_availability.created",
  "posting_availability.updated",
  "posting_availability.deleted",
  "posting_availability.restored",
  "seasonal_pricing.created",
  "seasonal_pricing.updated",
  "seasonal_pricing.deleted",
  "seasonal_pricing.restored",
]);
export type OrganizationAuditAction = z.infer<
  typeof organizationAuditActionSchema
>;

export const organizationAuditResourceTypeSchema = z.enum([
  "organization",
  "invitation",
  "member",
  "posting",
  "posting_availability",
  "seasonal_pricing",
]);
export type OrganizationAuditResourceType = z.infer<
  typeof organizationAuditResourceTypeSchema
>;

export const listOrganizationAuditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    action: organizationAuditActionSchema.optional(),
    resourceType: organizationAuditResourceTypeSchema.optional(),
  })
  .strict();

export const organizationAuditIdSchema = organizationResourceIdSchema;

export type ListOrganizationAuditQuery = z.infer<
  typeof listOrganizationAuditQuerySchema
>;

export interface OrganizationAuditActorSummary {
  id: string;
  email: string;
  username: string;
  avatarUrl?: string;
}

export interface OrganizationAuditChange {
  field: string;
  before: unknown;
  after: unknown;
}

export function toAuditSnapshotRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function createAuditChanges(
  beforeSnapshot: unknown,
  afterSnapshot: unknown,
): OrganizationAuditChange[] {
  const beforeRecord = toAuditSnapshotRecord(beforeSnapshot);
  const afterRecord = toAuditSnapshotRecord(afterSnapshot);
  const keys = Array.from(
    new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]),
  );

  return keys
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

export interface OrganizationAuditRecord {
  id: string;
  organizationId: string;
  actor?: OrganizationAuditActorSummary;
  action: OrganizationAuditAction;
  resourceType: OrganizationAuditResourceType;
  resourceId?: string;
  organizationVersion: number;
  resourceVersion?: number;
  summary: string;
  changes: OrganizationAuditChange[];
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  restorable: boolean;
  restoredFromAuditId?: string;
  createdAt: string;
}

export interface OrganizationAuditPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListOrganizationAuditInput extends ListOrganizationAuditQuery {
  organizationId: string;
  actorUserId: string;
}

export interface ListOrganizationAuditResult {
  auditLogs: OrganizationAuditRecord[];
  pagination: OrganizationAuditPagination;
}

export interface RestoreOrganizationVersionInput {
  organizationId: string;
  actorUserId: string;
  auditId: string;
}

export interface RestoreOrganizationVersionResult {
  restored: true;
  auditLog: OrganizationAuditRecord;
}

export interface CreateOrganizationAuditLogInput {
  organizationId: string;
  actorUserId?: string | null;
  action: OrganizationAuditAction;
  resourceType: OrganizationAuditResourceType;
  resourceId?: string | null;
  summary: string;
  changes?: OrganizationAuditChange[];
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  restorable?: boolean;
  restoredFromAuditId?: string | null;
}
