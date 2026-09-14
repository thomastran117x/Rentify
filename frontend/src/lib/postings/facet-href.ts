import {
  buildSearchHref,
  type SearchHrefInput,
} from "@/lib/postings/search-href";

/**
 * Hrefs that turn a value shown on a posting (a tag, its category, a part of
 * its location) into a one-click search filter.
 *
 * Every builder starts from the search the visitor is already looking at, so a
 * click narrows the current results instead of discarding them, and always
 * lands on page one: the old page number rarely exists in a narrower result.
 */
export type FacetSearchBase = Omit<SearchHrefInput, "page">;

export type LocationLevel = "city" | "region" | "country";

export const LOCATION_LEVELS: readonly LocationLevel[] = [
  "city",
  "region",
  "country",
];

/** For pages with no search of their own, such as saved postings or a detail page. */
export const FRESH_SEARCH_BASE: FacetSearchBase = {
  sort: "relevance",
  pageSize: 20,
};

export type FacetLocation = Partial<Record<LocationLevel, string | null>>;

export interface FacetPosting {
  variant: { family: string; subtype: string };
  location: FacetLocation;
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/** Tags match case-insensitively, the same way the search backend compares them. */
export function isTagActive(base: FacetSearchBase, tag: string): boolean {
  const normalized = normalizeTag(tag);

  return (base.tags ?? []).some((entry) => normalizeTag(entry) === normalized);
}

/**
 * Tag filters are conjunctive, so a click adds the tag to the ones already
 * applied. Clicking a tag that is already applied removes it again.
 */
export function buildTagFacetHref(base: FacetSearchBase, tag: string): string {
  const current = base.tags ?? [];
  const normalized = normalizeTag(tag);
  const tags = isTagActive(base, tag)
    ? current.filter((entry) => normalizeTag(entry) !== normalized)
    : [...current, tag];

  return buildSearchHref({ ...base, tags, page: 1 });
}

/** A subtype belongs to one family, so switching family clears the subtype. */
export function buildFamilyFacetHref(
  base: FacetSearchBase,
  family: string,
): string {
  return buildSearchHref({ ...base, family, subtype: undefined, page: 1 });
}

/** Sets the family alongside the subtype so the pair can never disagree. */
export function buildSubtypeFacetHref(
  base: FacetSearchBase,
  variant: FacetPosting["variant"],
): string {
  return buildSearchHref({
    ...base,
    family: variant.family,
    subtype: variant.subtype,
    page: 1,
  });
}

/**
 * Keeps the broader levels above the clicked one, so "London" means the one in
 * the posting's own region and country, and clears the narrower levels below.
 */
export function buildLocationFacetHref(
  base: FacetSearchBase,
  level: LocationLevel,
  location: FacetLocation,
): string {
  return buildSearchHref({
    ...base,
    city: level === "city" ? location.city || undefined : undefined,
    region: level === "country" ? undefined : location.region || undefined,
    country: location.country || undefined,
    page: 1,
  });
}

export interface PostingFacetHrefs {
  tag(tag: string): string;
  isTagActive(tag: string): boolean;
  family(): string;
  subtype(): string;
  location(level: LocationLevel): string;
}

export function buildPostingFacetHrefs(
  base: FacetSearchBase,
  posting: FacetPosting,
): PostingFacetHrefs {
  return {
    tag: (tag) => buildTagFacetHref(base, tag),
    isTagActive: (tag) => isTagActive(base, tag),
    family: () => buildFamilyFacetHref(base, posting.variant.family),
    subtype: () => buildSubtypeFacetHref(base, posting.variant),
    location: (level) => buildLocationFacetHref(base, level, posting.location),
  };
}
