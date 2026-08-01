import type {
  PostingSort,
  PublicPostingSearchParams,
} from "@/lib/postings/search";

export type SearchHrefInput = PublicPostingSearchParams & {
  page: number;
  pageSize: number;
  sort: PostingSort;
};

/**
 * The single URL builder behind every filter chip and both pagination links on
 * the browse page.
 *
 * It rebuilds the query string from scratch, so any parameter missing here is
 * silently dropped the moment a visitor changes page or clicks a chip. Every
 * supported search parameter must be represented.
 */
export function buildSearchHref(input: SearchHrefInput): string {
  const searchParams = new URLSearchParams();

  if (input.q) searchParams.set("q", input.q);
  if (input.organization) searchParams.set("organization", input.organization);
  if (input.organizationId)
    searchParams.set("organizationId", input.organizationId);
  searchParams.set("sort", input.sort);
  searchParams.set("page", String(input.page));
  searchParams.set("pageSize", String(input.pageSize));
  if (input.family) searchParams.set("family", input.family);
  if (input.subtype) searchParams.set("subtype", input.subtype);
  if (input.tags && input.tags.length > 0) {
    for (const tag of input.tags) {
      searchParams.append("tags", tag);
    }
  }
  if (input.availabilityStatus)
    searchParams.set("availabilityStatus", input.availabilityStatus);
  if (input.minDailyPrice !== undefined) {
    searchParams.set("minDailyPrice", String(input.minDailyPrice));
  }
  if (input.maxDailyPrice !== undefined) {
    searchParams.set("maxDailyPrice", String(input.maxDailyPrice));
  }
  if (input.latitude !== undefined)
    searchParams.set("latitude", String(input.latitude));
  if (input.longitude !== undefined)
    searchParams.set("longitude", String(input.longitude));
  if (input.radiusKm !== undefined)
    searchParams.set("radiusKm", String(input.radiusKm));
  if (input.startAt) searchParams.set("startAt", input.startAt);
  if (input.endAt) searchParams.set("endAt", input.endAt);

  return `/postings?${searchParams.toString()}`;
}
