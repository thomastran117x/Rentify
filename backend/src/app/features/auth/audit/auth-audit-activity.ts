import { RequestValidationError } from "@/configuration/validation/request";
import { isUuid } from "@/configuration/validation/uuid";
import {
  AUTH_AUDIT_OUTCOMES,
  type AuthAuditActivityRow,
  type AuthAuditMethod,
  type AuthAuditOutcome,
  type SecurityActivityItem,
} from "@/features/auth/audit/auth-audit.model";

const CURSOR_PREFIX = "v1:";

/** The width of `auth_audit_events.device_id`; stored ids are cut to it. */
export const AUDIT_DEVICE_ID_LENGTH = 64;

/**
 * The opaque "next page" token is the id of the last event returned. The
 * repository hands it to Prisma's cursor pagination, which compares against
 * that row's stored timestamp in SQL and so keeps its microseconds; a cursor
 * built from a JavaScript Date would lose them and skip events written in the
 * same millisecond.
 */
export function encodeActivityCursor(id: string): string {
  return Buffer.from(`${CURSOR_PREFIX}${id}`, "utf8").toString("base64url");
}

export function decodeActivityCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const id = decoded.startsWith(CURSOR_PREFIX)
    ? decoded.slice(CURSOR_PREFIX.length)
    : "";

  if (!isUuid(id)) {
    throw invalidCursorError();
  }

  return id;
}

/**
 * The cursor is malformed, or names an event that is not the caller's under
 * the current filters: another user's, one the filters exclude, or one
 * since pruned.
 */
export function invalidCursorError(): RequestValidationError {
  return new RequestValidationError("Request query validation failed.", [
    { path: "cursor", message: "Invalid cursor." },
  ]);
}

const METHODS: readonly AuthAuditMethod[] = [
  "password",
  "google",
  "microsoft",
  "apple",
  "refresh",
  "pat",
];
const PROVIDER_NAMES: Partial<Record<AuthAuditMethod, string>> = {
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
};

function toOutcome(value: string): AuthAuditOutcome {
  return (AUTH_AUDIT_OUTCOMES as readonly string[]).includes(value)
    ? (value as AuthAuditOutcome)
    : "failure";
}

function toMethod(value: string | null): AuthAuditMethod | null {
  return value && (METHODS as readonly string[]).includes(value)
    ? (value as AuthAuditMethod)
    : null;
}

function providerName(method: string | null): string {
  return (method && PROVIDER_NAMES[method as AuthAuditMethod]) ?? "a provider";
}

const FAILED_SIGN_IN_LABELS: Record<string, string> = {
  bad_credentials: "Failed sign-in: wrong password",
  email_unverified: "Failed sign-in: email not verified",
  mfa_invalid: "Failed sign-in: wrong verification code",
  locked: "Sign-in blocked: account locked",
  rate_limited: "Sign-in blocked: too many attempts",
};

/**
 * Wording for an event someone else performed on the account. The acting
 * administrator is never named.
 */
const ADMIN_LABELS: Record<string, string> = {
  "login.locked": "An administrator locked your account",
  "login.unlocked": "An administrator unlocked your account",
  logout: "An administrator signed you out",
  "session.revoked": "An administrator signed you out",
  "password.reset": "An administrator reset your password",
  "email.changed": "An administrator changed your email address",
  "mfa.totp_disabled": "An administrator turned off your authenticator app",
  "pat.revoked": "An administrator revoked a personal access token",
};

const STATIC_LABELS: Record<string, string> = {
  "login.mfa_challenged": "Sign-in asked for a verification code",
  "login.locked": "Account locked after failed sign-ins",
  "login.unlock_requested": "Account unlock requested",
  "login.unlocked": "Account unlocked",
  logout: "Signed out",
  "session.refresh_reuse_detected": "Session ended: sign-in token reused",
  "session.revoked": "Session signed out remotely",
  "device.new_detected": "New device detected",
  "password.changed": "Password changed",
  "password.reset": "Password reset",
  "password.set": "Password added",
  "email.changed": "Email address changed",
  "mfa.totp_enabled": "Authenticator app turned on",
  "mfa.totp_disabled": "Authenticator app turned off",
  "mfa.step_up_failed": "Failed identity check",
  "mfa.step_up_locked": "Identity check blocked: too many attempts",
  "pat.created": "Personal access token created",
  "pat.revoked": "Personal access token revoked",
  "rate_limit.exceeded": "Too many attempts: temporarily blocked",
};

/**
 * True when someone other than the account holder performed the event, such
 * as an administrator. Such events never reveal who acted or from where.
 */
export function isActedByAnother(
  row: Pick<AuthAuditActivityRow, "userId" | "actorUserId">,
): boolean {
  return row.actorUserId !== null && row.actorUserId !== row.userId;
}

/** Server-side wording keyed by event type, refined by outcome and reason. */
export function labelForAuthAuditEvent(
  row: Pick<
    AuthAuditActivityRow,
    "eventType" | "reasonCode" | "method" | "userId" | "actorUserId"
  >,
): string {
  if (isActedByAnother(row)) {
    return (
      ADMIN_LABELS[row.eventType] ??
      "An administrator changed your account security"
    );
  }

  switch (row.eventType) {
    case "login.succeeded":
      return row.method === "password" || !row.method
        ? "Signed in with password"
        : `Signed in with ${providerName(row.method)}`;
    case "login.failed":
      return (
        (row.reasonCode && FAILED_SIGN_IN_LABELS[row.reasonCode]) ??
        "Failed sign-in"
      );
    case "oauth.login.succeeded":
      return `Signed in with ${providerName(row.method)}`;
    case "oauth.login.failed":
      return `Failed sign-in with ${providerName(row.method)}`;
    case "oauth.signup.completed":
      return `Account created with ${providerName(row.method)}`;
    case "oauth.linked":
      return `${providerName(row.method)} sign-in linked`;
    case "oauth.unlinked":
      return `${providerName(row.method)} sign-in removed`;
    default:
      return STATIC_LABELS[row.eventType] ?? "Account activity";
  }
}

const BROWSER_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // Order matters: Edge, Opera and Samsung all also claim to be Chrome, and
  // Chrome also claims to be Safari.
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\/|\bChromium\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const OS_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // iPadOS and iOS mention "like Mac OS X"; Android and ChromeOS mention Linux.
  [/\bWindows\b/, "Windows"],
  [/\b(?:iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

function matchFirst(
  value: string,
  patterns: ReadonlyArray<[RegExp, string]>,
): string | null {
  for (const [pattern, name] of patterns) {
    if (pattern.test(value)) {
      return name;
    }
  }

  return null;
}

/**
 * Coarse browser and OS names from a user agent. Anything unrecognised is
 * null, which the account page shows as "Unknown device".
 */
export function parseUserAgent(userAgent: string | null | undefined): {
  browser: string | null;
  os: string | null;
} {
  if (!userAgent) {
    return { browser: null, os: null };
  }

  return {
    browser: matchFirst(userAgent, BROWSER_PATTERNS),
    os: matchFirst(userAgent, OS_PATTERNS),
  };
}

export interface SecurityActivityProjectionContext {
  currentSessionId?: string;
  /** The caller's known device ids, cut to the audit column width. */
  knownDeviceIds: ReadonlySet<string>;
}

/**
 * Builds the user-safe view of one event field by field. Never spread the row:
 * the identifier hash, actor id, reason, request id, session and device ids,
 * raw user agent and metadata must not reach the caller.
 *
 * When an administrator acted, the IP, user agent, method and device on the
 * row are the administrator's own, so the item carries none of them.
 */
export function toSecurityActivityItem(
  row: AuthAuditActivityRow,
  context: SecurityActivityProjectionContext,
): SecurityActivityItem {
  if (isActedByAnother(row)) {
    return {
      id: row.id,
      type: row.eventType,
      outcome: toOutcome(row.outcome),
      label: labelForAuthAuditEvent(row),
      occurredAt: row.createdAt.toISOString(),
      method: null,
      ipAddress: null,
      browser: null,
      os: null,
      deviceKnown: false,
      current: false,
    };
  }

  const { browser, os } = parseUserAgent(row.userAgent);

  return {
    id: row.id,
    type: row.eventType,
    outcome: toOutcome(row.outcome),
    label: labelForAuthAuditEvent(row),
    occurredAt: row.createdAt.toISOString(),
    method: toMethod(row.method),
    ipAddress: row.ipAddress,
    browser,
    os,
    deviceKnown:
      row.deviceId !== null && context.knownDeviceIds.has(row.deviceId),
    current:
      Boolean(context.currentSessionId) &&
      row.sessionId === context.currentSessionId,
  };
}
