import { RequestValidationError } from "@/configuration/validation/request";
import {
  AUTH_AUDIT_METHODS,
  AUTH_AUDIT_OUTCOMES,
  type AuthAuditMethod,
  type AuthAuditOutcome,
} from "@/features/auth/audit/auth-audit.model";
import { parseUserAgent } from "@/features/auth/audit/auth-audit-activity";
import {
  ADMIN_AUTH_AUDIT_DEFAULT_RANGE_MS,
  ADMIN_AUTH_AUDIT_MAX_RANGE_MS,
  type AdminAuditSubjectFilter,
  type AdminAuthAuditEvent,
  type AdminAuthAuditQuery,
  type AuthAuditAdminRow,
  type AuthAuditUserSummary,
} from "@/features/auth/audit/auth-audit-admin.model";
import type { ListAuthAuditEventsForAdminInput } from "@/features/auth/audit/auth-audit.repository";

export interface ResolvedAdminAuditRange {
  createdFrom: Date;
  createdBefore: Date;
}

function rangeError(message: string): RequestValidationError {
  return new RequestValidationError("Request query validation failed.", [
    { path: "from", message },
  ]);
}

/**
 * The window to search: `to` defaults to now and `from` to seven days before
 * `to`. A window that is empty, inverted or wider than the cap is a 400 rather
 * than being clamped silently, so the caller always knows what was searched.
 */
export function resolveAdminAuditRange(
  query: Pick<AdminAuthAuditQuery, "from" | "to">,
  now: Date,
): ResolvedAdminAuditRange {
  const createdBefore = query.to ? new Date(query.to) : now;
  const createdFrom = query.from
    ? new Date(query.from)
    : new Date(createdBefore.getTime() - ADMIN_AUTH_AUDIT_DEFAULT_RANGE_MS);

  if (createdFrom.getTime() >= createdBefore.getTime()) {
    throw rangeError("`from` must be earlier than `to`.");
  }

  if (
    createdBefore.getTime() - createdFrom.getTime() >
    ADMIN_AUTH_AUDIT_MAX_RANGE_MS
  ) {
    throw rangeError("The range between `from` and `to` is at most 90 days.");
  }

  return { createdFrom, createdBefore };
}

/** Maps a validated query and its resolved subject to the repository input. */
export function toAdminRepositoryFilter(
  query: AdminAuthAuditQuery,
  subject: AdminAuditSubjectFilter,
  range: ResolvedAdminAuditRange,
  afterId: string | undefined,
): ListAuthAuditEventsForAdminInput {
  return {
    ...(subject.kind === "user" ? { userId: subject.userId } : {}),
    ...(subject.kind === "identifier"
      ? { identifierHash: subject.identifierHash }
      : {}),
    ...(query.ip ? { ipAddress: query.ip } : {}),
    ...(query.eventType ? { eventTypes: query.eventType } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
    ...(query.flagged !== undefined ? { flagged: query.flagged } : {}),
    afterId,
    createdFrom: range.createdFrom,
    createdBefore: range.createdBefore,
    limit: query.limit + 1,
  };
}

/**
 * The filters an `admin.audit_viewed` event records, flattened to the scalar
 * metadata the audit table accepts. The cursor is left out: it only says how
 * far the reader paged, not what they searched for.
 */
export function toAuditViewedMetadata(
  query: AdminAuthAuditQuery,
  range: ResolvedAdminAuditRange,
): Record<string, string | number> {
  return {
    view: "events",
    ...(query.userId ? { filter_user_id: query.userId } : {}),
    ...(query.user ? { filter_user: query.user } : {}),
    ...(query.ip ? { filter_ip: query.ip } : {}),
    ...(query.eventType
      ? { filter_event_types: query.eventType.join(",") }
      : {}),
    ...(query.outcome ? { filter_outcome: query.outcome } : {}),
    ...(query.flagged !== undefined
      ? { filter_flagged: String(query.flagged) }
      : {}),
    filter_from: range.createdFrom.toISOString(),
    filter_to: range.createdBefore.toISOString(),
    limit: query.limit,
  };
}

function toOutcome(value: string): AuthAuditOutcome {
  return (AUTH_AUDIT_OUTCOMES as readonly string[]).includes(value)
    ? (value as AuthAuditOutcome)
    : "failure";
}

function toMethod(value: string | null): AuthAuditMethod | null {
  return value && (AUTH_AUDIT_METHODS as readonly string[]).includes(value)
    ? (value as AuthAuditMethod)
    : null;
}

function toMetadata(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The ids a page of events refers to, for one batched user lookup. The actor
 * is included only when it differs from the subject.
 */
export function collectReferencedUserIds(
  rows: readonly Pick<AuthAuditAdminRow, "userId" | "actorUserId">[],
): string[] {
  const ids = new Set<string>();

  for (const row of rows) {
    if (row.userId) {
      ids.add(row.userId);
    }

    if (row.actorUserId && row.actorUserId !== row.userId) {
      ids.add(row.actorUserId);
    }
  }

  return [...ids];
}

/**
 * Builds the administrator's view of one event field by field. Never spread
 * the row: the identifier hash must not leave the server, because with a
 * list of likely usernames it would confirm which ones were tried.
 *
 * A subject or actor whose account has since been deleted resolves to null,
 * the same as an attempt that never matched an account.
 */
export function toAdminAuthAuditEvent(
  row: AuthAuditAdminRow,
  usersById: ReadonlyMap<string, AuthAuditUserSummary>,
): AdminAuthAuditEvent {
  const { browser, os } = parseUserAgent(row.userAgent);
  const actedByAnother =
    row.actorUserId !== null && row.actorUserId !== row.userId;

  return {
    id: row.id,
    eventType: row.eventType,
    outcome: toOutcome(row.outcome),
    reasonCode: row.reasonCode,
    method: toMethod(row.method),
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    browser,
    os,
    deviceId: row.deviceId,
    sessionId: row.sessionId,
    requestId: row.requestId,
    metadata: toMetadata(row.metadata),
    flagged: row.flagged,
    occurredAt: row.createdAt.toISOString(),
    subject: (row.userId && usersById.get(row.userId)) || null,
    actor:
      (actedByAnother && row.actorUserId && usersById.get(row.actorUserId)) ||
      null,
  };
}
