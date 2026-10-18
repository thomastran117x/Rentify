import type { Uuid } from "@/configuration/validation/uuid";

/**
 * Every kind of event the auth audit log records. The catalogue, with the
 * outcome and reason each one carries, is documented in docs/auth-security.md.
 */
export type AuthAuditEventType =
  | "login.succeeded"
  | "login.failed"
  | "login.mfa_challenged"
  | "login.locked"
  | "login.unlock_requested"
  | "login.unlocked"
  | "logout"
  | "oauth.login.succeeded"
  | "oauth.login.failed"
  | "oauth.signup.completed"
  | "oauth.linked"
  | "oauth.unlinked"
  | "session.refresh_reuse_detected"
  | "session.revoked"
  | "device.new_detected"
  | "password.changed"
  | "password.reset"
  | "password.set"
  | "email.changed"
  | "mfa.totp_enabled"
  | "mfa.totp_disabled"
  | "mfa.step_up_failed"
  | "mfa.step_up_locked"
  | "pat.created"
  | "pat.revoked"
  | "rate_limit.exceeded";

export type AuthAuditOutcome = "success" | "failure" | "blocked";

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

export type AuthAuditMethod =
  | "password"
  | "google"
  | "microsoft"
  | "apple"
  | "refresh"
  | "pat";

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
