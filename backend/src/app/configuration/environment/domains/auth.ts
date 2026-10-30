import { createPrivateKey, createPublicKey } from "node:crypto";
import {
  DEFAULT_CAPTCHA_ALLOWED_HOST,
  DEFAULT_EMAIL_APP_BASE_URL,
  DEFAULT_FRONTEND_URL,
  DEFAULT_REFRESH_TOKEN_CACHE_PREFIX,
  MINIMUM_TOKEN_SECRET_LENGTH,
} from "@/configuration/environment/constants";
import {
  normalizeBaseUrl,
  normalizeDelimitedList,
  parseBoolean,
  parseNumber,
} from "@/configuration/environment/shared";
import {
  AUTH_SECURITY_DETECTION_MODES,
  type AppEnvironment,
  type AccessTokenAlgorithm,
  type AuthSecurityDetectionMode,
  type EnvironmentVariableName,
  type NodeEnvironment,
  type RawEnvironmentValues,
  type RefreshReuseResponse,
  type RefreshTokenMode,
} from "@/configuration/environment/types";
import { z } from "zod";

const environmentEmailSchema = z.email();

interface AccessTokenCredentials {
  algorithm: AccessTokenAlgorithm;
  secret?: string;
  privateKey?: string;
  publicKey?: string;
}

function normalizePem(value?: string): string | undefined {
  return value?.replace(/\\n/g, "\n");
}

function validateRsaKeyPair(
  privateKeyPem: string,
  publicKeyPem: string,
  errors: string[],
): void {
  let privateKey: ReturnType<typeof createPrivateKey> | undefined;
  let publicKey: ReturnType<typeof createPublicKey> | undefined;

  try {
    privateKey = createPrivateKey(privateKeyPem);
    if (privateKey.asymmetricKeyType !== "rsa") {
      errors.push("ACCESS_TOKEN_PRIVATE_KEY must contain an RSA private key.");
      privateKey = undefined;
    } else if ((privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2_048) {
      errors.push("ACCESS_TOKEN_PRIVATE_KEY must be at least 2048 bits.");
      privateKey = undefined;
    }
  } catch {
    errors.push(
      "ACCESS_TOKEN_PRIVATE_KEY must contain a valid RSA private key.",
    );
  }

  try {
    publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== "rsa") {
      errors.push("ACCESS_TOKEN_PUBLIC_KEY must contain an RSA public key.");
      publicKey = undefined;
    } else if ((publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2_048) {
      errors.push("ACCESS_TOKEN_PUBLIC_KEY must be at least 2048 bits.");
      publicKey = undefined;
    }
  } catch {
    errors.push("ACCESS_TOKEN_PUBLIC_KEY must contain a valid RSA public key.");
  }

  if (!privateKey || !publicKey) {
    return;
  }

  const derivedPublicKey = createPublicKey(privateKey).export({
    format: "der",
    type: "spki",
  });
  const configuredPublicKey = publicKey.export({
    format: "der",
    type: "spki",
  });

  if (!derivedPublicKey.equals(configuredPublicKey)) {
    errors.push(
      "ACCESS_TOKEN_PRIVATE_KEY and ACCESS_TOKEN_PUBLIC_KEY must form a matching RSA key pair.",
    );
  }
}

export function parseAccessTokenCredentials(
  raw: RawEnvironmentValues,
  errors: string[],
): AccessTokenCredentials {
  const configuredAlgorithm = raw.ACCESS_TOKEN_ALGORITHM ?? "HS256";
  const algorithm: AccessTokenAlgorithm =
    configuredAlgorithm === "RS256" ? "RS256" : "HS256";

  if (configuredAlgorithm !== "HS256" && configuredAlgorithm !== "RS256") {
    errors.push("ACCESS_TOKEN_ALGORITHM must be 'HS256' or 'RS256'.");
  }

  if (algorithm === "HS256") {
    const secret = raw.ACCESS_TOKEN_SECRET;

    if (!secret) {
      errors.push("ACCESS_TOKEN_SECRET is required when using HS256.");
    } else if (secret.length < MINIMUM_TOKEN_SECRET_LENGTH) {
      errors.push(
        `ACCESS_TOKEN_SECRET must be at least ${MINIMUM_TOKEN_SECRET_LENGTH} characters long.`,
      );
    }

    return { algorithm, secret };
  }

  const privateKey = normalizePem(raw.ACCESS_TOKEN_PRIVATE_KEY);
  const publicKey = normalizePem(raw.ACCESS_TOKEN_PUBLIC_KEY);

  if (!privateKey) {
    errors.push("ACCESS_TOKEN_PRIVATE_KEY is required when using RS256.");
  }
  if (!publicKey) {
    errors.push("ACCESS_TOKEN_PUBLIC_KEY is required when using RS256.");
  }
  if (privateKey && publicKey) {
    validateRsaKeyPair(privateKey, publicKey, errors);
  }

  return { algorithm, privateKey, publicKey };
}

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
  accessTokenCredentials: AccessTokenCredentials,
  refreshTokenSecret: string,
  personalAccessTokenSecret: string,
  authAuditIdentifierSecret: string,
  mfaTotpEncryptionKey: string,
  nodeEnv: NodeEnvironment,
): AppEnvironment["auth"] {
  return {
    mfaBypassEmails: parseMfaBypassEmails(raw, errors),
    accessTokenAlgorithm: accessTokenCredentials.algorithm,
    accessTokenSecret: accessTokenCredentials.secret,
    accessTokenPrivateKey: accessTokenCredentials.privateKey,
    accessTokenPublicKey: accessTokenCredentials.publicKey,
    refreshTokenSecret,
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
    personalAccessTokenSecret,
    authAuditIdentifierSecret,
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
 * Suspicious sign-in detection. Every rule defaults on with the thresholds in
 * docs/auth-security.md, and the mode defaults to alert, which never locks an
 * account or blocks an IP.
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

  return {
    google: {
      audiences: googleAudiences,
      clientSecret: raw.GOOGLE_OAUTH_CLIENT_SECRET,
      frontendBaseUrl,
    },
    microsoft: {
      audiences: microsoftAudiences,
      clientSecret: raw.MICROSOFT_OAUTH_CLIENT_SECRET,
      tenant: raw.MICROSOFT_OAUTH_TENANT ?? "consumers",
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
