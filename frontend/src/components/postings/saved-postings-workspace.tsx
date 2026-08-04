"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Heart } from "lucide-react";
import { Pagination } from "@/components/common/pagination";
import { useAuth } from "@/components/auth/auth-context";
import { PostingResultCard } from "@/components/postings/posting-result-card";
import { SavePostingButton } from "@/components/postings/save-posting-button";
import { useSavedPostings } from "@/components/postings/saved-postings-context";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import type { Pagination as PaginationMeta } from "@/lib/api/types";
import {
  savedPostingsApi,
  type SavedPostingSummary,
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
    </header>
  );
}

export function SavedPostingsWorkspace() {
  const { status: authStatus } = useAuth();
  const { isSaved, markSaved } = useSavedPostings();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [postings, setPostings] = useState<SavedPostingSummary[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [unavailableCount, setUnavailableCount] = useState(0);
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
        setUnavailableCount(result.unavailablePostingIds.length);
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
  }, [authStatus, markSaved, page, pageSize]);

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
      ) : postings.length === 0 ? (
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
          {unavailableCount > 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {unavailableCount === 1
                ? "1 saved posting is no longer available and is not shown."
                : `${unavailableCount} saved postings are no longer available and are not shown.`}
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
