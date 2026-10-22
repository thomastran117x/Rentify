import { isApiClientError } from "@/lib/api/types";
import {
  isValidDateInput,
  toActivityDateRange,
} from "@/lib/security-activity/format";
import {
  AUTH_AUDIT_EVENT_TYPES,
  type AuthAuditEventType,
  type AuthAuditOutcome,
  type AuthAuditUserSummary,
  type ListAdminAuthAuditInput,
} from "@/lib/admin-security/types";

export const ADMIN_AUDIT_PAGE_SIZE = 25;

const EVENT_TYPE_LABELS: Record<AuthAuditEventType, string> = {
  "login.succeeded": "Sign-in succeeded",
  "login.failed": "Sign-in failed",
  "login.mfa_challenged": "Sign-in asked for a code",
  "login.locked": "Account locked",
  "login.unlock_requested": "Unlock requested",
  "login.unlocked": "Account unlocked",
  logout: "Signed out",
  "oauth.login.succeeded": "Provider sign-in succeeded",
  "oauth.login.failed": "Provider sign-in failed",
  "oauth.signup.completed": "Provider sign-up",
  "oauth.linked": "Provider linked",
  "oauth.unlinked": "Provider unlinked",
  "session.refresh_reuse_detected": "Refresh token reused",
  "session.revoked": "Session revoked",
  "device.new_detected": "New device",
  "password.changed": "Password changed",
  "password.reset": "Password reset",
  "password.set": "Password added",
  "email.changed": "Email changed",
  "mfa.totp_enabled": "Authenticator turned on",
  "mfa.totp_disabled": "Authenticator turned off",
  "mfa.step_up_failed": "Identity check failed",
  "mfa.step_up_locked": "Identity check blocked",
  "pat.created": "Access token created",
  "pat.revoked": "Access token revoked",
  "rate_limit.exceeded": "Rate limit hit",
  "admin.audit_viewed": "Audit log viewed",
  "account.locked": "Security hold placed",
  "account.suspended": "Account suspended",
  "account.reinstated": "Account reinstated",
};

function isKnownEventType(value: string): value is AuthAuditEventType {
  return (AUTH_AUDIT_EVENT_TYPES as readonly string[]).includes(value);
}

/** A readable name for an event type; unknown types show as stored. */
export function eventTypeLabel(eventType: string): string {
  return isKnownEventType(eventType) ? EVENT_TYPE_LABELS[eventType] : eventType;
}

export const EVENT_TYPE_GROUPS: Array<{
  label: string;
  types: AuthAuditEventType[];
}> = [
  {
    label: "Sign-in",
    types: [
      "login.succeeded",
      "login.failed",
      "login.mfa_challenged",
      "login.locked",
      "login.unlock_requested",
      "login.unlocked",
      "oauth.login.succeeded",
      "oauth.login.failed",
      "oauth.signup.completed",
      "rate_limit.exceeded",
    ],
  },
  {
    label: "Security changes",
    types: [
      "password.changed",
      "password.reset",
      "password.set",
      "email.changed",
      "mfa.totp_enabled",
      "mfa.totp_disabled",
      "mfa.step_up_failed",
      "mfa.step_up_locked",
      "oauth.linked",
      "oauth.unlinked",
      "pat.created",
      "pat.revoked",
      "account.locked",
      "account.suspended",
      "account.reinstated",
    ],
  },
  {
    label: "Sessions",
    types: [
      "logout",
      "session.revoked",
      "session.refresh_reuse_detected",
      "device.new_detected",
    ],
  },
  { label: "Admin", types: ["admin.audit_viewed"] },
];

export const OUTCOME_APPEARANCE: Record<
  AuthAuditOutcome,
  { label: string; className: string }
> = {
  success: {
    label: "Succeeded",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  failure: {
    label: "Failed",
    className:
      "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  },
  blocked: {
    label: "Blocked",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  },
};

export function describeUser(user: AuthAuditUserSummary): string {
  return user.username ?? user.email;
}

/** The filter bar's values, as kept in the page URL. */
export interface AdminSecurityFilters {
  user: string;
  ip: string;
  eventTypes: AuthAuditEventType[];
  outcome: AuthAuditOutcome | "";
  /** Local calendar days in `YYYY-MM-DD` form; empty leaves that side open. */
  fromDate: string;
  toDate: string;
}

export const EMPTY_FILTERS: AdminSecurityFilters = {
  user: "",
  ip: "",
  eventTypes: [],
  outcome: "",
  fromDate: "",
  toDate: "",
};

const OUTCOMES: readonly string[] = ["success", "failure", "blocked"];

/** Reads the filters back from the URL, dropping anything unrecognised. */
export function readFiltersFromSearchParams(
  params: Pick<URLSearchParams, "get" | "getAll">,
): AdminSecurityFilters {
  const outcome = params.get("outcome") ?? "";
  const fromDate = params.get("from") ?? "";
  const toDate = params.get("to") ?? "";

  return {
    user: params.get("user")?.trim() ?? "",
    ip: params.get("ip")?.trim() ?? "",
    eventTypes: [...new Set(params.getAll("eventType"))].filter(
      isKnownEventType,
    ),
    outcome: OUTCOMES.includes(outcome) ? (outcome as AuthAuditOutcome) : "",
    fromDate: isValidDateInput(fromDate) ? fromDate : "",
    toDate: isValidDateInput(toDate) ? toDate : "",
  };
}

export function filtersToSearchParams(
  filters: AdminSecurityFilters,
): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.user.trim()) params.set("user", filters.user.trim());
  if (filters.ip.trim()) params.set("ip", filters.ip.trim());
  for (const eventType of filters.eventTypes) {
    params.append("eventType", eventType);
  }
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.fromDate) params.set("from", filters.fromDate);
  if (filters.toDate) params.set("to", filters.toDate);

  return params;
}

/** True when To is a day before From, which the bar reports inline. */
export function hasInvertedDateRange(
  filters: Pick<AdminSecurityFilters, "fromDate" | "toDate">,
): boolean {
  return Boolean(
    filters.fromDate && filters.toDate && filters.toDate < filters.fromDate,
  );
}

/**
 * The API request for the filters. Dates are whole local days, both
 * included, so To becomes the start of the next day. With no dates the
 * backend searches its default seven days.
 */
export function toListInput(
  filters: AdminSecurityFilters,
  cursor?: string,
): ListAdminAuthAuditInput {
  const range = toActivityDateRange(filters.fromDate, filters.toDate);

  return {
    user: filters.user.trim() || undefined,
    ip: filters.ip.trim() || undefined,
    eventType: filters.eventTypes.length > 0 ? filters.eventTypes : undefined,
    outcome: filters.outcome || undefined,
    from: range.from,
    to: range.to,
    cursor,
    limit: ADMIN_AUDIT_PAGE_SIZE,
  };
}

export function isForbiddenError(error: unknown): boolean {
  return isApiClientError(error) && error.status === 403;
}

export function isNotFoundError(error: unknown): boolean {
  return isApiClientError(error) && error.status === 404;
}

/**
 * The first field message of a 400, such as "ip must be an IPv4 or IPv6
 * address.", or null for any other error. The API sends field errors as
 * `{ [field]: string[] }`.
 */
export function validationMessage(error: unknown): string | null {
  if (!isApiClientError(error) || error.status !== 400) {
    return null;
  }

  const details = error.details;

  if (details && typeof details === "object" && !Array.isArray(details)) {
    for (const messages of Object.values(details as Record<string, unknown>)) {
      const first = Array.isArray(messages) ? messages[0] : undefined;

      if (typeof first === "string") {
        return first.replaceAll("`", "");
      }
    }
  }

  return error.message;
}
