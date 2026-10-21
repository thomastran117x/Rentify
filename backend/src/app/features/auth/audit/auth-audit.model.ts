import { z } from "zod";
import type { Uuid } from "@/configuration/validation/uuid";

/**
 * Every kind of event the auth audit log records. The catalogue, with the
 * outcome and reason each one carries, is documented in docs/auth-security.md.
 */
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
] as const;

export type AuthAuditEventType = (typeof AUTH_AUDIT_EVENT_TYPES)[number];

export const AUTH_AUDIT_OUTCOMES = ["success", "failure", "blocked"] as const;

export type AuthAuditOutcome = (typeof AUTH_AUDIT_OUTCOMES)[number];

export type AuthAuditReasonCode =
  | "bad_credentials"
  | "email_unverified"
  | "mfa_required"
  | "mfa_invalid"
  | "locked"
  | "rate_limited"
  | "not_locked"
  | "otp_invalid"
  | "token_invalid"
  | "email_conflict"
  | "signup_expired";

export const AUTH_AUDIT_METHODS = [
  "password",
  "google",
  "microsoft",
  "apple",
  "refresh",
  "pat",
] as const;

export type AuthAuditMethod = (typeof AUTH_AUDIT_METHODS)[number];

/**
 * Where an auth request came from, as the request middleware already resolved
 * it. Built once per request by `toAuthAuditContext` so every flow records the
 * same fields the same way.
 */
export interface AuthAuditContext {
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  requestId?: string;
}

export interface RecordAuthAuditEventInput {
  eventType: AuthAuditEventType;
  outcome: AuthAuditOutcome;
  /** The account the event is about. Null when the identifier matched none. */
  userId?: Uuid | null;
  /** Set only when someone other than the subject acted, such as an admin. */
  actorUserId?: Uuid | null;
  reasonCode?: AuthAuditReasonCode;
  method?: AuthAuditMethod;
  /** From `AuthAuditService.hashIdentifier`; never the raw typed value. */
  identifierHash?: string;
  sessionId?: string;
  context?: AuthAuditContext;
  /** Small, non-secret extras only. */
  metadata?: Record<string, string | number | boolean>;
}

/**
 * The groups the account page filters security activity by. Each event type
 * belongs to at most one; a type left out of every group is shown only when
 * no category is selected.
 */
export const SECURITY_ACTIVITY_CATEGORIES = [
  "sign_in",
  "security_changes",
  "sessions",
] as const;

export type SecurityActivityCategory =
  (typeof SECURITY_ACTIVITY_CATEGORIES)[number];

export const SECURITY_ACTIVITY_CATEGORY_EVENT_TYPES: Record<
  SecurityActivityCategory,
  readonly AuthAuditEventType[]
> = {
  sign_in: [
    "login.succeeded",
    "login.failed",
    "login.mfa_challenged",
    "login.locked",
    "login.unlock_requested",
    "login.unlocked",
    "oauth.login.succeeded",
    "oauth.login.failed",
    "oauth.signup.completed",
    "mfa.step_up_failed",
    "mfa.step_up_locked",
    "rate_limit.exceeded",
  ],
  security_changes: [
    "password.changed",
    "password.reset",
    "password.set",
    "email.changed",
    "mfa.totp_enabled",
    "mfa.totp_disabled",
    "oauth.linked",
    "oauth.unlinked",
    "pat.created",
    "pat.revoked",
  ],
  sessions: [
    "logout",
    "session.revoked",
    "session.refresh_reuse_detected",
    "device.new_detected",
  ],
};

export const SECURITY_ACTIVITY_MAX_LIMIT = 50;
export const SECURITY_ACTIVITY_DEFAULT_LIMIT = 20;

export const listSecurityActivityQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SECURITY_ACTIVITY_MAX_LIMIT)
      .default(SECURITY_ACTIVITY_DEFAULT_LIMIT),
    category: z.enum(SECURITY_ACTIVITY_CATEGORIES).optional(),
    outcome: z.enum(AUTH_AUDIT_OUTCOMES).optional(),
    /** Inclusive lower bound on when the event happened. */
    from: z.iso.datetime({ offset: true }).optional(),
    /** Exclusive upper bound on when the event happened. */
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (query) =>
      !query.from || !query.to || Date.parse(query.from) < Date.parse(query.to),
    { path: ["to"], message: "`to` must be later than `from`." },
  );

export type ListSecurityActivityQuery = z.infer<
  typeof listSecurityActivityQuerySchema
>;

export interface ListSecurityActivityInput extends ListSecurityActivityQuery {
  /** Always the authenticated caller; never taken from the request. */
  userId: Uuid;
  /** The caller's current session, used to flag that session's events. */
  sessionId?: string;
}

/**
 * The user-safe projection of one audit event. It deliberately omits the
 * identifier hash, actor id, reason code, request id, session and device ids,
 * the raw user agent and metadata.
 */
export interface SecurityActivityItem {
  id: string;
  type: string;
  outcome: AuthAuditOutcome;
  label: string;
  occurredAt: string;
  method: AuthAuditMethod | null;
  ipAddress: string | null;
  browser: string | null;
  os: string | null;
  /**
   * Whether the event's device is one of the user's currently registered
   * devices; null when the event recorded no device. This is today's device
   * list, not whether the device was new when the event happened: that is
   * the separate `device.new_detected` event.
   */
  deviceKnown: boolean | null;
  current: boolean;
}

export interface SecurityActivityList {
  items: SecurityActivityItem[];
  nextCursor: string | null;
}

/** The persisted columns the activity projection reads. */
export interface AuthAuditActivityRow {
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
  createdAt: Date;
}
