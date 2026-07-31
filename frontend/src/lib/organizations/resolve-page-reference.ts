import { permanentRedirect, redirect } from "next/navigation";
import {
  isCanonicalOrganizationReference,
  organizationHref,
  resolveOrganizationReference,
  type ResolvedOrganizationReference,
} from "@/lib/organizations/urls";

/**
 * Resolve the `[id]` segment of a public organization page and canonicalize the
 * URL.
 *
 * Redirect status is chosen by how the reference matched, because the two cases
 * differ in whether the target can change later:
 *
 * - `uuid` -> 307. The UUID's canonical target moves every time the slug is
 *   edited, so a permanent redirect could be cached pointing at a stale slug.
 * - `alias` / non-canonical form -> 308. Aliases are permanent and never
 *   reused, and a cached alias->slug hop still lands correctly after a later
 *   rename because the intermediate slug itself becomes an alias.
 *
 * Returns `null` when no such organization exists, letting the caller render
 * its own not-found state. Backend failures propagate as errors.
 */
export async function resolveOrganizationPageReference(
  rawReference: string,
  ...trailingSegments: string[]
): Promise<ResolvedOrganizationReference | null> {
  const resolved = await resolveOrganizationReference(rawReference);

  if (!resolved) {
    return null;
  }

  if (isCanonicalOrganizationReference(rawReference, resolved.canonicalSlug)) {
    return resolved;
  }

  const target = organizationHref(resolved.canonicalSlug, ...trailingSegments);

  // Both helpers work by throwing, so neither may sit inside a try/catch.
  if (resolved.matchedBy === "uuid") {
    redirect(target);
  }

  permanentRedirect(target);
}
