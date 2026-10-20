export type SecurityActivityCategory =
  | "sign_in"
  | "security_changes"
  | "sessions";

export type SecurityActivityOutcome = "success" | "failure" | "blocked";

export type SecurityActivityMethod =
  | "password"
  | "google"
  | "microsoft"
  | "apple"
  | "refresh"
  | "pat";

/** One event from `GET /auth/audit/me`; the label is written by the server. */
export interface SecurityActivityItem {
  id: string;
  type: string;
  outcome: SecurityActivityOutcome;
  label: string;
  occurredAt: string;
  method: SecurityActivityMethod | null;
  ipAddress: string | null;
  browser: string | null;
  os: string | null;
  /** Matches a currently registered device; null when no device was recorded. */
  deviceKnown: boolean | null;
  current: boolean;
}

export interface SecurityActivityList {
  items: SecurityActivityItem[];
  nextCursor: string | null;
}

export interface ListSecurityActivityInput {
  cursor?: string;
  limit?: number;
  category?: SecurityActivityCategory;
  outcome?: SecurityActivityOutcome;
  /** Inclusive lower bound, an ISO 8601 date-time. */
  from?: string;
  /** Exclusive upper bound, an ISO 8601 date-time. */
  to?: string;
}
