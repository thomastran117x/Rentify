"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { History, X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { PostingCompactCard } from "@/components/postings/posting-compact-card";
import { useRecentlyViewed } from "@/components/postings/recently-viewed-context";
import { SavedTabs } from "@/components/postings/saved-tabs";
import { theme } from "@/styles/theme";

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

/**
 * How many cards render before a "Show more" reveal. The provider already
 * requests the account's full 50-entry cap in one request, so revealing more
 * is a local slice, not another round trip -- this exists purely so the page
 * does not dump up to 50 cards on a visitor who only wants a handful.
 */
const INITIAL_VISIBLE_COUNT = 24;

function formatViewedAt(viewedAt: string): string | null {
  const parsed = Date.parse(viewedAt);

  if (Number.isNaN(parsed)) {
    return null;
  }

  const elapsedMs = Date.now() - parsed;
  const elapsedDays = Math.floor(elapsedMs / 86_400_000);

  if (elapsedDays <= 0) {
    return "Viewed today";
  }

  if (elapsedDays === 1) {
    return "Viewed yesterday";
  }

  if (elapsedDays < 30) {
    return `Viewed ${elapsedDays} days ago`;
  }

  return `Viewed on ${new Date(parsed).toLocaleDateString()}`;
}

export function RecentlyViewedWorkspace() {
  const { status: authStatus } = useAuth();
  const { status, postings, remove, clear } = useRecentlyViewed();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const visiblePostings = postings.slice(0, visibleCount);

  const handleClear = useCallback(async () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }

    setBusy(true);

    try {
      await clear();
    } finally {
      setBusy(false);
      setConfirmingClear(false);
    }
  }, [clear, confirmingClear]);

  const heading = (
    <header className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
        Saved
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
        Recently viewed
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
        {authStatus === "authenticated"
          ? "Postings you opened while browsing, newest first. They follow you between devices."
          : "Postings you opened while browsing, newest first. They are kept in this browser only."}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <SavedTabs active="recent" />
        {postings.length > 0 ? (
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={busy}
            onBlur={() => setConfirmingClear(false)}
            className={`${theme.marketplace.paginationButton} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {confirmingClear ? "Yes, clear history" : "Clear history"}
          </button>
        ) : null}
      </div>
    </header>
  );

  if (authStatus === "loading" || status === "loading") {
    return (
      <PageShell>
        {heading}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <div
              key={key}
              className="h-64 animate-pulse rounded-[1.5rem] bg-slate-200/70 dark:bg-slate-800/70"
            />
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {heading}

      {status === "error" ? (
        <div className="rounded-[1.5rem] border border-dashed border-rose-300 px-4 py-6 text-center text-sm text-rose-600 dark:border-rose-800 dark:text-rose-300">
          We couldn&apos;t load your recently viewed postings. Please try again.
        </div>
      ) : postings.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-4 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <History
            className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-medium text-slate-950 dark:text-white">
            You haven&apos;t viewed any postings yet
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Open a posting and it will show up here so you can find it again.
          </p>
          <Link
            href="/postings"
            className={`${theme.marketplace.paginationButton} mt-4 inline-flex`}
          >
            Browse postings
          </Link>
        </div>
      ) : (
        <>
          {/* Signed-out visitors keep a real list; they are told what signing
              in would add rather than being shown a sign-in wall. */}
          {authStatus === "anonymous" ? (
            <p className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <Link
                href="/login?next=/saved/recent"
                className="font-semibold text-violet-700 hover:underline dark:text-violet-300"
              >
                Sign in
              </Link>{" "}
              to carry this history across your devices.
            </p>
          ) : null}

          <ul role="list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {visiblePostings.map((posting) => (
              <li key={posting.id}>
                <PostingCompactCard
                  posting={posting}
                  footnote={formatViewedAt(posting.viewedAt)}
                  actions={
                    <button
                      type="button"
                      onClick={() => void remove(posting.id)}
                      aria-label={`Remove ${posting.name} from recently viewed`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-500 shadow-sm backdrop-blur transition duration-200 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-400 dark:hover:border-rose-800 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  }
                />
              </li>
            ))}
          </ul>

          {visibleCount < postings.length ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((current) => current + INITIAL_VISIBLE_COUNT)
                }
                className={theme.marketplace.paginationButton}
              >
                Show more
              </button>
            </div>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
