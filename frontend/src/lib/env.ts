const API_ROUTE_PREFIX = "/api/v1";
const fallbackApiBaseUrl = `http://localhost:8040${API_ROUTE_PREFIX}`;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeApiBaseUrl(value: string): string {
  const normalizedValue = trimTrailingSlash(value);

  try {
    const url = new URL(normalizedValue);

    if (url.pathname === "/" || url.pathname === "/api") {
      url.pathname = API_ROUTE_PREFIX;
    }

    return trimTrailingSlash(url.toString());
  } catch {
    return normalizedValue;
  }
}

function isLoopbackHostname(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

function alignBrowserLoopbackHost(value: string): string {
  if (typeof window === "undefined") {
    return value;
  }

  try {
    const configuredUrl = new URL(value);
    const browserHostname = window.location.hostname.trim().toLowerCase();

    if (
      isLoopbackHostname(configuredUrl.hostname) &&
      isLoopbackHostname(browserHostname) &&
      configuredUrl.hostname.toLowerCase() !== browserHostname
    ) {
      configuredUrl.hostname = browserHostname;
      return trimTrailingSlash(configuredUrl.toString());
    }

    return value;
  } catch {
    return value;
  }
}

export const publicEnv = {
  apiBaseUrl: normalizeApiBaseUrl(
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || fallbackApiBaseUrl,
  ),
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "",
  googleOAuthClientId: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID?.trim() || "",
  microsoftOAuthClientId: process.env.NEXT_PUBLIC_MICROSOFT_OAUTH_CLIENT_ID?.trim() || "",
  microsoftOAuthTenant:
    process.env.NEXT_PUBLIC_MICROSOFT_OAUTH_TENANT?.trim() || "consumers",
} as const;

export const serverEnv = {
  internalApiBaseUrl: normalizeApiBaseUrl(
    process.env.INTERNAL_API_BASE_URL?.trim() || publicEnv.apiBaseUrl,
  ),
} as const;

export function resolveApiBaseUrl(): string {
  return typeof window === "undefined"
    ? serverEnv.internalApiBaseUrl
    : alignBrowserLoopbackHost(publicEnv.apiBaseUrl);
}
