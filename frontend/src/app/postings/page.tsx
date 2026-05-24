import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarRange,
  Compass,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tags,
} from "lucide-react";
import { PostingSearchForm } from "@/components/postings/posting-search-form";
import {
  PublicPostingSearchError,
  searchPublicPostings,
  type PostingSort,
  type PublicPostingSearchParams,
  type PublicPostingSearchResult,
} from "@/lib/postings/search";
import {
  formatPostingPrice,
  formatPublishedDate,
  humanizePostingValue,
  isRenderablePreviewImageUrl,
} from "@/lib/postings/public-format";
import { AvailabilityBadge } from "@/components/postings/availability-badge";
import { PostingAutocompleteInput } from "@/components/postings/posting-autocomplete-input";
import { theme } from "@/styles/theme";

export const metadata: Metadata = {
  title: "Browse Postings | Rentify",
  description: "Search and browse published postings on Rentify.",
};

const sortOptions: Array<{ value: PostingSort; label: string }> = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "dailyPrice", label: "Lowest price" },
  { value: "nearest", label: "Nearest (requires location)" },
  { value: "nameAsc", label: "Name A-Z" },
  { value: "nameDesc", label: "Name Z-A" },
];

const pageSizeOptions = [10, 20, 50] as const;

const familyOptions = ["place", "equipment", "vehicle"] as const;

const subtypeOptions = [
  "entire_place",
  "private_room",
  "shared_room",
  "workspace",
  "storage_space",
  "tool",
  "camera",
  "audio",
  "event_equipment",
  "sports_outdoor",
  "general_equipment",
  "car",
  "truck_van",
  "bike",
  "motorcycle",
  "trailer",
  "general_vehicle",
] as const;

const availabilityStatusOptions = ["available", "limited", "unavailable"] as const;

interface PostingsPageProps {
  searchParams?: Promise<{
    q?: string | string[];
    sort?: string | string[];
    page?: string | string[];
    pageSize?: string | string[];
    family?: string | string[];
    subtype?: string | string[];
    tags?: string | string[];
    availabilityStatus?: string | string[];
    minDailyPrice?: string | string[];
    maxDailyPrice?: string | string[];
    latitude?: string | string[];
    longitude?: string | string[];
    radiusKm?: string | string[];
    startAt?: string | string[];
    endAt?: string | string[];
  }>;
}

interface SearchDebugState {
  requestUrl: string;
  params: PublicPostingSearchParams;
  status?: number;
  statusText?: string;
  responseBody?: unknown;
  causeMessage?: string;
}

function readSingleParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readArrayParam(value?: string | string[]): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isPostingSort(value: string | undefined): value is PostingSort {
  return sortOptions.some((option) => option.value === value);
}

function buildSearchHref(
  input: PublicPostingSearchParams & { page: number; pageSize: number; sort: PostingSort },
): string {
  const searchParams = new URLSearchParams();

  if (input.q) searchParams.set("q", input.q);
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
  if (input.availabilityStatus) searchParams.set("availabilityStatus", input.availabilityStatus);
  if (input.minDailyPrice !== undefined) {
    searchParams.set("minDailyPrice", String(input.minDailyPrice));
  }
  if (input.maxDailyPrice !== undefined) {
    searchParams.set("maxDailyPrice", String(input.maxDailyPrice));
  }
  if (input.latitude !== undefined) searchParams.set("latitude", String(input.latitude));
  if (input.longitude !== undefined) searchParams.set("longitude", String(input.longitude));
  if (input.radiusKm !== undefined) searchParams.set("radiusKm", String(input.radiusKm));
  if (input.startAt) searchParams.set("startAt", input.startAt);
  if (input.endAt) searchParams.set("endAt", input.endAt);

  return `/postings?${searchParams.toString()}`;
}

function resolveErrorDetails(
  message: string,
  debug: SearchDebugState | null,
): { title: string; description: string } {
  const isNetworkFailure = debug?.causeMessage?.toLowerCase().includes("fetch failed");

  if (isNetworkFailure) {
    return {
      title: "Could not reach the search server",
      description:
        "The API server is unreachable. Check that the backend is running and that INTERNAL_API_BASE_URL is configured correctly.",
    };
  }

  if (debug?.status === 400) {
    return {
      title: "Invalid search request",
      description:
        "One or more filter values were rejected by the server. Review your filters and try again.",
    };
  }

  if (debug?.status !== undefined && debug.status >= 500) {
    return {
      title: "Search server error",
      description: `The server returned ${debug.status} ${debug.statusText ?? ""}. This is likely temporary - try again in a moment.`.trim(),
    };
  }

  if (debug?.status !== undefined) {
    return {
      title: `Unexpected response (${debug.status})`,
      description: message,
    };
  }

  return {
    title: "Unable to load postings",
    description: message,
  };
}

const inputClass = theme.marketplace.input;

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${theme.marketplace.chip} ${active ? theme.marketplace.chipActive : ""}`}
    >
      {children}
    </Link>
  );
}

function FilterPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className={theme.marketplace.filterPanel}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>

      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ActiveFilters({
  q,
  family,
  subtype,
  tags,
  availabilityStatus,
  minDailyPrice,
  maxDailyPrice,
  latitude,
  longitude,
  radiusKm,
  startAt,
  endAt,
}: {
  q: string;
  family?: string;
  subtype?: string;
  tags?: string[];
  availabilityStatus?: string;
  minDailyPrice?: number;
  maxDailyPrice?: number;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  startAt?: string;
  endAt?: string;
}) {
  const filters: string[] = [];

  if (q) filters.push(`Search: ${q}`);
  if (family) filters.push(humanizePostingValue(family));
  if (subtype) filters.push(humanizePostingValue(subtype));
  if (availabilityStatus) filters.push(humanizePostingValue(availabilityStatus));
  if (minDailyPrice !== undefined || maxDailyPrice !== undefined) {
    filters.push(
      `Price: ${minDailyPrice ?? 0} - ${maxDailyPrice !== undefined ? maxDailyPrice : "Any"}`,
    );
  }
  if (tags && tags.length > 0) filters.push(`Tags: ${tags.join(", ")}`);
  if (latitude !== undefined && longitude !== undefined) {
    filters.push(`Near ${latitude}, ${longitude}${radiusKm ? ` within ${radiusKm} km` : ""}`);
  }
  if (startAt || endAt) filters.push("Date window");

  if (filters.length === 0) {
    return (
      <div className={theme.marketplace.summaryEmpty}>
        No filters applied. Try searching broadly, then refine the results.
      </div>
    );
  }

  return (
    <div className={theme.marketplace.summary}>
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {filters.length} active
      </span>

      {filters.map((filter) => (
        <span key={filter} className={theme.marketplace.summaryPill}>
          {filter}
        </span>
      ))}

      <Link
        href="/postings"
        className="ml-auto text-xs font-semibold text-violet-700 transition duration-200 hover:text-violet-800"
      >
        Clear
      </Link>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className={theme.marketplace.fieldLabel}>
        {label}
      </label>
      {children}
      {hint ? <p className={theme.marketplace.fieldHint}>{hint}</p> : null}
    </div>
  );
}

export default async function PostingsPage({ searchParams }: PostingsPageProps) {
  const resolvedSearchParams = await searchParams;
  const q = readSingleParam(resolvedSearchParams?.q)?.trim() || "";
  const sortValue = readSingleParam(resolvedSearchParams?.sort);
  const sort = isPostingSort(sortValue) ? sortValue : "relevance";
  const page = readPositiveNumber(readSingleParam(resolvedSearchParams?.page), 1);
  const requestedPageSize = readPositiveNumber(
    readSingleParam(resolvedSearchParams?.pageSize),
    20,
  );
  const pageSize = pageSizeOptions.includes(requestedPageSize as (typeof pageSizeOptions)[number])
    ? requestedPageSize
    : 20;

  const familyRaw = readSingleParam(resolvedSearchParams?.family);
  const family = familyOptions.includes(familyRaw as (typeof familyOptions)[number])
    ? (familyRaw as (typeof familyOptions)[number])
    : undefined;

  const subtypeRaw = readSingleParam(resolvedSearchParams?.subtype);
  const subtype = subtypeOptions.includes(subtypeRaw as (typeof subtypeOptions)[number])
    ? (subtypeRaw as (typeof subtypeOptions)[number])
    : undefined;

  const tags = (() => {
    const values = readArrayParam(resolvedSearchParams?.tags);
    return values.length > 0 ? values : undefined;
  })();

  const availabilityStatusRaw = readSingleParam(resolvedSearchParams?.availabilityStatus);
  const availabilityStatus = availabilityStatusOptions.includes(
    availabilityStatusRaw as (typeof availabilityStatusOptions)[number],
  )
    ? (availabilityStatusRaw as (typeof availabilityStatusOptions)[number])
    : undefined;

  const minDailyPrice = parseOptionalNumber(readSingleParam(resolvedSearchParams?.minDailyPrice));
  const maxDailyPrice = parseOptionalNumber(readSingleParam(resolvedSearchParams?.maxDailyPrice));
  const latitude = parseOptionalNumber(readSingleParam(resolvedSearchParams?.latitude));
  const longitude = parseOptionalNumber(readSingleParam(resolvedSearchParams?.longitude));
  const radiusKm = parseOptionalNumber(readSingleParam(resolvedSearchParams?.radiusKm));

  const startAt = readSingleParam(resolvedSearchParams?.startAt) || undefined;
  const endAt = readSingleParam(resolvedSearchParams?.endAt) || undefined;

  let result: PublicPostingSearchResult | null = null;
  let errorMessage: string | null = null;
  let debugState: SearchDebugState | null = null;

  try {
    result = await searchPublicPostings({
      q: q || undefined,
      sort,
      page,
      pageSize,
      family,
      subtype,
      tags: tags && tags.length > 0 ? tags : undefined,
      availabilityStatus,
      minDailyPrice,
      maxDailyPrice,
      latitude,
      longitude,
      radiusKm,
      startAt,
      endAt,
    });
  } catch (error) {
    if (error instanceof PublicPostingSearchError) {
      errorMessage = error.message;
      debugState = error.debug;
    } else {
      errorMessage = error instanceof Error ? error.message : "Unable to load postings right now.";
    }
  }

  const paginationProps = {
    q: q || undefined,
    sort,
    pageSize,
    family,
    subtype,
    tags: tags && tags.length > 0 ? tags : undefined,
    availabilityStatus,
    minDailyPrice,
    maxDailyPrice,
    latitude,
    longitude,
    radiusKm,
    startAt,
    endAt,
  };

  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.orbPrimary} aria-hidden="true" />
      <div className={theme.marketplace.orbSecondary} aria-hidden="true" />

      <div className={theme.marketplace.container}>
        <section className={theme.marketplace.heroShell}>
          <div className={theme.marketplace.heroHeader}>
            <div className={theme.marketplace.heroGrid}>
              <div>
                <p className={theme.marketplace.eyebrow}>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Rentify marketplace
                </p>
                <h1 className={theme.marketplace.title}>
                  Find the right rental without the clutter.
                </h1>
                <p className={theme.marketplace.description}>
                  Search by keyword, tag, family, availability, price, dates, or location and
                  refine the results in one polished flow.
                </p>
              </div>

              <div className={theme.marketplace.utilityList}>
                <div className={theme.marketplace.utilityCard}>
                  <p className={theme.marketplace.utilityLabel}>Search with less friction</p>
                  <p className={theme.marketplace.utilityDescription}>
                    Start broad, then tighten results with smarter filters.
                  </p>
                </div>
                <div className={theme.marketplace.utilityCard}>
                  <p className={theme.marketplace.utilityLabel}>Date-aware filters</p>
                  <p className={theme.marketplace.utilityDescription}>
                    Narrow by availability windows before you reach out.
                  </p>
                </div>
                <div className={theme.marketplace.utilityCard}>
                  <p className={theme.marketplace.utilityLabel}>Built for variety</p>
                  <p className={theme.marketplace.utilityDescription}>
                    Browse places, equipment, and vehicles from one consistent search experience.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className={theme.marketplace.searchBody}>
            <PostingSearchForm
              className="flex flex-col gap-5"
              initialStartAt={startAt}
              initialEndAt={endAt}
            >
              <input type="hidden" name="page" value="1" />
              {family ? <input type="hidden" name="family" value={family} /> : null}

              <div className={theme.marketplace.primarySearchShell}>
                <div className={theme.marketplace.primarySearchGrid}>
                  <PostingAutocompleteInput
                    id="q"
                    label="Search postings"
                    initialValue={q}
                    family={family}
                    subtype={subtype}
                    placeholder="Search cameras, private rooms, bikes, tools..."
                    shellClassName={theme.marketplace.primaryInputWrap}
                    icon={
                      <Search
                        className={`h-5 w-5 ${theme.marketplace.primaryInputIcon}`}
                        aria-hidden="true"
                      />
                    }
                    inputClassName={theme.marketplace.primaryInput}
                    dropdownClassName={theme.marketplace.autocompleteDropdown}
                    optionClassName={theme.marketplace.autocompleteOption}
                    optionActiveClassName={theme.marketplace.autocompleteOptionActive}
                    loadingClassName={theme.marketplace.autocompleteLoading}
                  />

                  <button type="submit" className={theme.marketplace.primaryButton}>
                    Search
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <FilterChip
                    href={buildSearchHref({
                      ...paginationProps,
                      family: undefined,
                      subtype: undefined,
                      page: 1,
                      pageSize,
                      sort,
                    })}
                    active={!family}
                  >
                    All
                  </FilterChip>

                  {familyOptions.map((option) => (
                    <FilterChip
                      key={option}
                      href={buildSearchHref({
                        ...paginationProps,
                        family: option,
                        subtype: undefined,
                        page: 1,
                        pageSize,
                        sort,
                      })}
                      active={family === option}
                    >
                      {humanizePostingValue(option)}
                    </FilterChip>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className={theme.marketplace.utilityCard}>
                  <div className="flex items-start gap-3">
                    <SlidersHorizontal
                      className="mt-0.5 h-4 w-4 text-violet-600"
                      aria-hidden="true"
                    />
                    <div>
                      <p className={theme.marketplace.utilityLabel}>Refine as you go</p>
                      <p className={theme.marketplace.utilityDescription}>
                        Keep ranking, availability, and page size right beside the main query.
                      </p>
                    </div>
                  </div>
                </div>

                <div className={theme.marketplace.utilityCard}>
                  <div className="flex items-start gap-3">
                    <Compass className="mt-0.5 h-4 w-4 text-violet-600" aria-hidden="true" />
                    <div>
                      <p className={theme.marketplace.utilityLabel}>Search nearby</p>
                      <p className={theme.marketplace.utilityDescription}>
                        Use distance filters only when location precision actually matters.
                      </p>
                    </div>
                  </div>
                </div>

                <div className={theme.marketplace.utilityCard}>
                  <div className="flex items-start gap-3">
                    <CalendarRange
                      className="mt-0.5 h-4 w-4 text-violet-600"
                      aria-hidden="true"
                    />
                    <div>
                      <p className={theme.marketplace.utilityLabel}>Filter by timing</p>
                      <p className={theme.marketplace.utilityDescription}>
                        Availability dates help narrow results before you commit to outreach.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <ActiveFilters
                q={q}
                family={family}
                subtype={subtype}
                tags={tags}
                availabilityStatus={availabilityStatus}
                minDailyPrice={minDailyPrice}
                maxDailyPrice={maxDailyPrice}
                latitude={latitude}
                longitude={longitude}
                radiusKm={radiusKm}
                startAt={startAt}
                endAt={endAt}
              />

              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Sort results" htmlFor="sort" hint="Choose how results are ranked.">
                  <select id="sort" name="sort" defaultValue={sort} className={inputClass}>
                    {sortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Availability"
                  htmlFor="availabilityStatus"
                  hint="Hide unavailable listings."
                >
                  <select
                    id="availabilityStatus"
                    name="availabilityStatus"
                    defaultValue={availabilityStatus ?? ""}
                    className={inputClass}
                  >
                    <option value="">Any availability</option>
                    {availabilityStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {humanizePostingValue(status)}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Results per page"
                  htmlFor="pageSize"
                  hint="Controls how many listings appear."
                >
                  <select
                    id="pageSize"
                    name="pageSize"
                    defaultValue={String(pageSize)}
                    className={inputClass}
                  >
                    {pageSizeOptions.map((count) => (
                      <option key={count} value={count}>
                        {count} results
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <details className={theme.marketplace.advancedShell}>
                <summary className={theme.marketplace.advancedSummary}>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Advanced filters</p>
                    <p className="text-xs text-slate-500">
                      Price, subtype, tags, distance, and availability dates.
                    </p>
                  </div>
                  <span className={`${theme.marketplace.advancedToggle} group-open:hidden`}>
                    Show
                  </span>
                  <span className={`hidden ${theme.marketplace.advancedToggle} group-open:inline`}>
                    Hide
                  </span>
                </summary>

                <div className="border-t border-slate-200 p-4 sm:p-5">
                  <div className="grid gap-5 lg:grid-cols-2">
                    <FilterPanel
                      title="What are you renting?"
                      description="Use subtype and tags when the search text is not specific enough."
                    >
                      <Field label="Subtype" htmlFor="subtype">
                        <select
                          id="subtype"
                          name="subtype"
                          defaultValue={subtype ?? ""}
                          className={inputClass}
                        >
                          <option value="">Any subtype</option>
                          {subtypeOptions.map((entry) => (
                            <option key={entry} value={entry}>
                              {humanizePostingValue(entry)}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field
                        label="Tags"
                        htmlFor="tags"
                        hint="Separate tags with commas, like wifi, pet-friendly."
                      >
                        <div className="relative">
                          <Tags
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                            aria-hidden="true"
                          />
                          <input
                            id="tags"
                            type="text"
                            name="tags"
                            defaultValue={tags ? tags.join(", ") : ""}
                            placeholder="wifi, pet-friendly, tripod"
                            className={`${inputClass} pl-9`}
                          />
                        </div>
                      </Field>
                    </FilterPanel>

                    <FilterPanel
                      title="Budget"
                      description="Set a daily price range to avoid listings outside your budget."
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Min daily price" htmlFor="minDailyPrice">
                          <input
                            id="minDailyPrice"
                            type="number"
                            name="minDailyPrice"
                            defaultValue={minDailyPrice ?? ""}
                            placeholder="$0"
                            min={0}
                            className={inputClass}
                          />
                        </Field>

                        <Field label="Max daily price" htmlFor="maxDailyPrice">
                          <input
                            id="maxDailyPrice"
                            type="number"
                            name="maxDailyPrice"
                            defaultValue={maxDailyPrice ?? ""}
                            placeholder="No limit"
                            min={0}
                            className={inputClass}
                          />
                        </Field>
                      </div>
                    </FilterPanel>

                    <FilterPanel
                      title="Nearby search"
                      description="Use coordinates only when you want results near a specific area."
                    >
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Latitude" htmlFor="latitude">
                          <input
                            id="latitude"
                            type="number"
                            name="latitude"
                            defaultValue={latitude ?? ""}
                            placeholder="43.6532"
                            step="any"
                            min={-90}
                            max={90}
                            className={inputClass}
                          />
                        </Field>

                        <Field label="Longitude" htmlFor="longitude">
                          <input
                            id="longitude"
                            type="number"
                            name="longitude"
                            defaultValue={longitude ?? ""}
                            placeholder="-79.3832"
                            step="any"
                            min={-180}
                            max={180}
                            className={inputClass}
                          />
                        </Field>

                        <Field label="Radius" htmlFor="radiusKm">
                          <input
                            id="radiusKm"
                            type="number"
                            name="radiusKm"
                            defaultValue={radiusKm ?? ""}
                            placeholder="25 km"
                            min={0}
                            className={inputClass}
                          />
                        </Field>
                      </div>
                    </FilterPanel>

                    <FilterPanel
                      title="Availability dates"
                      description="Filter to listings available during the renter's preferred window."
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Start date" htmlFor="startAt">
                          <input
                            id="startAt"
                            type="datetime-local"
                            name="startAt"
                            defaultValue=""
                            className={inputClass}
                          />
                        </Field>

                        <Field label="End date" htmlFor="endAt">
                          <input
                            id="endAt"
                            type="datetime-local"
                            name="endAt"
                            defaultValue=""
                            className={inputClass}
                          />
                        </Field>
                      </div>
                    </FilterPanel>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                    <Link
                      href="/postings"
                      className="text-sm font-medium text-violet-700 transition duration-200 hover:text-violet-800"
                    >
                      Reset all filters
                    </Link>

                    <button type="submit" className={theme.marketplace.primaryButton}>
                      Apply filters
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </details>
            </PostingSearchForm>
          </div>
        </section>

        <section className={theme.marketplace.resultsShell}>
          {errorMessage ? (
            <SearchError message={errorMessage} debug={debugState} />
          ) : result ? (
            <SearchResults
              result={result}
              pageSize={pageSize}
              paginationProps={paginationProps}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function SearchError({
  message,
  debug,
}: {
  message: string;
  debug: SearchDebugState | null;
}) {
  const { title, description } = resolveErrorDetails(message, debug);

  return (
    <div className="space-y-4">
      <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4">
        <p className="font-semibold text-rose-900">{title}</p>
        <p className="mt-1 text-sm text-rose-700">{description}</p>
      </div>

      {debug ? (
        <details className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 text-sm">
          <summary className="cursor-pointer select-none px-4 py-3 font-medium text-slate-700 hover:bg-white">
            Debug details
          </summary>
          <dl className="grid gap-3 border-t border-slate-200 px-4 py-3 text-slate-700">
            <div>
              <dt className="font-medium text-slate-950">Request URL</dt>
              <dd className="mt-0.5 break-all text-slate-600">{debug.requestUrl}</dd>
            </div>
            {debug.status ? (
              <div>
                <dt className="font-medium text-slate-950">HTTP status</dt>
                <dd className="mt-0.5 text-slate-600">
                  {debug.status} {debug.statusText}
                </dd>
              </div>
            ) : null}
            {debug.causeMessage ? (
              <div>
                <dt className="font-medium text-slate-950">Fetch error</dt>
                <dd className="mt-0.5 text-slate-600">{debug.causeMessage}</dd>
              </div>
            ) : null}
            {debug.responseBody !== undefined ? (
              <div>
                <dt className="font-medium text-slate-950">Response body</dt>
                <dd className="mt-0.5">
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs">
                    {JSON.stringify(debug.responseBody, null, 2)}
                  </pre>
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="font-medium text-slate-950">Params sent</dt>
              <dd className="mt-0.5">
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs">
                  {JSON.stringify(debug.params, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function SearchResults({
  result,
  pageSize,
  paginationProps,
}: {
  result: PublicPostingSearchResult;
  pageSize: number;
  paginationProps: Omit<Parameters<typeof buildSearchHref>[0], "page">;
}) {
  const { pagination, postings } = result;
  const rangeStart = (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd = Math.min(pagination.page * pagination.pageSize, pagination.total);

  return (
    <>
      <div className={theme.marketplace.resultsMeta}>
        {pagination.total === 0 ? (
          <span>No results</span>
        ) : (
          <span>
            Showing {rangeStart}-{rangeEnd} of {pagination.total}{" "}
            {pagination.total === 1 ? "posting" : "postings"}
          </span>
        )}
        <span className="text-xs text-slate-400">
          via {result.source} - page {pagination.page} of {pagination.totalPages || 1}
        </span>
      </div>

      {postings.length === 0 ? (
        <p className={theme.marketplace.resultsEmpty}>
          No postings matched your search. Try broadening your filters.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {postings.map((posting) => {
            const publishedDate = formatPublishedDate(posting.publishedAt);
            const previewImageUrl = [posting.primaryThumbnailUrl, posting.primaryPhotoUrl].find(
              isRenderablePreviewImageUrl,
            );

            return (
              <article key={posting.id} className={theme.marketplace.resultCard}>
                <div className="grid gap-0 md:grid-cols-[240px_minmax(0,1fr)]">
                  <div className="relative min-h-48 border-b border-slate-200 bg-slate-100 md:min-h-full md:border-b-0 md:border-r">
                    {previewImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewImageUrl}
                        alt={posting.name}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div className={theme.marketplace.resultFallback}>No Image</div>
                    )}
                  </div>

                  <div className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap gap-2">
                          <span className={theme.marketplace.metaBadge}>
                            {humanizePostingValue(posting.variant.family)}
                          </span>
                          <span className={theme.marketplace.metaBadge}>
                            {humanizePostingValue(posting.variant.subtype)}
                          </span>
                        </div>

                        <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-slate-950">
                          {posting.name}
                        </h2>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <AvailabilityBadge status={posting.availabilityStatus} />
                        <span className="text-lg font-semibold text-slate-950">
                          {formatPostingPrice(posting.pricing.daily.amount, posting.pricing.currency)}
                          <span className="text-xs font-normal text-slate-500"> / day</span>
                        </span>
                      </div>
                    </div>

                    <p className="mt-3 line-clamp-2 text-sm leading-7 text-slate-600">
                      {posting.description}
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
                      <span className={theme.marketplace.metaBadge}>
                        {posting.location.city}, {posting.location.region}, {posting.location.country}
                      </span>
                      {publishedDate ? (
                        <span className={theme.marketplace.metaBadge}>Published {publishedDate}</span>
                      ) : null}
                      <span className={theme.marketplace.metaBadge}>ID: {posting.id}</span>
                    </div>

                    {posting.tags.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {posting.tags.map((tag) => (
                          <span key={tag} className={theme.marketplace.summaryPill}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
                      <p className="text-xs text-slate-500">
                        Review pricing, availability, and listing details.
                      </p>
                      <Link
                        href={`/postings/${posting.id}`}
                        className={theme.marketplace.paginationButton}
                      >
                        View details
                      </Link>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex items-center gap-2">
        {pagination.hasPreviousPage ? (
          <Link
            href={buildSearchHref({ ...paginationProps, page: pagination.page - 1, pageSize })}
            className={theme.marketplace.paginationButton}
          >
            Previous
          </Link>
        ) : (
          <span className={theme.marketplace.paginationButtonDisabled}>Previous</span>
        )}

        {pagination.hasNextPage ? (
          <Link
            href={buildSearchHref({ ...paginationProps, page: pagination.page + 1, pageSize })}
            className={theme.marketplace.paginationButton}
          >
            Next
          </Link>
        ) : (
          <span className={theme.marketplace.paginationButtonDisabled}>Next</span>
        )}
      </div>
    </>
  );
}
