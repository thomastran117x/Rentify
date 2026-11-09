import {
  DEFAULT_CAPTCHA_ALLOWED_HOST,
  DEFAULT_EMAIL_APP_BASE_URL,
  DEFAULT_FRONTEND_URL,
  DEFAULT_REFRESH_TOKEN_CACHE_PREFIX,
} from "@/configuration/environment/constants";
import {
  normalizeBaseUrl,
  normalizeDelimitedList,
  parseBoolean,
  parseNumber,
} from "@/configuration/environment/shared";
import {
  AUTH_SECURITY_DETECTION_MODES,
  PASSWORD_BREACH_CHECK_MODES,
  type PasswordBreachCheckMode,
  type AccessTokenSigningKey,
  type AppEnvironment,
  type AuthSecurityDetectionMode,
  type EnvironmentVariableName,
  type HmacSigningKey,
  MICROSOFT_VERIFIED_EMAIL_POLICIES,
  type MicrosoftVerifiedEmailPolicy,
  type NodeEnvironment,
  OAUTH_PROVIDER_NAMES,
  type OAuthProviderName,
  type RawEnvironmentValues,
  type RefreshReuseResponse,
  type RefreshTokenMode,
} from "@/configuration/environment/types";
import { z } from "zod";

const environmentEmailSchema = z.email();

function parseMfaBypassEmails(
  raw: RawEnvironmentValues,
  errors: string[],
): string[] {
  const normalizedEntries = normalizeDelimitedList(raw.MFA_BYPASS_EMAILS).map(
    (entry) => entry.toLowerCase(),
  );
  const dedupedEntries = Array.from(new Set(normalizedEntries));

  return dedupedEntries.filter((entry) => {
    if (!environmentEmailSchema.safeParse(entry).success) {
      errors.push(`MFA_BYPASS_EMAILS contains an invalid email: ${entry}.`);
      return false;
    }

    return true;
  });
}

/**
 * Multi-tenant Microsoft sign-in lets any tenant admin put any address in a
 * user's `email` claim, so a deployment that accepts `common` or
 * `organizations` has to say which claim proves the address is real.
 */
const MULTI_TENANT_MICROSOFT_TENANTS = new Set(["common", "organizations"]);

function parseMicrosoftVerifiedEmailPolicy(
  raw: RawEnvironmentValues,
  tenant: string,
  errors: string[],
): MicrosoftVerifiedEmailPolicy | undefined {
  const value = raw.MICROSOFT_OAUTH_VERIFIED_EMAIL_POLICY;

  if (value === undefined) {
    if (MULTI_TENANT_MICROSOFT_TENANTS.has(tenant)) {
      errors.push(
        `MICROSOFT_OAUTH_TENANT=${tenant} requires MICROSOFT_OAUTH_VERIFIED_EMAIL_POLICY (${MICROSOFT_VERIFIED_EMAIL_POLICIES.join(" or ")}).`,
      );
    }

    return undefined;
  }

  if (
    !(MICROSOFT_VERIFIED_EMAIL_POLICIES as readonly string[]).includes(value)
  ) {
    errors.push(
      `MICROSOFT_OAUTH_VERIFIED_EMAIL_POLICY must be one of: ${MICROSOFT_VERIFIED_EMAIL_POLICIES.join(", ")}.`,
    );
    return undefined;
  }

  return value as MicrosoftVerifiedEmailPolicy;
}

/**
 * The providers whose sign-in still ends with the browser holding the ID
 * token: Microsoft redeems its code in the browser (an Entra SPA redirect),
 * and Apple's JS SDK hands the token back to the page. `none` turns the
 * switch off, so every provider goes through the backend code exchange.
 */
const DEFAULT_CLIENT_ID_TOKEN_PROVIDERS: OAuthProviderName[] = [
  "microsoft",
  "apple",
];

function parseClientIdTokenProviders(
  raw: RawEnvironmentValues,
  errors: string[],
): OAuthProviderName[] {
  const value = raw.OAUTH_CLIENT_ID_TOKEN_PROVIDERS;

  if (value === undefined) {
    return [...DEFAULT_CLIENT_ID_TOKEN_PROVIDERS];
  }

  if (value.trim().toLowerCase() === "none") {
    return [];
  }

  const providers: OAuthProviderName[] = [];

  for (const entry of normalizeDelimitedList(value)) {
    const provider = entry.toLowerCase();

    if (provider === "google") {
      // Google's sign-in always ends with a code; nothing legitimate posts a
      // Google ID token, so allowing one would only widen what can be replayed.
      errors.push(
        "OAUTH_CLIENT_ID_TOKEN_PROVIDERS cannot include google: Google sign-in always uses the backend code exchange.",
      );
      continue;
    }

    if (!(OAUTH_PROVIDER_NAMES as readonly string[]).includes(provider)) {
      errors.push(
        `OAUTH_CLIENT_ID_TOKEN_PROVIDERS contains an unknown provider: ${entry}. Use microsoft, apple, or none.`,
      );
      continue;
    }

    if (!providers.includes(provider as OAuthProviderName)) {
      providers.push(provider as OAuthProviderName);
    }
  }

  return providers;
}

export function parseRefreshTokenMode(
  raw: RawEnvironmentValues,
  errors: string[],
): RefreshTokenMode {
  const value = raw.REFRESH_TOKEN_MODE ?? "stateful";

  if (value === "stateful") {
    return "stateful";
  }

  if (value === "stateless") {
    errors.push("REFRESH_TOKEN_MODE=stateless is no longer supported.");
    return "stateful";
  }

  errors.push("REFRESH_TOKEN_MODE must be 'stateful'.");
  return "stateful";
}

function parseRefreshReuseResponse(
  raw: RawEnvironmentValues,
  nodeEnv: NodeEnvironment,
  errors: string[],
): RefreshReuseResponse {
  const value =
    raw.AUTH_REFRESH_REUSE_RESPONSE ??
    (nodeEnv === "production" ? "user" : "session");

  if (value === "session" || value === "user") {
    return value;
  }

  errors.push("AUTH_REFRESH_REUSE_RESPONSE must be 'session' or 'user'.");
  return nodeEnv === "production" ? "user" : "session";
}

export function buildAuthConfig(
  raw: RawEnvironmentValues,
  errors: string[],
  refreshTokenMode: RefreshTokenMode,
  accessTokenKeys: AccessTokenSigningKey[],
  refreshTokenKeys: HmacSigningKey[],
  personalAccessTokenKeys: HmacSigningKey[],
  authAuditIdentifierSecret: string,
  otpHashSecret: string,
  mfaTotpEncryptionKey: string,
  nodeEnv: NodeEnvironment,
): AppEnvironment["auth"] {
  return {
    mfaBypassEmails: parseMfaBypassEmails(raw, errors),
    accessTokenKeys,
    refreshTokenKeys,
    accessTokenTtlSeconds: parseNumber(
      raw,
      "ACCESS_TOKEN_TTL_SECONDS",
      15 * 60,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    refreshTokenTtlSeconds: parseNumber(
      raw,
      "REFRESH_TOKEN_TTL_SECONDS",
      30 * 24 * 60 * 60,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    rememberMeRefreshTokenTtlSeconds: parseNumber(
      raw,
      "REMEMBER_ME_REFRESH_TOKEN_TTL_SECONDS",
      90 * 24 * 60 * 60,
      errors,
      {
        integer: true,
        min: 1,
      },
    ),
    issuer: raw.TOKEN_ISSUER,
    audience: raw.TOKEN_AUDIENCE,
    refreshTokenMode,
    refreshReuseResponse: parseRefreshReuseResponse(raw, nodeEnv, errors),
    refreshTokenCachePrefix:
      raw.REFRESH_TOKEN_CACHE_PREFIX ?? DEFAULT_REFRESH_TOKEN_CACHE_PREFIX,
    personalAccessTokenKeys,
    authAuditIdentifierSecret,
    otpHashSecret,
    mfaTotpEncryptionKey,
    secureCookies: parseSecureCookies(raw, nodeEnv, errors),
  };
}

/**
 * Production always sends `Secure` cookies. Anywhere else they follow
 * AUTH_COOKIE_SECURE, which exists so the `__Host-` cookie names can be
 * exercised locally: browsers accept `Secure` cookies from http://localhost.
 */
function parseSecureCookies(
  raw: RawEnvironmentValues,
  nodeEnv: NodeEnvironment,
  errors: string[],
): boolean {
  const isProduction = nodeEnv === "production";
  const secure = parseBoolean(raw.AUTH_COOKIE_SECURE, isProduction);

  if (isProduction && !secure) {
    errors.push("AUTH_COOKIE_SECURE cannot be false in production.");
    return true;
  }

  return secure;
}

// setTimeout holds a 32-bit signed delay and runs anything longer after 1 ms,
// so a longer interval would make the prune worker run back to back.
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_AUTH_AUDIT_PRUNE_INTERVAL_MINUTES = Math.floor(
  MAX_TIMER_DELAY_MS / 60_000,
);

/**
 * Retention for auth_audit_events. A retention of zero or less would delete
 * every row on the next run, so it is a startup error rather than a policy.
 * The batch size bounds the id list each delete statement carries.
 */
export function buildAuthAuditConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["authAudit"] {
  return {
    retentionDays: parseNumber(raw, "AUTH_AUDIT_RETENTION_DAYS", 180, errors, {
      integer: true,
      min: 1,
    }),
    pruneBatchSize: parseNumber(
      raw,
      "AUTH_AUDIT_PRUNE_BATCH_SIZE",
      1000,
      errors,
      {
        integer: true,
        min: 1,
        max: 10_000,
      },
    ),
    pruneIntervalMinutes: parseNumber(
      raw,
      "AUTH_AUDIT_PRUNE_INTERVAL_MINUTES",
      60,
      errors,
      {
        integer: true,
        min: 1,
        max: MAX_AUTH_AUDIT_PRUNE_INTERVAL_MINUTES,
      },
    ),
  };
}

// A week bounds every detection window and IP block, so a typo cannot keep
// Redis keys, or a blocked IP, around indefinitely.
const MAX_DETECTION_WINDOW_MINUTES = 7 * 24 * 60;
const MAX_DETECTION_THRESHOLD = 10_000;

/**
 * Suspicious sign-in detection, plus the thresholds of the emailed codes, the
 * password lockout, step-up and refresh rotation. Every rule defaults on with
 * the thresholds in docs/auth-security.md, and the mode defaults to alert,
 * which never locks an account or blocks an IP. Every other default is the
 * value that was hard-coded before it became configurable.
 */
export function buildAuthSecurityConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["authSecurity"] {
  const threshold = (name: EnvironmentVariableName, fallback: number): number =>
    parseNumber(raw, name, fallback, errors, {
      integer: true,
      min: 1,
      max: MAX_DETECTION_THRESHOLD,
    });
  const minutes = (name: EnvironmentVariableName, fallback: number): number =>
    parseNumber(raw, name, fallback, errors, {
      integer: true,
      min: 1,
      max: MAX_DETECTION_WINDOW_MINUTES,
    });

  return {
    detection: {
      mode: parseAuthSecurityDetectionMode(raw, errors),
      repeatedLockouts: {
        enabled: parseBoolean(
          raw.AUTH_SECURITY_REPEATED_LOCKOUTS_ENABLED,
          true,
        ),
        threshold: threshold("AUTH_SECURITY_REPEATED_LOCKOUTS_THRESHOLD", 3),
        windowMinutes: minutes(
          "AUTH_SECURITY_REPEATED_LOCKOUTS_WINDOW_MINUTES",
          24 * 60,
        ),
      },
      credentialStuffing: {
        enabled: parseBoolean(
          raw.AUTH_SECURITY_CREDENTIAL_STUFFING_ENABLED,
          true,
        ),
        threshold: threshold("AUTH_SECURITY_CREDENTIAL_STUFFING_THRESHOLD", 20),
        windowMinutes: minutes(
          "AUTH_SECURITY_CREDENTIAL_STUFFING_WINDOW_MINUTES",
          10,
        ),
        blockMinutes: minutes(
          "AUTH_SECURITY_CREDENTIAL_STUFFING_BLOCK_MINUTES",
          60,
        ),
      },
      successAfterFailures: {
        enabled: parseBoolean(
          raw.AUTH_SECURITY_SUCCESS_AFTER_FAILURES_ENABLED,
          true,
        ),
        threshold: threshold(
          "AUTH_SECURITY_SUCCESS_AFTER_FAILURES_THRESHOLD",
          5,
        ),
        windowMinutes: minutes(
          "AUTH_SECURITY_SUCCESS_AFTER_FAILURES_WINDOW_MINUTES",
          60,
        ),
      },
      refreshReuse: {
        enabled: parseBoolean(raw.AUTH_SECURITY_REFRESH_REUSE_ENABLED, true),
        windowMinutes: minutes(
          "AUTH_SECURITY_REFRESH_REUSE_WINDOW_MINUTES",
          60,
        ),
      },
    },
    otp: buildOtpConfig(raw, errors),
    lockout: {
      maxFailedAttempts: integer(
        raw,
        "AUTH_SECURITY_LOCKOUT_MAX_FAILED_ATTEMPTS",
        5,
        errors,
        1,
        MAX_ATTEMPT_BUDGET,
      ),
      failedAttemptTtlMinutes: minutes(
        "AUTH_SECURITY_LOCKOUT_FAILED_ATTEMPT_TTL_MINUTES",
        15,
      ),
      lockMinutes: minutes("AUTH_SECURITY_LOCKOUT_LOCK_MINUTES", 30),
    },
    stepUp: {
      challengeLimit: threshold("AUTH_SECURITY_STEP_UP_CHALLENGE_LIMIT", 5),
      challengeWindowSeconds: seconds(
        raw,
        "AUTH_SECURITY_STEP_UP_CHALLENGE_WINDOW_SECONDS",
        60,
        errors,
      ),
      confirmLimit: threshold("AUTH_SECURITY_STEP_UP_CONFIRM_LIMIT", 10),
      confirmWindowSeconds: seconds(
        raw,
        "AUTH_SECURITY_STEP_UP_CONFIRM_WINDOW_SECONDS",
        60,
        errors,
      ),
      failedConfirmThreshold: integer(
        raw,
        "AUTH_SECURITY_STEP_UP_FAILED_CONFIRM_THRESHOLD",
        5,
        errors,
        1,
        MAX_ATTEMPT_BUDGET,
      ),
      failedConfirmTtlSeconds: seconds(
        raw,
        "AUTH_SECURITY_STEP_UP_FAILED_CONFIRM_TTL_SECONDS",
        10 * 60,
        errors,
      ),
      failedConfirmLockSeconds: seconds(
        raw,
        "AUTH_SECURITY_STEP_UP_FAILED_CONFIRM_LOCK_SECONDS",
        5 * 60,
        errors,
      ),
    },
    refresh: {
      rotationGracePeriodSeconds: integer(
        raw,
        "AUTH_SECURITY_REFRESH_ROTATION_GRACE_SECONDS",
        5,
        errors,
        0,
        MAX_REFRESH_GRACE_SECONDS,
      ),
    },
    passwords: {
      breachCheck: {
        mode: parsePasswordBreachCheckMode(raw, errors),
        timeoutMs: integer(
          raw,
          "AUTH_SECURITY_PASSWORD_BREACH_CHECK_TIMEOUT_MS",
          1_500,
          errors,
          MIN_BREACH_CHECK_TIMEOUT_MS,
          MAX_BREACH_CHECK_TIMEOUT_MS,
        ),
      },
    },
  };
}

// Every new password waits on the check, so it is bounded on both sides: too
// short and it never succeeds, too long and an outage stalls every signup.
const MIN_BREACH_CHECK_TIMEOUT_MS = 200;
const MAX_BREACH_CHECK_TIMEOUT_MS = 10_000;

function parsePasswordBreachCheckMode(
  raw: RawEnvironmentValues,
  errors: string[],
): PasswordBreachCheckMode {
  const value =
    raw.AUTH_SECURITY_PASSWORD_BREACH_CHECK_MODE?.toLowerCase() ?? "enforce";

  if ((PASSWORD_BREACH_CHECK_MODES as readonly string[]).includes(value)) {
    return value as PasswordBreachCheckMode;
  }

  errors.push(
    `AUTH_SECURITY_PASSWORD_BREACH_CHECK_MODE must be one of: ${PASSWORD_BREACH_CHECK_MODES.join(", ")}.`,
  );
  return "enforce";
}

// Guess budgets above this would make the lock or the code pointless.
const MAX_ATTEMPT_BUDGET = 100;
const MAX_WINDOW_SECONDS = 7 * 24 * 60 * 60;
// A replayed refresh token is honoured within the grace period, so it stays
// short enough that a stolen token gains nothing from it.
const MAX_REFRESH_GRACE_SECONDS = 60;
// A code longer-lived than an hour is a weak password, not a one-time code.
const MIN_OTP_TTL_SECONDS = 60;
const MAX_OTP_TTL_SECONDS = 60 * 60;

function integer(
  raw: RawEnvironmentValues,
  name: EnvironmentVariableName,
  fallback: number,
  errors: string[],
  min: number,
  max: number,
): number {
  return parseNumber(raw, name, fallback, errors, { integer: true, min, max });
}

function seconds(
  raw: RawEnvironmentValues,
  name: EnvironmentVariableName,
  fallback: number,
  errors: string[],
): number {
  return integer(raw, name, fallback, errors, 1, MAX_WINDOW_SECONDS);
}

function buildOtpConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["authSecurity"]["otp"] {
  const ttlSeconds = integer(
    raw,
    "AUTH_SECURITY_OTP_TTL_SECONDS",
    10 * 60,
    errors,
    MIN_OTP_TTL_SECONDS,
    MAX_OTP_TTL_SECONDS,
  );
  const resendCooldownSeconds = integer(
    raw,
    "AUTH_SECURITY_OTP_RESEND_COOLDOWN_SECONDS",
    60,
    errors,
    0,
    MAX_OTP_TTL_SECONDS,
  );

  if (resendCooldownSeconds > ttlSeconds) {
    errors.push(
      "AUTH_SECURITY_OTP_RESEND_COOLDOWN_SECONDS must not exceed AUTH_SECURITY_OTP_TTL_SECONDS, or a code expires before it can be resent.",
    );
  }

  const publicLimit = (name: EnvironmentVariableName, fallback: number) =>
    integer(raw, name, fallback, errors, 1, MAX_DETECTION_THRESHOLD);

  return {
    ttlSeconds,
    resendCooldownSeconds,
    maxAttempts: integer(
      raw,
      "AUTH_SECURITY_OTP_MAX_ATTEMPTS",
      5,
      errors,
      1,
      MAX_ATTEMPT_BUDGET,
    ),
    publicLimits: {
      windowSeconds: seconds(
        raw,
        "AUTH_SECURITY_OTP_PUBLIC_WINDOW_SECONDS",
        60 * 60,
        errors,
      ),
      perEmail: publicLimit("AUTH_SECURITY_OTP_PUBLIC_PER_EMAIL", 5),
      perIp: publicLimit("AUTH_SECURITY_OTP_PUBLIC_PER_IP", 20),
      perDevice: publicLimit("AUTH_SECURITY_OTP_PUBLIC_PER_DEVICE", 10),
    },
  };
}

function parseAuthSecurityDetectionMode(
  raw: RawEnvironmentValues,
  errors: string[],
): AuthSecurityDetectionMode {
  const value = raw.AUTH_SECURITY_DETECTION_MODE?.toLowerCase() ?? "alert";

  if ((AUTH_SECURITY_DETECTION_MODES as readonly string[]).includes(value)) {
    return value as AuthSecurityDetectionMode;
  }

  errors.push(
    `AUTH_SECURITY_DETECTION_MODE must be one of: ${AUTH_SECURITY_DETECTION_MODES.join(", ")}.`,
  );
  return "alert";
}

export function buildEmailConfig(
  raw: RawEnvironmentValues,
  gmailUser: string,
  gmailAppPassword: string,
): AppEnvironment["email"] {
  const appBaseUrl = normalizeBaseUrl(
    raw.APP_BASE_URL ?? raw.FRONTEND_URL ?? DEFAULT_EMAIL_APP_BASE_URL,
  );

  return {
    gmailUser,
    gmailAppPassword,
    fromEmail: raw.EMAIL_FROM ?? gmailUser,
    fromName: raw.EMAIL_FROM_NAME ?? "Rent",
    appBaseUrl,
  };
}

export function buildCaptchaConfig(
  raw: RawEnvironmentValues,
): AppEnvironment["captcha"] {
  const allowedHosts = normalizeDelimitedList(raw.CAPTCHA_ALLOWED_HOSTS);

  return {
    secretKey: raw.CLOUDFLARE_TURNSTILE_SECRET_KEY,
    allowedHosts: allowedHosts.length
      ? allowedHosts
      : [DEFAULT_CAPTCHA_ALLOWED_HOST],
    allowedHostnames: normalizeDelimitedList(raw.CAPTCHA_ALLOWED_HOSTNAMES).map(
      (hostname) => hostname.toLowerCase(),
    ),
  };
}

export function buildCorsConfig(
  raw: RawEnvironmentValues,
): AppEnvironment["cors"] {
  const allowedOrigins =
    normalizeDelimitedList(raw.CORS_ALLOWED_ORIGINS ?? raw.FRONTEND_URL) || [];

  return {
    allowedOrigins: allowedOrigins.length
      ? allowedOrigins
      : [DEFAULT_FRONTEND_URL],
  };
}

export function buildCsrfConfig(
  raw: RawEnvironmentValues,
): AppEnvironment["csrf"] {
  const allowedOrigins =
    normalizeDelimitedList(
      raw.CSRF_ALLOWED_ORIGINS ?? raw.CORS_ALLOWED_ORIGINS ?? raw.FRONTEND_URL,
    ) || [];

  return {
    allowedOrigins: allowedOrigins.length
      ? allowedOrigins
      : [DEFAULT_FRONTEND_URL],
  };
}

export function buildOauthConfig(
  raw: RawEnvironmentValues,
  errors: string[],
): AppEnvironment["oauth"] {
  const frontendBaseUrl = normalizeBaseUrl(
    raw.FRONTEND_URL ?? raw.APP_BASE_URL ?? DEFAULT_FRONTEND_URL,
  );
  const googleAudiences = normalizeDelimitedList(
    raw.GOOGLE_OAUTH_CLIENT_IDS ?? raw.GOOGLE_OAUTH_CLIENT_ID,
  );
  const microsoftAudiences = normalizeDelimitedList(
    raw.MICROSOFT_OAUTH_CLIENT_IDS ?? raw.MICROSOFT_OAUTH_CLIENT_ID,
  );

  const appleAudiences = normalizeDelimitedList(
    raw.APPLE_OAUTH_CLIENT_IDS ?? raw.APPLE_OAUTH_CLIENT_ID,
  );
  // PEM keys are often stored on one line with escaped newlines.
  const applePrivateKey = raw.APPLE_OAUTH_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (
    applePrivateKey &&
    (appleAudiences.length === 0 ||
      !raw.APPLE_OAUTH_TEAM_ID ||
      !raw.APPLE_OAUTH_KEY_ID)
  ) {
    errors.push(
      "APPLE_OAUTH_PRIVATE_KEY requires APPLE_OAUTH_CLIENT_ID (or APPLE_OAUTH_CLIENT_IDS), APPLE_OAUTH_TEAM_ID, and APPLE_OAUTH_KEY_ID.",
    );
  }

  if (raw.GOOGLE_OAUTH_CLIENT_SECRET && googleAudiences.length === 0) {
    errors.push(
      "GOOGLE_OAUTH_CLIENT_SECRET requires GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_IDS.",
    );
  }

  if (raw.MICROSOFT_OAUTH_CLIENT_SECRET && microsoftAudiences.length === 0) {
    errors.push(
      "MICROSOFT_OAUTH_CLIENT_SECRET requires MICROSOFT_OAUTH_CLIENT_ID or MICROSOFT_OAUTH_CLIENT_IDS.",
    );
  }

  const clientIdTokenProviders = parseClientIdTokenProviders(raw, errors);
  const microsoftTenant = raw.MICROSOFT_OAUTH_TENANT ?? "consumers";
  const microsoftVerifiedEmailPolicy = parseMicrosoftVerifiedEmailPolicy(
    raw,
    microsoftTenant,
    errors,
  );

  return {
    clientIdTokenProviders,
    google: {
      audiences: googleAudiences,
      clientSecret: raw.GOOGLE_OAUTH_CLIENT_SECRET,
      frontendBaseUrl,
    },
    microsoft: {
      audiences: microsoftAudiences,
      clientSecret: raw.MICROSOFT_OAUTH_CLIENT_SECRET,
      tenant: microsoftTenant,
      verifiedEmailPolicy: microsoftVerifiedEmailPolicy,
      frontendBaseUrl,
    },
    apple: {
      audiences: appleAudiences,
      teamId: raw.APPLE_OAUTH_TEAM_ID,
      keyId: raw.APPLE_OAUTH_KEY_ID,
      privateKey: applePrivateKey,
      frontendBaseUrl,
    },
  };
}
