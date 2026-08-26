import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  publicSearchPostingsFilterShape,
  refinePublicSearchPostingsFilters,
  searchAttributeFiltersSchema,
  type PublicPostingRecord,
  type SearchAttributeFilterInput,
  type SearchPostingsInput,
} from "@/features/postings/postings.model";

/**
 * A visitor with hundreds of saved searches would turn every sweep into a
 * scan, and nobody curates that many by hand. The cap is generous enough that
 * hitting it signals misuse rather than enthusiasm.
 */
export const MAX_SAVED_SEARCHES_PER_USER = 20;

/**
 * How many already-alerted postings a search remembers. Past the cap the
 * oldest are pruned, so a posting that has been matched, forgotten, and
 * matched again can alert twice — acceptable for a search that has already
 * seen 500 distinct matches, and far cheaper than unbounded growth.
 */
export const SAVED_SEARCH_SEEN_CAP = 500;

/** Page size the sweep and the create-time baseline read matches with. */
export const SAVED_SEARCH_SCAN_PAGE_SIZE = 50;

/** Matches named individually in an alert email before it says "and N more". */
export const MAX_ALERT_MATCHES_PER_EMAIL = 10;

export const savedSearchNotifyFrequencySchema = z.enum([
  "instant",
  "daily",
  "off",
]);

export type SavedSearchNotifyFrequency = z.infer<
  typeof savedSearchNotifyFrequencySchema
>;

/**
 * The filter set a saved search stores.
 *
 * Derived from `publicSearchPostingsFilterShape` on purpose: a saved search
 * must never hold a filter the live search cannot execute, and deriving means
 * the two cannot drift as filters are added. `page`, `pageSize` and `sort` are
 * deliberately absent — they are presentation choices, and the sweep picks its
 * own.
 */
export const savedSearchQueryParamsSchema = z
  .object({
    ...publicSearchPostingsFilterShape,
    attributeFilters: searchAttributeFiltersSchema.optional(),
  })
  .strict()
  .superRefine((params, context) => {
    refinePublicSearchPostingsFilters(params, context);

    if (
      params.minDailyPrice !== undefined &&
      params.maxDailyPrice !== undefined &&
      params.minDailyPrice > params.maxDailyPrice
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minDailyPrice"],
        message: "Minimum daily price cannot exceed the maximum daily price.",
      });
    }

    // Attribute filters are defined per family/subtype pair, so a saved search
    // carrying them without both is not executable. The live endpoint enforces
    // the same rule in its service layer.
    if (
      params.attributeFilters?.length &&
      (!params.family || !params.subtype)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attributeFilters"],
        message:
          "Attribute filters require both a family and a subtype to be selected.",
      });
    }

    if (!hasAnyFilter(params)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "A saved search must include at least one filter.",
      });
    }
  });

export type SavedSearchQueryParams = z.infer<
  typeof savedSearchQueryParamsSchema
>;

/**
 * An unfiltered saved search matches the whole marketplace, so every new
 * posting would alert on it. That is a mailing list, not a saved search.
 */
function hasAnyFilter(params: Record<string, unknown>): boolean {
  return Object.values(params).some((value) => {
    if (value === undefined || value === null) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return true;
  });
}

export const savedSearchNameSchema = z.string().trim().min(1).max(120);

export const createSavedSearchSchema = z
  .object({
    name: savedSearchNameSchema.optional(),
    queryParams: savedSearchQueryParamsSchema,
    notifyFrequency: savedSearchNotifyFrequencySchema.default("instant"),
  })
  .strict();

export type CreateSavedSearchRequest = z.infer<typeof createSavedSearchSchema>;

export const updateSavedSearchSchema = z
  .object({
    name: savedSearchNameSchema.optional(),
    notifyFrequency: savedSearchNotifyFrequencySchema.optional(),
  })
  .strict()
  .refine(
    (body) => body.name !== undefined || body.notifyFrequency !== undefined,
    {
      message: "Provide a name or a notification frequency to update.",
    },
  );

export type UpdateSavedSearchRequest = z.infer<typeof updateSavedSearchSchema>;

export const listSavedSearchesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type ListSavedSearchesQuery = z.infer<
  typeof listSavedSearchesQuerySchema
>;

export interface SavedSearchRecord {
  id: string;
  name: string;
  queryParams: SavedSearchQueryParams;
  notifyFrequency: SavedSearchNotifyFrequency;
  /**
   * Matches found since the visitor last opened this search. Reset by the
   * `seen` endpoint rather than by reading the list, so rendering the page
   * does not clear a badge the visitor has not looked at.
   */
  newMatchCount: number;
  lastCheckedAt: string | null;
  lastNotifiedAt: string | null;
  /**
   * Set when the stored filters stopped validating after a search change. The
   * search is kept and shown, but it no longer runs: the visitor is asked to
   * recreate it rather than being alerted from filters nothing can execute.
   */
  invalidated: boolean;
  createdAt: string;
}

export interface SavedSearchesPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListSavedSearchesResult {
  searches: SavedSearchRecord[];
  pagination: SavedSearchesPagination;
  /** Surfaced so the client can render the cap without a second request. */
  limit: number;
}

/** Row shape the worker claims, before the stored params are re-validated. */
export interface DueSavedSearch {
  id: string;
  userId: string;
  name: string;
  queryParams: unknown;
  notifyFrequency: SavedSearchNotifyFrequency;
}

/**
 * Stable, key-sorted projection of the filters, with array members sorted and
 * empty values dropped.
 *
 * Two searches that differ only in the order the visitor filled the form must
 * hash the same, or the duplicate guard is trivially defeated. Sorting arrays
 * is safe because every array filter here is a set: tags are conjunctive and
 * attribute filters are keyed.
 */
export function canonicalizeSavedSearchParams(
  params: SavedSearchQueryParams,
): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};

  for (const key of Object.keys(params).sort()) {
    const value = (params as Record<string, unknown>)[key];

    if (value === undefined || value === null) {
      continue;
    }

    if (key === "tags" && Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }

      canonical[key] = [...(value as string[])].sort();
      continue;
    }

    if (key === "attributeFilters" && Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }

      canonical[key] = canonicalizeAttributeFilters(
        value as SearchAttributeFilterInput[],
      );
      continue;
    }

    canonical[key] = value;
  }

  return canonical;
}

function canonicalizeAttributeFilters(
  filters: SearchAttributeFilterInput[],
): Record<string, unknown>[] {
  return filters
    .map((filter) => {
      const canonical: Record<string, unknown> = { key: filter.key };

      if (Array.isArray(filter.value)) {
        canonical.value = [...filter.value].sort();
      } else if (filter.value !== undefined) {
        canonical.value = filter.value;
      }

      if (filter.min !== undefined) {
        canonical.min = filter.min;
      }

      if (filter.max !== undefined) {
        canonical.max = filter.max;
      }

      return canonical;
    })
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

export function hashSavedSearchParams(params: SavedSearchQueryParams): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeSavedSearchParams(params)))
    .digest("hex");
}

const FAMILY_LABELS: Record<string, string> = {
  place: "Places",
  equipment: "Equipment",
  vehicle: "Vehicles",
};

/**
 * Default name for a search the visitor did not name, built from the filters
 * that most identify it.
 *
 * A list of rows all called "Saved search" is unusable, and demanding a name
 * before saving adds a step at the one moment the visitor is most likely to
 * abandon the flow.
 */
export function deriveSavedSearchName(params: SavedSearchQueryParams): string {
  const parts: string[] = [];

  if (params.q) {
    parts.push(params.q);
  }

  if (params.family) {
    parts.push(FAMILY_LABELS[params.family] ?? params.family);
  }

  if (params.tags?.length) {
    parts.push(params.tags.slice(0, 3).join(", "));
  }

  if (params.organization) {
    parts.push(`by ${params.organization}`);
  }

  if (params.maxDailyPrice !== undefined) {
    parts.push(`under $${params.maxDailyPrice}/day`);
  } else if (params.minDailyPrice !== undefined) {
    parts.push(`from $${params.minDailyPrice}/day`);
  }

  if (params.radiusKm !== undefined) {
    parts.push(`within ${params.radiusKm}km`);
  }

  if (parts.length === 0) {
    // Reachable only through filters with no natural label of their own, such
    // as an availability window on its own.
    parts.push("All postings");
  }

  return parts.join(" · ").slice(0, 120);
}

/**
 * Maps a stored row onto the API record.
 *
 * `queryParams` is re-parsed rather than cast: the column is JSON, so nothing
 * in the type system guarantees a row written before a filter change still
 * matches the current shape. A row that fails to parse is reported as
 * invalidated with its filters emptied, which is what the sweep does too.
 */
export function toSavedSearchRecord(row: {
  id: string;
  name: string;
  queryParams: unknown;
  notifyFrequency: SavedSearchNotifyFrequency;
  newMatchCount: number;
  lastCheckedAt: Date | null;
  lastNotifiedAt: Date | null;
  invalidatedAt: Date | null;
  createdAt: Date;
}): SavedSearchRecord {
  const parsed = savedSearchQueryParamsSchema.safeParse(row.queryParams);

  return {
    id: row.id,
    name: row.name,
    queryParams: parsed.success ? parsed.data : ({} as SavedSearchQueryParams),
    notifyFrequency: row.notifyFrequency,
    newMatchCount: row.newMatchCount,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastNotifiedAt: row.lastNotifiedAt?.toISOString() ?? null,
    invalidated: row.invalidatedAt !== null || !parsed.success,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Turns stored filters back into the input the live search takes.
 *
 * Both the create-time baseline and the sweep go through here, so a saved
 * search is always executed exactly the way the browse page would execute it.
 * `sort` is fixed to `newest`: the sweep cares about what appeared, not what
 * ranks best, and relevance ordering would bury a new match behind established
 * ones once the result set outgrows a single page.
 */
export function toSearchPostingsInput(
  params: SavedSearchQueryParams,
  page: number,
  pageSize: number,
): SearchPostingsInput {
  const {
    latitude,
    longitude,
    radiusKm,
    startAt,
    endAt,
    q,
    organization,
    ...rest
  } = params;

  return {
    ...rest,
    page,
    pageSize,
    sort: "newest",
    ...(q ? { query: q } : {}),
    ...(organization ? { organizationQuery: organization } : {}),
    ...(latitude !== undefined && longitude !== undefined
      ? {
          geo: {
            latitude,
            longitude,
            ...(radiusKm !== undefined ? { radiusKm } : {}),
          },
        }
      : {}),
    ...(startAt && endAt ? { availabilityWindow: { startAt, endAt } } : {}),
  };
}

/**
 * Rebuilds the browse-page query string from stored filters, so an alert email
 * can link the visitor straight back to the live results rather than to a bare
 * search page they would have to fill in again.
 *
 * Arrays repeat their key and `attr.*` filters are re-expanded, matching how
 * the search endpoint parses them.
 */
export function buildSavedSearchQueryString(
  params: SavedSearchQueryParams,
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (key === "attributeFilters") {
      for (const filter of value as SearchAttributeFilterInput[]) {
        if (Array.isArray(filter.value)) {
          for (const entry of filter.value) {
            search.append(`attr.${filter.key}`, String(entry));
          }
        } else if (filter.value !== undefined) {
          search.append(`attr.${filter.key}`, String(filter.value));
        }

        if (filter.min !== undefined) {
          search.append(`attr.${filter.key}.min`, String(filter.min));
        }

        if (filter.max !== undefined) {
          search.append(`attr.${filter.key}.max`, String(filter.max));
        }
      }

      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        search.append(key, String(entry));
      }

      continue;
    }

    search.append(key, String(value));
  }

  return search.toString();
}

export interface SavedSearchMatchPreview {
  id: string;
  name: string;
  dailyPrice: number;
  currency: string;
  organizationName: string | null;
}

/** Trims a hydrated posting down to what an alert email actually renders. */
export function toSavedSearchMatchPreview(
  posting: PublicPostingRecord,
): SavedSearchMatchPreview {
  return {
    id: posting.id,
    name: posting.name,
    dailyPrice: posting.pricing.daily.amount,
    currency: posting.pricing.currency,
    organizationName: posting.organization?.name ?? null,
  };
}
