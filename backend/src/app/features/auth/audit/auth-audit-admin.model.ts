import { isIP } from "node:net";
import { z } from "zod";
import { uuidSchema, type Uuid } from "@/configuration/validation/uuid";
import type { AccountStatus, AppRole } from "@/features/auth/auth.model";
import type { UserIdentitySummary } from "@/features/auth/users/users.repository";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_AUDIT_OUTCOMES,
  type AuthAuditContext,
  type AuthAuditEventType,
  type AuthAuditMethod,
  type AuthAuditOutcome,
} from "@/features/auth/audit/auth-audit.model";

export const ADMIN_AUTH_AUDIT_MAX_LIMIT = 100;
export const ADMIN_AUTH_AUDIT_DEFAULT_LIMIT = 25;
export const ADMIN_AUTH_AUDIT_MAX_EVENT_TYPES = 10;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** The window searched when the request names no `from`. */
export const ADMIN_AUTH_AUDIT_DEFAULT_RANGE_MS = 7 * DAY_IN_MS;

/**
 * The widest window one search may cover. Every filter is served by an index
 * led by its column and ending in created_at, so the bound keeps a filter
 * that matches many rows, such as a busy event type, a short range scan.
 */
export const ADMIN_AUTH_AUDIT_MAX_RANGE_MS = 90 * DAY_IN_MS;

/** How many of a user's newest events the security summary includes. */
export const ADMIN_USER_SECURITY_RECENT_EVENTS = 20;

/** The event types the summary counts as failed sign-ins. */
export const FAILED_SIGN_IN_EVENT_TYPES: readonly AuthAuditEventType[] = [
  "login.failed",
  "oauth.login.failed",
];

export const adminAuthAuditQuerySchema = z
  .object({
    userId: uuidSchema.optional(),
    /** An email or a username, resolved to an account server side. */
    user: z.string().trim().min(1).max(255).optional(),
    ip: z
      .string()
      .trim()
      .max(45)
      .refine((value) => isIP(value) !== 0, {
        message: "`ip` must be an IPv4 or IPv6 address.",
      })
      .optional(),
    eventType: z
      .array(z.enum(AUTH_AUDIT_EVENT_TYPES))
      .min(1)
      .max(ADMIN_AUTH_AUDIT_MAX_EVENT_TYPES)
      .optional(),
    outcome: z.enum(AUTH_AUDIT_OUTCOMES).optional(),
    /** `true` keeps only events suspicious-activity detection flagged. */
    flagged: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    /** Inclusive lower bound; defaults to seven days before `to`. */
    from: z.iso.datetime({ offset: true }).optional(),
    /** Exclusive upper bound; defaults to now. */
    to: z.iso.datetime({ offset: true }).optional(),
    cursor: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ADMIN_AUTH_AUDIT_MAX_LIMIT)
      .default(ADMIN_AUTH_AUDIT_DEFAULT_LIMIT),
  })
  .strict()
  .refine((query) => !(query.userId && query.user), {
    path: ["user"],
    message: "Send `userId` or `user`, not both.",
  });

export type AdminAuthAuditQuery = z.infer<typeof adminAuthAuditQuerySchema>;

/** Who is reading, recorded on the `admin.audit_viewed` event. */
export interface AdminAuditReader {
  userId: Uuid;
  context: AuthAuditContext;
}

/**
 * How a `user` or `userId` filter was resolved. An identifier that matches no
 * account is still searchable through the keyed hash sign-in records, which
 * is how attempts against an unknown username are found.
 */
export type AdminAuditSubjectFilter =
  | { kind: "none" }
  | { kind: "user"; userId: Uuid }
  | { kind: "identifier"; identifierHash: string };

export type AuthAuditUserSummary = UserIdentitySummary;

/**
 * One event as an administrator sees it: every stored column except the
 * identifier hash, plus who the event was about and who performed it.
 */
export interface AdminAuthAuditEvent {
  id: string;
  eventType: string;
  outcome: AuthAuditOutcome;
  reasonCode: string | null;
  method: AuthAuditMethod | null;
  ipAddress: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  deviceId: string | null;
  sessionId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  /** Whether suspicious-activity detection flagged the event. */
  flagged: boolean;
  occurredAt: string;
  /** Null when the event matched no account, such as an unknown username. */
  subject: AuthAuditUserSummary | null;
  /** Set only when someone other than the subject acted. */
  actor: AuthAuditUserSummary | null;
}

export interface AdminAuthAuditRange {
  from: string;
  to: string;
}

export interface AdminAuthAuditEventList {
  items: AdminAuthAuditEvent[];
  nextCursor: string | null;
  /** The window actually searched, after defaults were applied. */
  range: AdminAuthAuditRange;
}

export interface AdminUserLockoutState {
  locked: boolean;
  failedAttempts: number;
  lockedAt: string | null;
  lockedUntil: string | null;
}

export interface AdminUserKnownDevice {
  id: string;
  deviceId: string;
  type: string;
  platform: string | null;
  browser: string | null;
  os: string | null;
  lastIpAddress: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AdminAccountStatusChange {
  reason: string | null;
  changedAt: string;
  /** The admin who made it; null for the system, the user or a deleted admin. */
  changedBy: { id: string; email: string; username: string | null } | null;
}

export interface AdminUserSecuritySummary {
  user: {
    id: string;
    email: string;
    username: string | null;
    role: AppRole;
  };
  accountStatus: AccountStatus;
  /** The latest status change, or null when the status was never changed. */
  accountStatusChange: AdminAccountStatusChange | null;
  lastLoginAt: string | null;
  failedSignIns: {
    last24Hours: number;
    last7Days: number;
  };
  lockout: AdminUserLockoutState;
  devices: AdminUserKnownDevice[];
  recentEvents: AdminAuthAuditEvent[];
}

/** The persisted columns the admin projection reads. */
export interface AuthAuditAdminRow {
  id: string;
  userId: string | null;
  actorUserId: string | null;
  eventType: string;
  outcome: string;
  reasonCode: string | null;
  method: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  deviceId: string | null;
  sessionId: string | null;
  requestId: string | null;
  metadata: unknown;
  flagged: boolean;
  createdAt: Date;
}
