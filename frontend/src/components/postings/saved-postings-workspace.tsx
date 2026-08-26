"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EyeOff, Heart } from "lucide-react";
import { Pagination } from "@/components/common/pagination";
import { useAuth } from "@/components/auth/auth-context";
import { useErrorToast } from "@/components/errors";
import { PostingResultCard } from "@/components/postings/posting-result-card";
import { SavePostingButton } from "@/components/postings/save-posting-button";
import { useSavedPostings } from "@/components/postings/saved-postings-context";
import { SavedTabs } from "@/components/postings/saved-tabs";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import type { Pagination as PaginationMeta } from "@/lib/api/types";
import {
  savedPostingsApi,
  type SavedPostingSummary,
  type UnavailableSavedPosting,
} from "@/lib/saved-postings/api";
import { theme } from "@/styles/theme";

const pageSizeOptions = [10, 20, 50] as const;

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
        Saved postings
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
        Postings you hearted while browsing. They stay here across every device
        you sign in on.
      </p>
      <div className="mt-5">
        <SavedTabs active="postings" />
      </div>
    </header>
  );
}

/**
 * A saved posting that can no longer be viewed. It is rendered rather than
 * dropped so the visitor can see which of their saves went away, and decide:
 * a paused posting may well come back, so removing it is never the default.
 */
function UnavailableSavedPostingRow({
  entry,
  removing,
  onRemove,
}: {
  entry: UnavailableSavedPosting;
  removing: boolean;
  onRemove: () => void;
}) {
  const label = entry.name ?? "This posting";
  const message =
    entry.reason === "paused"
      ? `${label} is unavailable to view right now. The host has paused it, so it may come back.`
      : `${label} is no longer available to view. It has been removed from the marketplace.`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-start gap-3">
        <EyeOff
          className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {message}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {entry.reason === "paused"
              ? "It stays in your saved postings until you remove it."
              : "You can clear it from your saved postings."}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={`Remove ${label} from saved postings`}
        className={
          removing
            ? theme.marketplace.saveButtonLabelledDisabled
            : theme.marketplace.saveButtonLabelled
        }
      >
        {removing ? "Removing..." : "Remove"}
      </button>
    </div>
  );
}

export function SavedPostingsWorkspace() {
  const { status: authStatus } = useAuth();
  const { isSaved, markSaved } = useSavedPostings();
  const { showError } = useErrorToast();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [postings, setPostings] = useState<SavedPostingSummary[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [unavailable, setUnavailable] = useState<UnavailableSavedPosting[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    async function loadSavedPostings() {
      try {
        const result = await savedPostingsApi.list({ page, pageSize });

        if (!active) {
          return;
        }

        setPostings(result.postings);
        setPagination(result.pagination);
        setUnavailable(result.unavailablePostings);
        // Everything on this page is saved by definition. Seeding the shared
        // set keeps the hearts filled even if the identifier request has not
        // come back yet.
        markSaved(result.postings.map((posting) => posting.id));
      } catch (nextError) {
        if (active) {
          setError(
            getApiErrorMessage(nextError, {
              action: "load your saved postings",
              fallback:
                "We couldn't load your saved postings right now. Please try again.",
            }),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadSavedPostings();

    return () => {
      active = false;
    };
  }, [authStatus, markSaved, page, pageSize, reloadToken]);

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
  }, []);

  const handlePageSizeChange = useCallback((nextPageSize: number) => {
    // The pagination control does not reset the page for us.
    setPageSize(nextPageSize);
    setPage(1);
  }, []);

  // Unhearting deliberately leaves the card on screen with an outline heart so
  // the change can be undone. The list is only re-read when the page, the page
  // size, or the visit changes, which is when unsaved entries drop out.
  const unheartedCount = postings.reduce(
    (total, posting) => (isSaved(posting.id) ? total : total + 1),
    0,
  );

  // A page can be free of renderable cards while the account still holds saved
  // rows, either because every row on it is unavailable or because the visitor
  // is past the last page. Only a zero total means an empty wishlist.
  const hasNoSavedPostings = (pagination?.total ?? 0) === 0;

  const handleRemoveUnavailable = useCallback(
    async (postingId: string) => {
      setRemovingId(postingId);

      try {
        // Unsave is idempotent and deliberately not gated on visibility, so a
        // posting that can no longer be rendered can still be cleared.
        await savedPostingsApi.unsave(postingId);
        setUnavailable((current) =>
          current.filter((entry) => entry.postingId !== postingId),
        );
        setReloadToken((current) => current + 1);
      } catch (nextError) {
        // A failed removal is reported as a toast, never through the page-level
        // error state: that state replaces the whole list, including the
        // pagination control, leaving nothing that can trigger a reload.
        showError({
          title: "Couldn't remove saved posting",
          message: getApiErrorMessage(nextError, {
            action: "remove that saved posting",
            fallback:
              "We couldn't remove that saved posting right now. Please try again.",
          }),
          tone: "error",
        });
      } finally {
        setRemovingId(null);
      }
    },
    [showError],
  );

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
          <Heart
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-medium text-slate-950 dark:text-white">
            Sign in to see your saved postings
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
            Saved postings are tied to your account, so they follow you between
            devices.
          </p>
          <Link
            href="/login?next=/saved"
            className={`${theme.marketplace.paginationButton} mt-4 inline-flex`}
          >
            Log in
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeading />

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((key) => (
            <div
              key={key}
              className="h-48 animate-pulse rounded-[1.5rem] bg-slate-200/70 dark:bg-slate-800/70"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-[1.5rem] border border-dashed border-rose-300 px-4 py-6 text-center text-sm text-rose-600 dark:border-rose-800 dark:text-rose-300">
          {error}
        </div>
      ) : hasNoSavedPostings ? (
        <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-4 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <Heart
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-medium text-slate-950 dark:text-white">
            You haven&apos;t saved any postings yet
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Tap the heart on any posting to keep it here for later.
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
          {unavailable.map((entry) => (
            <UnavailableSavedPostingRow
              key={entry.postingId}
              entry={entry}
              removing={removingId === entry.postingId}
              onRemove={() => void handleRemoveUnavailable(entry.postingId)}
            />
          ))}

          {postings.length === 0 && unavailable.length === 0 ? (
            <p className={theme.marketplace.resultsEmpty}>
              Nothing on this page can be shown right now. Try another page.
            </p>
          ) : null}

          {unheartedCount > 0 ? (
            <p
              role="status"
              className="text-xs text-slate-500 dark:text-slate-400"
            >
              {unheartedCount === 1
                ? "1 posting is no longer saved. It stays listed until you leave this page, so you can undo it."
                : `${unheartedCount} postings are no longer saved. They stay listed until you leave this page, so you can undo them.`}
            </p>
          ) : null}

          {postings.map((posting) => (
            <PostingResultCard
              key={posting.id}
              posting={posting}
              actions={
                <SavePostingButton
                  postingId={posting.id}
                  postingName={posting.name}
                />
              }
            />
          ))}

          {pagination ? (
            <Pagination
              pagination={pagination}
              itemLabel={{ one: "saved posting", other: "saved postings" }}
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
