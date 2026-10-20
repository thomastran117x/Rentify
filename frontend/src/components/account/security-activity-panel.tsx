"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Ban,
  CircleX,
  Globe,
  KeyRound,
  RefreshCw,
  Shield,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { isApiClientError } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { securityActivityApi } from "@/lib/security-activity/api";
import {
  activityCacheKey,
  readActivityCache,
  writeActivityCache,
} from "@/lib/security-activity/cache";
import {
  describeDevice,
  formatAbsoluteTime,
  formatRelativeTime,
  isValidDateInput,
  toActivityDateRange,
  todayDateInputValue,
} from "@/lib/security-activity/format";
import type {
  ListSecurityActivityInput,
  SecurityActivityCategory,
  SecurityActivityItem,
  SecurityActivityMethod,
  SecurityActivityOutcome,
} from "@/lib/security-activity/types";

const PAGE_SIZE = 20;

type CategoryFilter = SecurityActivityCategory | "all";

const CATEGORY_FILTERS: Array<{ value: CategoryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "sign_in", label: "Sign-ins" },
  { value: "security_changes", label: "Security changes" },
  { value: "sessions", label: "Sessions" },
];

type OutcomeFilter = SecurityActivityOutcome | "all";

const OUTCOME_FILTERS: Array<{ value: OutcomeFilter; label: string }> = [
  { value: "all", label: "Any status" },
  { value: "success", label: "Succeeded" },
  { value: "failure", label: "Failed" },
  { value: "blocked", label: "Blocked" },
];

/** The first-page request for the current filters; Load more adds a cursor. */
function toListInput(
  category: CategoryFilter,
  outcome: OutcomeFilter,
  fromDate: string,
  toDate: string,
): ListSecurityActivityInput {
  return {
    limit: PAGE_SIZE,
    category: category === "all" ? undefined : category,
    outcome: outcome === "all" ? undefined : outcome,
    ...toActivityDateRange(fromDate, toDate),
  };
}

const METHOD_ICONS: Record<SecurityActivityMethod, LucideIcon> = {
  password: KeyRound,
  google: Globe,
  microsoft: Globe,
  apple: Globe,
  refresh: RefreshCw,
  pat: Terminal,
};

const METHOD_NAMES: Record<SecurityActivityMethod, string> = {
  password: "Password",
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
  refresh: "Session refresh",
  pat: "Personal access token",
};

// Both states share the border so the pill keeps its size, and no state
// animates its background: fading the old pill out of solid black while the
// new one snaps to black reads as a dark box flashing between the two.
const filterPillBaseClass =
  "inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold";
const filterPillSelectedClass =
  "border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950";
const filterPillIdleClass =
  "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";

// Shared by the date inputs and the status select.
const dateInputClass =
  "h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 aria-[invalid=true]:border-rose-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:[color-scheme:dark]";

const secondaryButtonClass =
  "inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";

function rowAppearance(item: SecurityActivityItem): {
  container: string;
  icon: LucideIcon;
  iconClass: string;
  badge?: { text: string; className: string };
} {
  if (item.outcome === "failure") {
    return {
      container:
        "border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30",
      icon: CircleX,
      iconClass:
        "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300",
      badge: {
        text: "Failed",
        className:
          "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300",
      },
    };
  }

  if (item.outcome === "blocked") {
    return {
      container:
        "border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30",
      icon: Ban,
      iconClass:
        "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300",
      badge: {
        text: "Blocked",
        className:
          "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300",
      },
    };
  }

  return {
    container: "border-slate-200 dark:border-slate-800",
    icon: item.method ? METHOD_ICONS[item.method] : Shield,
    iconClass:
      "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
  };
}

export interface SecurityActivityPanelProps {
  /**
   * Scopes the in-memory cache, so another account signed in on the same tab
   * never sees this one's history. Without it nothing is cached.
   */
  userId?: string;
  /**
   * Called when the user reports an event as not theirs. The account page
   * takes them to the password form until self-lock (#378) exists.
   */
  onReportActivity?: (item: SecurityActivityItem) => void;
  /**
   * Called when the session's `mfa-management` step-up has expired. The
   * account page locks the Security tab again so the user can re-verify;
   * without it the panel shows the error with Try again.
   */
  onVerificationRequired?: () => void;
}

function isVerificationRequired(error: unknown): boolean {
  return isApiClientError(error) && error.code === "MFA_VERIFICATION_REQUIRED";
}

interface ActivityFilters {
  category: CategoryFilter;
  outcome: OutcomeFilter;
  fromDate: string;
  toDate: string;
}

const DEFAULT_FILTERS: ActivityFilters = {
  category: "all",
  outcome: "all",
  fromDate: "",
  toDate: "",
};

function rangeErrorFor(filters: ActivityFilters): string | null {
  if (!isValidDateInput(filters.fromDate)) {
    return "Enter a From date between the years 1000 and 9999.";
  }

  if (!isValidDateInput(filters.toDate)) {
    return "Enter a To date between the years 1000 and 9999.";
  }

  // Both are valid YYYY-MM-DD here, so string order is date order.
  return filters.fromDate && filters.toDate && filters.fromDate > filters.toDate
    ? "The To date must be on or after the From date."
    : null;
}

function cacheKeyFor(
  userId: string | undefined,
  filters: ActivityFilters,
): string | null {
  return userId
    ? activityCacheKey(
        userId,
        toListInput(
          filters.category,
          filters.outcome,
          filters.fromDate,
          filters.toDate,
        ),
      )
    : null;
}

export function SecurityActivityPanel({
  userId,
  onReportActivity,
  onVerificationRequired,
}: SecurityActivityPanelProps) {
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const { category, outcome, fromDate, toDate } = filters;
  const [reloadKey, setReloadKey] = useState(0);
  // Returning to the tab shows the cached first page at once rather than a
  // skeleton; the fetch effect then decides whether it needs refreshing.
  const [initialCache] = useState(() => {
    const key = cacheKeyFor(userId, DEFAULT_FILTERS);
    return key ? readActivityCache(key) : null;
  });
  const [items, setItems] = useState<SecurityActivityItem[]>(
    () => initialCache?.list.items ?? [],
  );
  const [nextCursor, setNextCursor] = useState<string | null>(
    () => initialCache?.list.nextCursor ?? null,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() =>
    initialCache ? "ready" : "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // A cached page is on screen and its replacement is being fetched. Load
  // more waits for it: the cached cursor would page from a stale position
  // and the refresh would then replace the page it appended to.
  const [refreshing, setRefreshing] = useState(() => initialCache !== null);
  // Every mount refreshes what the cache showed, even a fresh entry, so
  // anything the user just did elsewhere on the page shows up. Only after
  // that may filter switches within this visit be served from the cache
  // without a request. A ref rather than the first effect run, because
  // StrictMode mounts twice and aborts the first request.
  const revalidatedRef = useRef(false);
  // Kept in a ref so a new callback identity does not re-run the fetch.
  const onVerificationRequiredRef = useRef(onVerificationRequired);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [reportedId, setReportedId] = useState<string | null>(null);
  // Bumped whenever the list restarts, so a "Load more" response for an
  // earlier filter is dropped instead of appended to the new one.
  const generationRef = useRef(0);
  // The cache key whose entry is on screen, if the list came from the cache.
  const shownFromCacheRef = useRef<string | null>(
    initialCache ? cacheKeyFor(userId, DEFAULT_FILTERS) : null,
  );
  const forceReloadRef = useRef(false);
  const rangeError = rangeErrorFor(filters);
  const hasDateRange = Boolean(fromDate || toDate);
  const hasNarrowingFilters = hasDateRange || outcome !== "all";

  /**
   * Applies new filters and restarts the list. A cached first page for them
   * is shown at once; otherwise the list clears to the loading state. The
   * fetch effect below then loads or refreshes it.
   */
  function restart(
    changes: Partial<ActivityFilters>,
    options: { force?: boolean } = {},
  ) {
    const next = { ...filters, ...changes };
    const key = rangeErrorFor(next) ? null : cacheKeyFor(userId, next);
    const cached = key && !options.force ? readActivityCache(key) : null;

    forceReloadRef.current = Boolean(options.force);
    shownFromCacheRef.current = cached ? key : null;
    setErrorMessage(null);
    setLoadMoreError(null);
    setLoadingMore(false);
    setRefreshing(
      cached !== null && (!cached.fresh || !revalidatedRef.current),
    );
    setReportedId(null);
    setItems(cached?.list.items ?? []);
    setNextCursor(cached?.list.nextCursor ?? null);
    setStatus(cached ? "ready" : "loading");
    setFilters(next);
    if (options.force) {
      setReloadKey((value) => value + 1);
    }
  }

  useEffect(() => {
    onVerificationRequiredRef.current = onVerificationRequired;
  }, [onVerificationRequired]);

  /** Hands an expired step-up to the page; false when nobody handles it. */
  function handOffVerification(error: unknown): boolean {
    const handler = onVerificationRequiredRef.current;

    if (!handler || !isVerificationRequired(error)) {
      return false;
    }

    handler();
    return true;
  }

  useEffect(() => {
    const generation = ++generationRef.current;

    if (rangeError) {
      return;
    }

    const input = toListInput(category, outcome, fromDate, toDate);
    const key = userId ? activityCacheKey(userId, input) : null;
    const force = forceReloadRef.current;
    forceReloadRef.current = false;
    const showingCache = key !== null && shownFromCacheRef.current === key;

    if (
      showingCache &&
      !force &&
      revalidatedRef.current &&
      readActivityCache(key)?.fresh
    ) {
      return;
    }

    const controller = new AbortController();

    securityActivityApi
      .listMine(input, controller.signal)
      .then((result) => {
        if (generation !== generationRef.current) {
          return;
        }
        if (key) {
          writeActivityCache(key, result);
        }
        revalidatedRef.current = true;
        shownFromCacheRef.current = null;
        setRefreshing(false);
        setItems(result.items);
        setNextCursor(result.nextCursor);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (generation !== generationRef.current) {
          return;
        }
        revalidatedRef.current = true;
        setRefreshing(false);
        if (handOffVerification(error)) {
          return;
        }
        // A failed background refresh keeps the cached list on screen.
        if (showingCache) {
          return;
        }
        setErrorMessage(
          getApiErrorMessage(error, {
            action: "load your security activity",
            fallback: "Security activity could not be loaded right now.",
          }),
        );
        setStatus("error");
      });

    return () => {
      controller.abort();
    };
  }, [userId, category, outcome, fromDate, toDate, rangeError, reloadKey]);

  async function handleLoadMore() {
    if (!nextCursor || loadingMore || refreshing) {
      return;
    }

    const generation = generationRef.current;
    setLoadingMore(true);
    setLoadMoreError(null);

    try {
      const result = await securityActivityApi.listMine({
        ...toListInput(category, outcome, fromDate, toDate),
        cursor: nextCursor,
      });
      if (generation !== generationRef.current) {
        return;
      }
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...result.items.filter((item) => !seen.has(item.id)),
        ];
      });
      setNextCursor(result.nextCursor);
    } catch (error) {
      if (generation !== generationRef.current || handOffVerification(error)) {
        return;
      }
      setLoadMoreError(
        getApiErrorMessage(error, {
          action: "load more security activity",
          fallback: "More activity could not be loaded right now.",
        }),
      );
    } finally {
      if (generation === generationRef.current) {
        setLoadingMore(false);
      }
    }
  }

  function handleReport(item: SecurityActivityItem) {
    setReportedId(item.id);
    onReportActivity?.(item);
  }

  return (
    <section
      aria-labelledby="security-activity-heading"
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6"
    >
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">
          <Activity className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2
            id="security-activity-heading"
            className="text-lg font-semibold text-slate-950 dark:text-white"
          >
            Security activity
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Recent sign-ins and security changes on your account
          </p>
        </div>
        <button
          type="button"
          onClick={() => restart({}, { force: true })}
          disabled={status === "loading" && !rangeError}
          aria-label="Refresh security activity"
          title="Refresh"
          className={`${secondaryButtonClass} ml-auto shrink-0 px-2`}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div
        role="group"
        aria-label="Filter security activity"
        className="mb-4 flex flex-wrap gap-2"
      >
        {CATEGORY_FILTERS.map((filter) => {
          const selected = filter.value === category;
          return (
            <button
              key={filter.value}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                if (!selected) {
                  restart({ category: filter.value });
                }
              }}
              className={`${filterPillBaseClass} ${
                selected ? filterPillSelectedClass : filterPillIdleClass
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      <div
        role="group"
        aria-label="Filter security activity by status and date"
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          Status
          <select
            value={outcome}
            onChange={(event) =>
              restart({ outcome: event.target.value as OutcomeFilter })
            }
            className={dateInputClass}
          >
            {OUTCOME_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          From
          <input
            type="date"
            value={fromDate}
            max={toDate || todayDateInputValue()}
            onChange={(event) => restart({ fromDate: event.target.value })}
            aria-invalid={Boolean(rangeError)}
            aria-describedby={
              rangeError ? "security-activity-range-error" : undefined
            }
            className={dateInputClass}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          To
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            max={todayDateInputValue()}
            onChange={(event) => restart({ toDate: event.target.value })}
            aria-invalid={Boolean(rangeError)}
            aria-describedby={
              rangeError ? "security-activity-range-error" : undefined
            }
            className={dateInputClass}
          />
        </label>
        {hasDateRange ? (
          <button
            type="button"
            onClick={() => restart({ fromDate: "", toDate: "" })}
            className={secondaryButtonClass}
          >
            Clear dates
          </button>
        ) : null}
      </div>

      {rangeError ? (
        <p
          id="security-activity-range-error"
          role="alert"
          className="rounded-xl border border-dashed border-rose-300 dark:border-rose-800 px-4 py-4 text-sm text-rose-700 dark:text-rose-300"
        >
          {rangeError}
        </p>
      ) : status === "loading" ? (
        <div
          className="grid gap-3"
          role="status"
          aria-label="Loading security activity"
        >
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-16 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800/70"
            />
          ))}
        </div>
      ) : status === "error" ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-rose-300 dark:border-rose-800 px-4 py-4 text-sm text-rose-700 dark:text-rose-300 sm:flex-row sm:items-center sm:justify-between">
          <p role="alert">{errorMessage}</p>
          <button
            type="button"
            onClick={() => restart({}, { force: true })}
            className={secondaryButtonClass}
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-4 text-sm text-slate-500 dark:text-slate-400">
          {hasNarrowingFilters
            ? "No activity matches these filters"
            : "No recent activity"}
        </div>
      ) : (
        <>
          <ul className="grid gap-3" aria-label="Security activity">
            {items.map((item) => {
              const appearance = rowAppearance(item);
              const Icon = appearance.icon;
              return (
                <li
                  key={item.id}
                  data-outcome={item.outcome}
                  className={`rounded-xl border px-4 py-3 ${appearance.container}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${appearance.iconClass}`}
                        title={
                          item.method ? METHOD_NAMES[item.method] : undefined
                        }
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-slate-950 dark:text-white">
                            {item.label}
                          </p>
                          {appearance.badge ? (
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${appearance.badge.className}`}
                            >
                              {appearance.badge.text}
                            </span>
                          ) : null}
                          {item.current ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                              This session
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 break-words text-xs text-slate-500 dark:text-slate-400">
                          <time
                            dateTime={item.occurredAt}
                            title={formatAbsoluteTime(item.occurredAt)}
                          >
                            {formatRelativeTime(item.occurredAt)}
                          </time>
                          {" · "}
                          {describeDevice(item)}
                          {item.ipAddress ? ` · ${item.ipAddress}` : ""}
                        </p>
                      </div>
                    </div>
                    {item.current ? null : (
                      <button
                        type="button"
                        onClick={() => handleReport(item)}
                        className={`${secondaryButtonClass} shrink-0 self-start`}
                      >
                        This wasn&apos;t me
                      </button>
                    )}
                  </div>
                  {reportedId === item.id ? (
                    <p
                      role="status"
                      className="mt-3 rounded-lg bg-white/80 dark:bg-slate-950/60 px-3 py-2 text-xs text-slate-700 dark:text-slate-200"
                    >
                      Change your password now, then remove any registered
                      devices you don&apos;t recognize.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {loadMoreError ? (
            <p
              role="alert"
              className="mt-3 text-sm text-rose-700 dark:text-rose-300"
            >
              {loadMoreError}
            </p>
          ) : null}

          {nextCursor ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => void handleLoadMore()}
                disabled={loadingMore || refreshing}
                className={secondaryButtonClass}
              >
                {refreshing
                  ? "Updating..."
                  : loadingMore
                    ? "Loading..."
                    : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
