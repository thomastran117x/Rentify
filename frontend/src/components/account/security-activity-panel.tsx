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
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { securityActivityApi } from "@/lib/security-activity/api";
import {
  describeDevice,
  formatAbsoluteTime,
  formatRelativeTime,
  toActivityDateRange,
  todayDateInputValue,
} from "@/lib/security-activity/format";
import type {
  SecurityActivityCategory,
  SecurityActivityItem,
  SecurityActivityMethod,
} from "@/lib/security-activity/types";

const PAGE_SIZE = 20;

type CategoryFilter = SecurityActivityCategory | "all";

const CATEGORY_FILTERS: Array<{ value: CategoryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "sign_in", label: "Sign-ins" },
  { value: "security_changes", label: "Security changes" },
  { value: "sessions", label: "Sessions" },
];

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
   * Called when the user reports an event as not theirs. The account page
   * takes them to the password form until self-lock (#378) exists.
   */
  onReportActivity?: (item: SecurityActivityItem) => void;
}

export function SecurityActivityPanel({
  onReportActivity,
}: SecurityActivityPanelProps) {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [items, setItems] = useState<SecurityActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [reportedId, setReportedId] = useState<string | null>(null);
  // Bumped whenever the list restarts, so a "Load more" response for an
  // earlier filter is dropped instead of appended to the new one.
  const generationRef = useRef(0);
  // Both are YYYY-MM-DD, so string order is date order.
  const rangeError =
    fromDate && toDate && fromDate > toDate
      ? "The To date must be on or after the From date."
      : null;
  const hasDateRange = Boolean(fromDate || toDate);

  // The fetch effect below only loads; whatever restarts the list (a filter
  // change or a retry) clears it first, here.
  function resetList() {
    setStatus("loading");
    setErrorMessage(null);
    setLoadMoreError(null);
    setLoadingMore(false);
    setItems([]);
    setNextCursor(null);
    setReportedId(null);
  }

  useEffect(() => {
    const generation = ++generationRef.current;

    if (rangeError) {
      return;
    }

    const controller = new AbortController();

    securityActivityApi
      .listMine(
        {
          limit: PAGE_SIZE,
          category: category === "all" ? undefined : category,
          ...toActivityDateRange(fromDate, toDate),
        },
        controller.signal,
      )
      .then((result) => {
        if (generation !== generationRef.current) {
          return;
        }
        setItems(result.items);
        setNextCursor(result.nextCursor);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (generation !== generationRef.current) {
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
  }, [category, fromDate, toDate, rangeError, reloadKey]);

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) {
      return;
    }

    const generation = generationRef.current;
    setLoadingMore(true);
    setLoadMoreError(null);

    try {
      const result = await securityActivityApi.listMine({
        cursor: nextCursor,
        limit: PAGE_SIZE,
        category: category === "all" ? undefined : category,
        ...toActivityDateRange(fromDate, toDate),
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
      if (generation !== generationRef.current) {
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
                  resetList();
                  setCategory(filter.value);
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
        aria-label="Filter security activity by date"
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
          From
          <input
            type="date"
            value={fromDate}
            max={toDate || todayDateInputValue()}
            onChange={(event) => {
              resetList();
              setFromDate(event.target.value);
            }}
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
            onChange={(event) => {
              resetList();
              setToDate(event.target.value);
            }}
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
            onClick={() => {
              resetList();
              setFromDate("");
              setToDate("");
            }}
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
            onClick={() => {
              resetList();
              setReloadKey((key) => key + 1);
            }}
            className={secondaryButtonClass}
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-4 text-sm text-slate-500 dark:text-slate-400">
          {hasDateRange
            ? "No activity in this date range"
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
                          {!item.deviceKnown && (item.browser || item.os) ? (
                            <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                              New device
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
                disabled={loadingMore}
                className={secondaryButtonClass}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
