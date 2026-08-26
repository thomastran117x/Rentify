import { buildSearchHref } from "@/lib/postings/search-href";
import type { SavedSearchQueryParams } from "@/lib/saved-searches/api";

/**
 * Query parameters that describe *what* to find, as opposed to how to present
 * it. `page`, `pageSize` and `sort` are excluded so that paging through results
 * and then pressing save does not store a different search from the one the
 * visitor was looking at on page one.
 */
const NUMBER_KEYS = [
  "minDailyPrice",
  "maxDailyPrice",
  "latitude",
  "longitude",
  "radiusKm",
  "maxMinBookingDurationDays",
] as const;

const STRING_KEYS = [
  "q",
  "organization",
  "organizationId",
  "family",
  "subtype",
  "availabilityStatus",
  "startAt",
  "endAt",
  "cancellationPolicy",
] as const;

/**
 * Reads the filters out of a browse-page query string.
 *
 * Anything unrecognised is dropped rather than passed through: the backend
 * validates strictly, so forwarding a stray parameter would turn a save into a
 * 400 the visitor cannot act on.
 */
export function readSavedSearchParams(
  searchParams: URLSearchParams,
): SavedSearchQueryParams {
  const params: Record<string, unknown> = {};

  for (const key of STRING_KEYS) {
    const value = searchParams.get(key)?.trim();

    if (value) {
      params[key] = value;
    }
  }

  for (const key of NUMBER_KEYS) {
    const raw = searchParams.get(key);

    if (raw === null || raw.trim() === "") {
      continue;
    }

    const value = Number(raw);

    if (Number.isFinite(value)) {
      params[key] = value;
    }
  }

  const instantBooking = searchParams.get("instantBooking");

  if (instantBooking === "true" || instantBooking === "false") {
    params.instantBooking = instantBooking === "true";
  }

  // Tags arrive either repeated or comma-separated, matching how the filter
  // form and the chip links each build them.
  const tags = searchParams
    .getAll("tags")
    .flatMap((entry) => entry.split(","))
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (tags.length > 0) {
    params.tags = Array.from(new Set(tags));
  }

  return params as SavedSearchQueryParams;
}

/** True when there is something worth saving. An empty search matches everything. */
export function hasSavedSearchFilters(params: SavedSearchQueryParams): boolean {
  return Object.values(params).some((value) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined,
  );
}

/** Link back to the live results for a stored search. */
export function buildSavedSearchHref(params: SavedSearchQueryParams): string {
  return buildSearchHref({
    ...params,
    page: 1,
    pageSize: 20,
    sort: "newest",
  });
}

const FAMILY_LABELS: Record<string, string> = {
  place: "Places",
  equipment: "Equipment",
  vehicle: "Vehicles",
};

const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  limited: "Limited availability",
  unavailable: "Unavailable",
};

function formatDate(value: string): string {
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

/**
 * Human-readable chips describing what a saved search looks for.
 *
 * The stored filters are the only record of what the visitor asked for, and a
 * row showing just a name gives them no way to tell two similar searches apart
 * or to decide whether one is still worth keeping.
 */
export function describeSavedSearchFilters(
  params: SavedSearchQueryParams,
): string[] {
  const chips: string[] = [];

  if (params.q) chips.push(`"${params.q}"`);
  if (params.family) chips.push(FAMILY_LABELS[params.family] ?? params.family);
  if (params.subtype) chips.push(params.subtype.replaceAll("_", " "));
  if (params.organization) chips.push(`by ${params.organization}`);
  if (params.tags?.length) chips.push(params.tags.join(", "));

  if (
    params.minDailyPrice !== undefined &&
    params.maxDailyPrice !== undefined
  ) {
    chips.push(`$${params.minDailyPrice}–$${params.maxDailyPrice}/day`);
  } else if (params.maxDailyPrice !== undefined) {
    chips.push(`under $${params.maxDailyPrice}/day`);
  } else if (params.minDailyPrice !== undefined) {
    chips.push(`from $${params.minDailyPrice}/day`);
  }

  if (params.availabilityStatus) {
    chips.push(
      AVAILABILITY_LABELS[params.availabilityStatus] ??
        params.availabilityStatus,
    );
  }

  if (params.radiusKm !== undefined) {
    chips.push(`within ${params.radiusKm}km`);
  } else if (params.latitude !== undefined) {
    chips.push("near a location");
  }

  if (params.startAt && params.endAt) {
    chips.push(`${formatDate(params.startAt)} – ${formatDate(params.endAt)}`);
  }

  if (params.instantBooking) chips.push("Instant book");
  if (params.cancellationPolicy) {
    chips.push(`${params.cancellationPolicy} cancellation`);
  }
  if (params.maxMinBookingDurationDays !== undefined) {
    chips.push(`min stay ≤ ${params.maxMinBookingDurationDays} days`);
  }

  return chips;
}
