import { DEFAULT_FRONTEND_URL } from "@/configuration/environment/constants";
import { normalizeDelimitedList } from "@/configuration/environment/shared";
import type {
  AppEnvironment,
  NodeEnvironment,
  RawEnvironmentValues,
} from "@/configuration/environment/types";

const DEFAULT_RP_NAME = "Rentify";
const HOSTNAME_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * An origin as the browser reports it in `clientDataJSON`, or null when the
 * value is not one: a path, query, fragment or credentials would never match.
 */
function parseOrigin(value: string): URL | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const bare =
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.hostname !== "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";

  return bare ? url : null;
}

function isOnRpId(hostname: string, rpId: string): boolean {
  return hostname === rpId || hostname.endsWith(`.${rpId}`);
}

/**
 * The relying party for passkeys. Both the RP ID and the origins default to
 * `FRONTEND_URL`, which is right for a site served from one origin.
 *
 * Unlike CORS, loopback origins are not widened to their `127.0.0.1` spelling:
 * an IP address can never be an RP ID, so a browser on `127.0.0.1` cannot use
 * a passkey for `localhost` and listing it would only hide the mistake.
 *
 * Every rule here is checked at startup, because a wrong RP ID only shows up
 * when someone tries to register a passkey, and a changed one orphans every
 * passkey already registered.
 */
export function buildWebAuthnConfig(
  raw: RawEnvironmentValues,
  errors: string[],
  nodeEnv: NodeEnvironment,
): AppEnvironment["webauthn"] {
  const configuredOrigins = normalizeDelimitedList(
    raw.WEBAUTHN_ORIGINS ?? raw.FRONTEND_URL ?? DEFAULT_FRONTEND_URL,
  );
  const originSource = raw.WEBAUTHN_ORIGINS
    ? "WEBAUTHN_ORIGINS"
    : "FRONTEND_URL";
  const origins: URL[] = [];

  for (const value of configuredOrigins) {
    const origin = parseOrigin(value);

    if (!origin) {
      errors.push(
        `${originSource} contains a value that is not a bare http(s) origin: ${value}.`,
      );
      continue;
    }

    origins.push(origin);
  }

  if (configuredOrigins.length === 0) {
    errors.push(`${originSource} must list at least one origin for passkeys.`);
  }

  const rpId = (raw.WEBAUTHN_RP_ID ?? origins[0]?.hostname ?? "")
    .trim()
    .toLowerCase();

  if (!HOSTNAME_PATTERN.test(rpId) || IPV4_PATTERN.test(rpId)) {
    errors.push(
      `WEBAUTHN_RP_ID must be a domain name without a scheme, port or path, and not an IP address: ${rpId || "(empty)"}.`,
    );
  } else {
    for (const origin of origins) {
      if (!isOnRpId(origin.hostname, rpId)) {
        errors.push(
          `${originSource} origin ${origin.origin} is not on WEBAUTHN_RP_ID ${rpId} or one of its subdomains.`,
        );
      }
    }
  }

  if (nodeEnv === "production") {
    for (const origin of origins) {
      if (origin.protocol !== "https:" && origin.hostname !== "localhost") {
        errors.push(
          `${originSource} origin ${origin.origin} must use https in production.`,
        );
      }
    }
  }

  const rpName = raw.WEBAUTHN_RP_NAME?.trim() || DEFAULT_RP_NAME;

  return {
    rpId,
    rpName,
    origins: [...new Set(origins.map((origin) => origin.origin))],
  };
}
