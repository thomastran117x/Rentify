const MAX_REFRESH_LEAD_TIME_MS = 60_000;
const SHORT_TOKEN_REFRESH_LEAD_RATIO = 0.1;

export interface AccessTokenTiming {
  expiresAtMs: number;
  issuedAtMs: number;
  refreshDelayMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeBase64UrlJson(value: string): unknown {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const decoded = atob(`${normalized}${"=".repeat(paddingLength)}`);
  const bytes = Uint8Array.from(decoded, (character) =>
    character.charCodeAt(0),
  );

  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Reads timing claims without treating the browser-decoded payload as trusted.
 * The backend still verifies the JWT signature; the frontend only needs these
 * values to decide when to ask the backend for a replacement token.
 */
export function readAccessTokenTiming(
  accessToken: string,
): AccessTokenTiming | null {
  const parts = accessToken.split(".");

  if (parts.length !== 3 || !parts[1]) {
    return null;
  }

  try {
    const claims = decodeBase64UrlJson(parts[1]);

    if (
      !isRecord(claims) ||
      typeof claims.iat !== "number" ||
      !Number.isFinite(claims.iat) ||
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      claims.iat < 0 ||
      claims.exp <= claims.iat
    ) {
      return null;
    }

    const issuedAtMs = claims.iat * 1_000;
    const expiresAtMs = claims.exp * 1_000;

    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) {
      return null;
    }

    const lifetimeMs = expiresAtMs - issuedAtMs;
    const refreshLeadTimeMs = Math.min(
      MAX_REFRESH_LEAD_TIME_MS,
      lifetimeMs * SHORT_TOKEN_REFRESH_LEAD_RATIO,
    );

    return {
      expiresAtMs,
      issuedAtMs,
      refreshDelayMs: lifetimeMs - refreshLeadTimeMs,
    };
  } catch {
    return null;
  }
}
