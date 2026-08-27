// Imported from the token module directly, not the package barrel: this file
// is reached from a server component, and the barrel also re-exports the
// "use client" pagination components.
import {
  PAGE_SIZE_TEMPLATE_TOKEN,
  PAGE_TEMPLATE_TOKEN,
} from "@/components/common/pagination/href-template";
import type {
  PostingSort,
  PublicPostingSearchParams,
} from "@/lib/postings/search";

/**
 * `page` and `pageSize` accept a placeholder token so the pagination control
 * can be handed one href template instead of a callback, which a server
 * component cannot pass across the client boundary. Both tokens survive
 * `URLSearchParams.toString()` unescaped.
 *
 * They are `Omit`ed from `PublicPostingSearchParams` rather than intersected,
 * because intersecting the token union with the optional `number` there
 * would collapse straight back to `number`.
 */
export type SearchHrefInput = Omit<
  PublicPostingSearchParams,
  "page" | "pageSize"
> & {
  page: number | typeof PAGE_TEMPLATE_TOKEN;
  pageSize: number | typeof PAGE_SIZE_TEMPLATE_TOKEN;
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
  // No filter form field sets these three yet, but a saved search round-trips
  // through this builder, so leaving them out would quietly drop them from a
  // search the visitor asked to keep.
  if (input.cancellationPolicy)
    searchParams.set("cancellationPolicy", input.cancellationPolicy);
  if (input.instantBooking !== undefined) {
    searchParams.set("instantBooking", String(input.instantBooking));
  }
  if (input.maxMinBookingDurationDays !== undefined) {
    searchParams.set(
      "maxMinBookingDurationDays",
      String(input.maxMinBookingDurationDays),
    );
  }

  return `/postings?${searchParams.toString()}`;
}
