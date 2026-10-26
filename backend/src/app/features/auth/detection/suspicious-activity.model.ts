import type { AppEnvironment } from "@/configuration/environment/types";

export type SuspiciousActivityDetectionConfig =
  AppEnvironment["authSecurity"]["detection"];

/** The rules, as recorded in a `security.suspicious_activity` event. */
export type SuspiciousActivityRule =
  | "repeated_lockouts"
  | "credential_stuffing"
  | "success_after_failures"
  | "refresh_reuse";

/**
 * What a firing did, recorded as `metadata.action`. `none` is a rule that
 * acts only in enforce mode firing in alert mode, `skipped` is an enforce
 * action with nothing to do (the account was already held or suspended, or
 * has no email to alert), and `failed` is an action that threw.
 */
export type SuspiciousActivityAction =
  | "none"
  | "account_locked"
  | "ip_blocked"
  | "email_sent"
  | "skipped"
  | "failed";

/** The most event ids one firing looks up, flags and names. */
export const SUSPICIOUS_ACTIVITY_MAX_RELATED_EVENTS = 50;

/**
 * The most ids `metadata.relatedEventIds` lists. Metadata values are scalars,
 * so the ids are comma-joined; `relatedEventCount` gives the full count.
 */
export const SUSPICIOUS_ACTIVITY_MAX_LISTED_EVENT_IDS = 20;

/** The reason an automatic hold records; never shown to the user. */
export const REPEATED_LOCKOUTS_LOCK_REASON = "Repeated sign-in lockouts";
