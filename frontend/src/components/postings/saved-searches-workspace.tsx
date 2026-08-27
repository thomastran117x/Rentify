"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AlertTriangle, BellRing, Search, Trash2 } from "lucide-react";
import { Pagination } from "@/components/common/pagination";
import { useAuth } from "@/components/auth/auth-context";
import { useErrorToast } from "@/components/errors";
import { SavedTabs } from "@/components/postings/saved-tabs";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import type { Pagination as PaginationMeta } from "@/lib/api/types";
import {
  savedSearchesApi,
  type SavedSearchNotifyFrequency,
  type SavedSearchRecord,
} from "@/lib/saved-searches/api";
import {
  buildSavedSearchHref,
  describeSavedSearchFilters,
} from "@/lib/saved-searches/query";
import { theme } from "@/styles/theme";

const pageSizeOptions = [10, 20, 50] as const;

const frequencyOptions: Array<{
  value: SavedSearchNotifyFrequency;
  label: string;
}> = [
  { value: "instant", label: "Email me right away" },
  { value: "daily", label: "Email me daily" },
  { value: "off", label: "Do not email me" },
];

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-slate-50 dark:bg-slate-950">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(124,58,237,0.10),transparent_32%),radial-gradient(circle_at_88%_4%,rgba(99,102,241,0.08),transparent_30%)]"
      />
      <div className="relative mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        {children}
      </div>
    </main>
  );
}

function PageHeading() {
  return (
    <header className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
        Saved
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
        Saved searches
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
        Searches you asked us to keep watching. When a posting starts matching
        one, we email you — so you do not have to keep checking back.
      </p>
      <div className="mt-5">
        <SavedTabs active="searches" />
      </div>
    </header>
  );
}

function SavedSearchRow({
  search,
  busy,
  onRename,
  onFrequencyChange,
  onDelete,
  onOpen,
}: {
  search: SavedSearchRecord;
  busy: boolean;
  onRename: (name: string) => void;
  onFrequencyChange: (frequency: SavedSearchNotifyFrequency) => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const [name, setName] = useState(search.name);
  const [renaming, setRenaming] = useState(false);
  const [syncedName, setSyncedName] = useState(search.name);
  const chips = describeSavedSearchFilters(search.queryParams);

  // A rename that lands from elsewhere (or a reload) has to win over a draft
  // nobody submitted, otherwise the field silently keeps showing a stale value.
  // Adjusted during render rather than in an effect: React re-runs this
  // component immediately without committing the intermediate state, so the
  // field never paints the old name.
  if (search.name !== syncedName) {
    setSyncedName(search.name);
    setName(search.name);
    setRenaming(false);
  }

  function handleRenameSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();

    if (!trimmed || trimmed === search.name) {
      setName(search.name);
      setRenaming(false);
      return;
    }

    onRename(trimmed);
    setRenaming(false);
  }

  return (
    <article className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form onSubmit={handleRenameSubmit} className="flex gap-2">
              <label className="sr-only" htmlFor={`name-${search.id}`}>
                Search name
              </label>
              <input
                id={`name-${search.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={handleRenameSubmit}
                maxLength={120}
                autoFocus
                className={theme.marketplace.input}
              />
              <button
                type="submit"
                disabled={busy}
                className={theme.marketplace.paginationButton}
              >
                Save
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="text-left text-base font-semibold tracking-[-0.02em] text-slate-950 hover:underline dark:text-white"
            >
              {search.name}
            </button>
          )}

          {chips.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <li key={chip} className={theme.marketplace.summaryPill}>
                  {chip}
                </li>
              ))}
            </ul>
          ) : (
            <p className={`${theme.marketplace.summaryEmpty} mt-2`}>
              No filters recorded.
            </p>
          )}
        </div>

        {search.newMatchCount > 0 ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
            data-testid="new-match-badge"
          >
            <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
            {search.newMatchCount === 1
              ? "1 new match"
              : `${search.newMatchCount} new matches`}
          </span>
        ) : null}
      </div>

      {search.invalidated ? (
        <p className="mt-4 flex items-start gap-2 rounded-[1rem] border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            This search uses a filter we no longer support, so it has stopped
            running. Delete it and save the search again to start getting
            alerts.
          </span>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href={buildSavedSearchHref(search.queryParams)}
          onClick={onOpen}
          className={theme.marketplace.paginationButton}
        >
          View results
        </Link>

        <div className="flex items-center gap-2">
          <label
            className={theme.marketplace.fieldLabel}
            htmlFor={`frequency-${search.id}`}
          >
            Alerts
          </label>
          <select
            id={`frequency-${search.id}`}
            value={search.notifyFrequency}
            disabled={busy || search.invalidated}
            onChange={(event) =>
              onFrequencyChange(
                event.target.value as SavedSearchNotifyFrequency,
              )
            }
            className={theme.marketplace.input}
          >
            {frequencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Delete saved search ${search.name}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </button>
      </div>
    </article>
  );
}

export function SavedSearchesWorkspace() {
  const { status: authStatus } = useAuth();
  const { showError } = useErrorToast();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [searches, setSearches] = useState<SavedSearchRecord[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    async function loadSavedSearches() {
      try {
        const result = await savedSearchesApi.list({ page, pageSize });

        if (!active) {
          return;
        }

        setSearches(result.searches);
        setPagination(result.pagination);
        setLimit(result.limit);
      } catch (nextError) {
        if (active) {
          setError(
            getApiErrorMessage(nextError, {
              action: "load your saved searches",
              fallback:
                "We couldn't load your saved searches right now. Please try again.",
            }),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadSavedSearches();

    return () => {
      active = false;
    };
  }, [authStatus, page, pageSize]);

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
  }, []);

  const handlePageSizeChange = useCallback((nextPageSize: number) => {
    // The pagination control does not reset the page for us.
    setPageSize(nextPageSize);
    setPage(1);
  }, []);

  /**
   * Applies a patch optimistically and rolls the row back if the write fails.
   *
   * Per-row failures go to a toast rather than the page-level error state:
   * that state replaces the whole list, leaving no control the visitor could
   * use to retry.
   */
  const patchSearch = useCallback(
    async (
      id: string,
      patch: { name?: string; notifyFrequency?: SavedSearchNotifyFrequency },
      failureAction: string,
    ) => {
      const previous = searches;

      setBusyId(id);
      setSearches((current) =>
        current.map((search) =>
          search.id === id ? { ...search, ...patch } : search,
        ),
      );

      try {
        const updated = await savedSearchesApi.update(id, patch);

        setSearches((current) =>
          current.map((search) => (search.id === id ? updated : search)),
        );
      } catch (nextError) {
        setSearches(previous);
        showError({
          title: "Couldn't update saved search",
          message: getApiErrorMessage(nextError, {
            action: failureAction,
            fallback:
              "We couldn't update that saved search right now. Please try again.",
          }),
          tone: "error",
        });
      } finally {
        setBusyId(null);
      }
    },
    [searches, showError],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const previous = searches;

      setBusyId(id);
      setSearches((current) => current.filter((search) => search.id !== id));

      try {
        await savedSearchesApi.remove(id);
        setPagination((current) =>
          current
            ? { ...current, total: Math.max(0, current.total - 1) }
            : current,
        );
      } catch (nextError) {
        setSearches(previous);
        showError({
          title: "Couldn't delete saved search",
          message: getApiErrorMessage(nextError, {
            action: "delete that saved search",
            fallback:
              "We couldn't delete that saved search right now. Please try again.",
          }),
          tone: "error",
        });
      } finally {
        setBusyId(null);
      }
    },
    [searches, showError],
  );

  /**
   * Clearing the badge is fire-and-forget on purpose: the visitor is already
   * navigating to the results, and a failed reset costs them a stale count
   * that the next sweep corrects. Surfacing an error over a page transition
   * would be worse than the staleness.
   */
  const handleOpen = useCallback((id: string) => {
    setSearches((current) =>
      current.map((search) =>
        search.id === id ? { ...search, newMatchCount: 0 } : search,
      ),
    );
    void savedSearchesApi.markSeen(id).catch(() => undefined);
  }, []);

  if (authStatus === "loading") {
    return (
      <PageShell>
        <div className="h-40 animate-pulse rounded-[1.8rem] bg-slate-200/70 dark:bg-slate-800/70" />
      </PageShell>
    );
  }

  if (authStatus === "anonymous") {
    return (
      <PageShell>
        <PageHeading />
        <div className="rounded-[1.8rem] border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <Search
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-medium text-slate-950 dark:text-white">
            Sign in to see your saved searches
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
            Saved searches are tied to your account, and alerts go to the email
            address on it.
          </p>
          <Link
            href="/login?next=/saved/searches"
            className={`${theme.marketplace.paginationButton} mt-4 inline-flex`}
          >
            Log in
          </Link>
        </div>
      </PageShell>
    );
  }

  const isEmpty = (pagination?.total ?? 0) === 0;
  const atLimit = limit !== null && (pagination?.total ?? 0) >= limit;

  return (
    <PageShell>
      <PageHeading />

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((key) => (
            <div
              key={key}
              className="h-40 animate-pulse rounded-[1.5rem] bg-slate-200/70 dark:bg-slate-800/70"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-[1.5rem] border border-dashed border-rose-300 px-4 py-6 text-center text-sm text-rose-600 dark:border-rose-800 dark:text-rose-300">
          {error}
        </div>
      ) : isEmpty ? (
        <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-4 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <Search
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-medium text-slate-950 dark:text-white">
            You haven&apos;t saved any searches yet
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
            Search for something on the browse page and press{" "}
            <strong>Save this search</strong>. If nothing matches yet, we will
            email you when something does.
          </p>
          <Link
            href="/postings"
            className={`${theme.marketplace.paginationButton} mt-4 inline-flex`}
          >
            Browse postings
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {atLimit ? (
            <p
              role="status"
              className="rounded-[1rem] border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
            >
              You have reached the limit of {limit} saved searches. Delete one
              to save another.
            </p>
          ) : null}

          {searches.map((search) => (
            <SavedSearchRow
              key={search.id}
              search={search}
              busy={busyId === search.id}
              onRename={(name) =>
                void patchSearch(
                  search.id,
                  { name },
                  "rename that saved search",
                )
              }
              onFrequencyChange={(notifyFrequency) =>
                void patchSearch(
                  search.id,
                  { notifyFrequency },
                  "change how often we email you about that search",
                )
              }
              onDelete={() => void handleDelete(search.id)}
              onOpen={() => handleOpen(search.id)}
            />
          ))}

          {pagination ? (
            <Pagination
              pagination={pagination}
              itemLabel={{ one: "saved search", other: "saved searches" }}
              showGoToPage
              pageSizeOptions={pageSizeOptions}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : null}
        </div>
      )}
    </PageShell>
  );
}
