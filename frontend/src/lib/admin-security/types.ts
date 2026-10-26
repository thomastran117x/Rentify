import type { AppUserRole } from "@/lib/auth/roles";
import type {
  SecurityActivityMethod,
  SecurityActivityOutcome,
} from "@/lib/security-activity/types";

/** The auth audit event types the backend records; new ones may appear. */
export const AUTH_AUDIT_EVENT_TYPES = [
  "login.succeeded",
  "login.failed",
  "login.mfa_challenged",
  "login.locked",
  "login.unlock_requested",
  "login.unlocked",
  "logout",
  "oauth.login.succeeded",
  "oauth.login.failed",
  "oauth.signup.completed",
  "oauth.linked",
  "oauth.unlinked",
  "session.refresh_reuse_detected",
  "session.revoked",
  "device.new_detected",
  "password.changed",
  "password.reset",
  "password.set",
  "email.changed",
  "mfa.totp_enabled",
  "mfa.totp_disabled",
  "mfa.step_up_failed",
  "mfa.step_up_locked",
  "pat.created",
  "pat.revoked",
  "rate_limit.exceeded",
  "admin.audit_viewed",
  "account.locked",
  "account.suspended",
  "account.reinstated",
] as const;

export type AuthAuditEventType = (typeof AUTH_AUDIT_EVENT_TYPES)[number];

export type AuthAuditOutcome = SecurityActivityOutcome;

export interface AuthAuditUserSummary {
  id: string;
  email: string;
  username: string | null;
}

/** One event from `GET /admin/auth/audit`. */
export interface AdminAuthAuditEvent {
  id: string;
  /** Usually one of AUTH_AUDIT_EVENT_TYPES; the backend may add more. */
  eventType: string;
  outcome: AuthAuditOutcome;
  reasonCode: string | null;
  method: SecurityActivityMethod | null;
  ipAddress: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  deviceId: string | null;
  sessionId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  /** Set by suspicious-activity detection on the events it acted on. */
  flagged: boolean;
  occurredAt: string;
  /** Null for an unknown-username attempt or a deleted account. */
  subject: AuthAuditUserSummary | null;
  /** Set only when someone other than the subject acted. */
  actor: AuthAuditUserSummary | null;
}

export interface AdminAuthAuditEventList {
  items: AdminAuthAuditEvent[];
  nextCursor: string | null;
  /** The window the backend searched, after its defaults. */
  range: { from: string; to: string };
}

export interface ListAdminAuthAuditInput {
  user?: string;
  ip?: string;
  eventType?: AuthAuditEventType[];
  outcome?: AuthAuditOutcome;
  /** True keeps only the events detection flagged. */
  flagged?: boolean;
  /** Inclusive lower bound, an ISO 8601 date-time. */
  from?: string;
  /** Exclusive upper bound, an ISO 8601 date-time. */
  to?: string;
  cursor?: string;
  limit?: number;
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

/**
 * `locked` is a security hold the user can clear with a password reset;
 * `suspended` is a policy action only an admin can reverse.
 */
export type AccountStatus = "active" | "locked" | "suspended";

export type AccountStatusAction = "lock" | "suspend" | "reinstate";

export interface AdminAccountStatusChange {
  /** The admin's note; never shown to the user. */
  reason: string | null;
  changedAt: string;
  /** Null when the system or the user made the change. */
  changedBy: AuthAuditUserSummary | null;
}

/** The response of `POST /admin/users/:id/lock`, `/suspend` and `/reinstate`. */
export interface AdminAccountStatusChangeResult {
  userId: string;
  status: AccountStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  /** False when a reinstated account was already active. */
  changed: boolean;
}

export interface AdminUserSecuritySummary {
  user: {
    id: string;
    email: string;
    username: string | null;
    role: AppUserRole;
  };
  accountStatus: AccountStatus;
  /** The latest status change, or null when it was never changed. */
  accountStatusChange: AdminAccountStatusChange | null;
  lastLoginAt: string | null;
  failedSignIns: { last24Hours: number; last7Days: number };
  lockout: {
    locked: boolean;
    failedAttempts: number;
    lockedAt: string | null;
    lockedUntil: string | null;
  };
  devices: AdminUserKnownDevice[];
  recentEvents: AdminAuthAuditEvent[];
}
