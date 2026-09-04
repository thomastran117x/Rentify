import { getOptionalEnvironmentVariable } from "@/configuration/environment";

const DEFAULT_FRONTEND_ORIGIN = "http://localhost:3040";

/**
 * Loopback origins are configured one way but arrive the other.
 *
 * A stack configured with `http://localhost:3040` still receives requests whose
 * `Origin` is `http://127.0.0.1:3040` (and vice versa), because the two spell
 * the same host. Treating them as distinct would reject the frontend's own
 * calls in local development, so every loopback origin is expanded to both
 * spellings.
 */
export function expandLoopbackOriginAliases(origin: string): string[] {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.trim().toLowerCase();

    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      return [url.origin];
    }

    const aliases = new Set<string>([url.origin]);

    for (const loopbackHostname of ["localhost", "127.0.0.1"]) {
      url.hostname = loopbackHostname;
      aliases.add(url.origin);
    }

    return [...aliases];
  } catch {
    return [origin];
  }
}

/**
 * The scheme/host/port of a URL, or `null` when the value is not a URL at all.
 */
export function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function parseOriginList(configuredOrigins: string): string[] {
  return [
    ...new Set(
      configuredOrigins
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
        .flatMap((origin) => expandLoopbackOriginAliases(origin)),
    ),
  ];
}

/**
 * The origins the Rentify web app itself is served from.
 *
 * Deliberately reads `FRONTEND_URL` alone rather than the CORS list. The CORS
 * list is a permission — which origins may call the API from a browser — and a
 * deployment can legitimately allow partner origins there. Treating everything
 * on it as "our frontend" would file a partner's browser traffic under
 * `frontend-browser` and corrupt the caller split. When `FRONTEND_URL` is unset
 * this stays conservative and only recognises the local default: a first-party
 * caller still identifies itself through the client app header, and an
 * unrecognised browser origin is better reported as `browser-direct` than
 * wrongly claimed as our own.
 */
export function readFrontendOrigins(): string[] {
  return parseOriginList(
    getOptionalEnvironmentVariable("FRONTEND_URL") ?? DEFAULT_FRONTEND_ORIGIN,
  );
}

/**
 * Origins allowed to make cross-origin browser requests.
 *
 * Read on every call rather than memoised at module load, so tests that set the
 * environment per case see the value they configured.
 */
export function readCorsAllowedOrigins(): string[] {
  return parseOriginList(
    getOptionalEnvironmentVariable("CORS_ALLOWED_ORIGINS") ??
      getOptionalEnvironmentVariable("FRONTEND_URL") ??
      DEFAULT_FRONTEND_ORIGIN,
  );
}

/**
 * Origins accepted by the CSRF origin check.
 *
 * Defaults to the CORS list, but can be narrowed independently via
 * `CSRF_ALLOWED_ORIGINS` when a deployment serves a broader set of API clients
 * than it trusts with cookie-backed state changes.
 */
export function readCsrfAllowedOrigins(): string[] {
  const configuredOrigins = getOptionalEnvironmentVariable(
    "CSRF_ALLOWED_ORIGINS",
  );

  if (configuredOrigins) {
    return parseOriginList(configuredOrigins);
  }

  return readCorsAllowedOrigins();
}
