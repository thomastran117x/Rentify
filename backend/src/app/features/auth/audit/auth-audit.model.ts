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
  | "logout";

export type AuthAuditOutcome = "success" | "failure" | "blocked";

export type AuthAuditReasonCode =
  | "bad_credentials"
  | "email_unverified"
  | "mfa_required"
  | "mfa_invalid"
  | "locked"
  | "rate_limited"
  | "not_locked"
  | "otp_invalid";

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
