import {
  DEFAULT_CAPTCHA_ALLOWED_HOST,
  DEFAULT_EMAIL_APP_BASE_URL,
  DEFAULT_FRONTEND_URL,
  DEFAULT_REFRESH_TOKEN_CACHE_PREFIX,
} from "@/configuration/environment/constants";
import {
  normalizeBaseUrl,
  normalizeDelimitedList,
  parseNumber,
} from "@/configuration/environment/shared";
import type {
  AppEnvironment,
  RawEnvironmentValues,
  RefreshTokenMode,
} from "@/configuration/environment/types";

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

export function buildAuthConfig(
  raw: RawEnvironmentValues,
  errors: string[],
  refreshTokenMode: RefreshTokenMode,
  accessTokenSecret: string,
  refreshTokenSecret: string,
  personalAccessTokenSecret: string,
  mfaTotpEncryptionKey: string,
): AppEnvironment["auth"] {
  return {
    accessTokenSecret,
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
    refreshTokenCachePrefix:
      raw.REFRESH_TOKEN_CACHE_PREFIX ?? DEFAULT_REFRESH_TOKEN_CACHE_PREFIX,
    personalAccessTokenSecret,
    mfaTotpEncryptionKey,
  };
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
  };
}
