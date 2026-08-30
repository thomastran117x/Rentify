import { randomBytes } from "node:crypto";

import { isUuid, type Uuid } from "@/configuration/validation/uuid";

/**
 * Slug helpers shared by organizations and organization blog posts.
 *
 * Extracted from OrganizationBlogService so that both features slugify
 * identically. The backfill script imports these too, which is what keeps the
 * one-off backfill from drifting away from runtime slug generation.
 */

export const ORGANIZATION_SLUG_MIN_LENGTH = 2;
export const ORGANIZATION_SLUG_MAX_LENGTH = 160;

/** Lowercase alphanumeric groups joined by single hyphens. */
export const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Namespace used as the last-resort slug. Reserved so that no user-supplied
 * slug can ever collide with a generated fallback.
 */
export const RESERVED_SLUG_NAMESPACE_PREFIX = "organization-id-";
export const RESERVED_SLUG_NAMESPACE_PATTERN = /^organization-id-[a-f0-9]{32}$/;

/**
 * Slugs that would shadow a sibling frontend route under /organizations/.
 *
 * Backend resource routes are UUID-only and slug resolution lives on its own
 * `/organizations/by-slug/:slug` path, so this list only has to protect the
 * Next.js route segments that sit beside /organizations/[reference].
 *
 * Any new literal segment added under `frontend/src/app/organizations/` must be
 * added here. `organization-slug.reserved.test.ts` enforces that.
 */
export const RESERVED_ORGANIZATION_SLUGS: ReadonlySet<string> = new Set([
  // Real sibling routes.
  "invitations",
  "by-slug",
  // Defensive: common future segments and literal strings a buggy client may send.
  "me",
  "new",
  "null",
  "undefined",
]);

export function looksLikeUuid(value: string): boolean {
  return isUuid(value);
}

export function isReservedOrganizationSlug(value: string): boolean {
  return (
    RESERVED_ORGANIZATION_SLUGS.has(value) ||
    RESERVED_SLUG_NAMESPACE_PATTERN.test(value)
  );
}

/**
 * The slug used when every generated candidate keeps colliding. Derived from
 * the organization id, so it is unique by construction and lives in a namespace
 * users cannot type.
 */
export function reservedNamespaceSlug(organizationId: Uuid): string {
  return `${RESERVED_SLUG_NAMESPACE_PREFIX}${organizationId.replace(/-/g, "").toLowerCase()}`;
}

export function slugify(
  source: string,
  options: { maxLength: number; fallback: string },
): string {
  const slug = source
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, options.maxLength)
    .replace(/-+$/g, "");

  return slug || options.fallback;
}

/**
 * Append a suffix while keeping the result within `maxLength`.
 *
 * Naively concatenating overflows whenever the base is already at the limit:
 * a 160-character base plus "-2" is 162 characters and fails to insert. The
 * base is truncated by the suffix length first so the suffix always survives.
 */
export function withSuffix(
  base: string,
  suffix: string,
  maxLength: number,
): string {
  const availableBaseLength = Math.max(0, maxLength - suffix.length);

  return `${base.slice(0, availableBaseLength).replace(/-+$/g, "")}${suffix}`;
}

/**
 * Candidate for the nth attempt: the bare base first, then -2, -3, and so on.
 *
 * Always route-safe, so a caller looping over candidates cannot land on one the
 * slug route would refuse to resolve.
 */
export function nextSlugCandidate(
  base: string,
  attempt: number,
  maxLength: number,
): string {
  const candidate =
    attempt === 0
      ? base.slice(0, maxLength)
      : withSuffix(base, `-${attempt + 1}`, maxLength);

  return toRouteSafeSlug(candidate, maxLength);
}

/**
 * Short, stable, readable disambiguator. Preferred over a timestamp suffix,
 * which produces slugs like `harbor-rentals-1785192987123`.
 */
export function generateShortSlugSuffix(): string {
  return randomBytes(3).toString("hex");
}

/**
 * Force a generated slug to satisfy every rule the slug *route* enforces.
 *
 * slugify() only guarantees the character set. Anything that generates a slug
 * without asking a human -- organization creation, the seed fixtures, the
 * migration backfill -- must also clear the minimum length, the reserved list,
 * and the UUID shape, or it hands the organization a public URL that
 * `organizationSlugPathSchema` rejects and that therefore cannot resolve at all.
 *
 * Keep in sync with `canonicalOrganizationSlugSchema` in organizations.model.ts,
 * and with the equivalent steps in the organization slug migration.
 */
export function toRouteSafeSlug(
  slug: string,
  maxLength = ORGANIZATION_SLUG_MAX_LENGTH,
): string {
  let safe = slug.slice(0, maxLength).replace(/-+$/g, "");

  // A UUID-shaped slug would be read as an organization id instead.
  if (looksLikeUuid(safe)) {
    safe = `org-${safe}`.slice(0, maxLength).replace(/-+$/g, "");
  }

  // Reserved segments would shadow a sibling route under /organizations/.
  if (isReservedOrganizationSlug(safe)) {
    safe = withSuffix(safe, "-org", maxLength);
  }

  // A single character is below the route's minimum, e.g. an organization
  // literally named "A".
  if (safe.length < ORGANIZATION_SLUG_MIN_LENGTH) {
    safe = `${safe}-org`;
  }

  return safe;
}

/**
 * Find a free slug by probing `isTaken`.
 *
 * Callers that can write through a unique index should prefer an
 * insert-and-retry-on-conflict loop instead: probing is inherently racy, and
 * only the database constraint is authoritative.
 */
export async function resolveUniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
  options: {
    maxLength: number;
    maxAttempts: number;
    buildFallback: (base: string) => string;
  },
): Promise<string> {
  for (let attempt = 0; attempt < options.maxAttempts; attempt += 1) {
    const candidate = nextSlugCandidate(base, attempt, options.maxLength);

    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  return options.buildFallback(base);
}
