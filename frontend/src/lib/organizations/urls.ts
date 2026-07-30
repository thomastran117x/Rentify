import { serverEnv } from "@/lib/env";

/**
 * Organization URL helpers.
 *
 * Public organization pages are addressed by slug. A UUID or a retired slug
 * still resolves, and the page redirects to the canonical slug URL rather than
 * rendering the same content at two addresses.
 */

export const ORGANIZATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedOrganizationReference {
  organizationId: string;
  canonicalSlug: string;
  name: string;
  matchedBy: "canonical-slug" | "alias" | "uuid";
}

/** Raised when resolution failed for a reason that is not "no such organization". */
export class OrganizationResolutionError extends Error {
  constructor(readonly status: number) {
    super(`Failed to resolve organization reference (status ${status}).`);
    this.name = "OrganizationResolutionError";
  }
}

export function organizationHref(slug: string, ...segments: string[]): string {
  const suffix = segments
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/organizations/${encodeURIComponent(slug)}${suffix ? `/${suffix}` : ""}`;
}

/**
 * Reduce a raw URL segment to the form the API expects.
 *
 * Decoding, trimming, lowercasing, and dropping a trailing slash mean that
 * `/organizations/Harbor-Rentals/` and `/organizations/harbor-rentals` both
 * resolve, and both get redirected to the single canonical URL.
 */
export function normalizeOrganizationReference(raw: string): string {
  let decoded = raw;

  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding; fall through with the raw value so the API
    // rejects it rather than throwing here.
  }

  return decoded.trim().replace(/\/+$/, "").toLowerCase();
}

async function fetchJson(
  url: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    // Slugs are mutable, so a cached resolution can send visitors to a stale
    // canonical URL.
    cache: "no-store",
  });

  if (!response.ok) {
    return { status: response.status, body: null };
  }

  return { status: response.status, body: await response.json() };
}

/**
 * Map a URL reference (canonical slug, retired slug, or UUID) onto an
 * organization.
 *
 * Returns `null` only when the organization genuinely does not exist. Any other
 * failure throws: collapsing a backend outage into `null` would render a
 * "not found" page during an incident and silently skip canonical redirection.
 */
export async function resolveOrganizationReference(
  reference: string,
): Promise<ResolvedOrganizationReference | null> {
  const normalized = normalizeOrganizationReference(reference);

  if (ORGANIZATION_UUID_PATTERN.test(normalized)) {
    const { status, body } = await fetchJson(
      `${serverEnv.internalApiBaseUrl}/organizations/${normalized}`,
    );

    if (status === 404) {
      return null;
    }

    if (status !== 200) {
      throw new OrganizationResolutionError(status);
    }

    const organization = (
      body as {
        data?: { organization?: { id?: string; slug?: string; name?: string } };
      }
    )?.data?.organization;

    if (!organization?.slug || !organization.id) {
      throw new OrganizationResolutionError(status);
    }

    return {
      organizationId: organization.id,
      canonicalSlug: organization.slug,
      name: organization.name ?? "",
      matchedBy: "uuid",
    };
  }

  const { status, body } = await fetchJson(
    `${serverEnv.internalApiBaseUrl}/organizations/by-slug/${encodeURIComponent(normalized)}`,
  );

  // 400 means the reference could not be a slug at all (bad charset, reserved,
  // too short), which for a URL segment is indistinguishable from not found.
  if (status === 404 || status === 400) {
    return null;
  }

  if (status !== 200) {
    throw new OrganizationResolutionError(status);
  }

  const resolved = (body as { data?: ResolvedOrganizationReference })?.data;

  if (!resolved?.organizationId || !resolved.canonicalSlug) {
    throw new OrganizationResolutionError(status);
  }

  return resolved;
}

/**
 * Whether the reference as it appeared in the URL is already the canonical
 * form. Anything else should be redirected so a page has exactly one address.
 */
export function isCanonicalOrganizationReference(
  rawReference: string,
  canonicalSlug: string,
): boolean {
  return rawReference === canonicalSlug;
}
