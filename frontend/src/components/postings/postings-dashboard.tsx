"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { useErrorToast } from "@/components/errors";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  canManageOrganizationPostings,
  canReadOrganizationPostings,
} from "@/lib/auth/roles";
import {
  formatPostingPrice,
  isRenderablePreviewImageUrl,
} from "@/lib/postings/public-format";
import {
  postingsApi,
  type OwnerPostingsStatusSummary,
  type PostingRecord,
  type PostingStatus,
} from "@/lib/postings/api";

type StatusFilter = "all" | PostingStatus;

type LifecycleAction = "publish" | "pause" | "unpause" | "archive";

const PAGE_SIZE = 10;

const EMPTY_SUMMARY: OwnerPostingsStatusSummary = {
  total: 0,
  byStatus: { draft: 0, published: 0, paused: 0, archived: 0 },
};

const STATUS_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "published", label: "Published" },
  { id: "paused", label: "Paused" },
  { id: "archived", label: "Archived" },
];

const POSTING_STATUS_STYLES: Record<PostingStatus, string> = {
  draft:
    "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  published:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  paused:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  archived:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
};

const primaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md hover:shadow-violet-600/25 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60";

const rowActionMutedClass =
  "inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300";

const rowActionPrimaryClass =
  "inline-flex h-9 items-center justify-center rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50";

function lifecycleActions(
  status: PostingStatus,
): Array<{ id: LifecycleAction; label: string; tone: "primary" | "muted" }> {
  if (status === "draft") {
    return [
      { id: "publish", label: "Publish", tone: "primary" },
      { id: "archive", label: "Archive", tone: "muted" },
    ];
  }
  if (status === "published") {
    return [
      { id: "pause", label: "Pause", tone: "muted" },
      { id: "archive", label: "Archive", tone: "muted" },
    ];
  }
  if (status === "paused") {
    return [
      { id: "unpause", label: "Unpause", tone: "primary" },
      { id: "archive", label: "Archive", tone: "muted" },
    ];
  }
  return [];
}

function formatVariant(posting: PostingRecord): string {
  return `${posting.variant.family} / ${posting.variant.subtype}`.replaceAll(
    "_",
    " ",
  );
}

function primaryPhotoUrl(posting: PostingRecord): string | null {
  const photos = posting.photos ?? [];
  const primary =
    photos.find((photo) => photo.position === 0) ?? photos[0] ?? null;
  const url = primary?.thumbnailBlobUrl ?? primary?.blobUrl;
  return isRenderablePreviewImageUrl(url) ? url : null;
}

function PostingThumb({ posting }: { posting: PostingRecord }) {
  const url = primaryPhotoUrl(posting);

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={posting.name}
        className="h-14 w-20 shrink-0 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-700"
      />
    );
  }

  return (
    <div
      aria-hidden
      className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-100 to-indigo-100 text-sm font-semibold uppercase text-violet-700 dark:from-violet-950/40 dark:to-indigo-950/40 dark:text-violet-300"
    >
      {posting.variant.family.charAt(0)}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function safePrice(posting: PostingRecord): string {
  const amount = posting.pricing.daily.amount;
  const currency = posting.pricing.currency;
  try {
    return `${formatPostingPrice(amount, currency)} / day`;
  } catch {
    return `${amount} ${currency} / day`;
  }
}

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

function StatTile({
  eyebrow,
  value,
  accent,
}: {
  eyebrow: string;
  value: ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.25)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
      <div className={`h-1.5 w-12 rounded-full bg-gradient-to-r ${accent}`} />
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        {eyebrow}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
        {value}
      </p>
    </div>
  );
}

export function PostingsDashboard() {
  const router = useRouter();
  const { status, session } = useAuth();
  const { showError } = useErrorToast();

  const [summary, setSummary] =
    useState<OwnerPostingsStatusSummary>(EMPTY_SUMMARY);
  const [postings, setPostings] = useState<PostingRecord[]>([]);
  const [pageInfo, setPageInfo] = useState({
    page: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
    total: 0,
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activeOrganization = session?.user.activeOrganization;
  const canRead = canReadOrganizationPostings(activeOrganization);
  const canManage = canManageOrganizationPostings(activeOrganization);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login?next=/postings/manage");
    }
  }, [router, status]);

  // Debounce the search box into the query used for fetching.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  async function loadSummary() {
    if (status !== "authenticated" || !canRead) {
      return;
    }
    try {
      const nextSummary = await postingsApi.getStatusSummary();
      startTransition(() => setSummary(nextSummary));
    } catch {
      // Counts are non-critical; leave the previous summary in place.
    }
  }

  useEffect(() => {
    void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canRead]);

  useEffect(() => {
    if (status !== "authenticated" || !canRead) {
      return;
    }

    let active = true;

    async function loadList() {
      setLoading(true);
      setError(null);

      try {
        const result = await postingsApi.listMine({
          page,
          pageSize: PAGE_SIZE,
          status: statusFilter === "all" ? undefined : statusFilter,
          q: query || undefined,
        });

        if (!active) {
          return;
        }

        startTransition(() => {
          setPostings(result.postings);
          setPageInfo({
            page: result.pagination.page,
            totalPages: result.pagination.totalPages,
            hasNextPage: result.pagination.hasNextPage,
            hasPreviousPage: result.pagination.hasPreviousPage,
            total: result.pagination.total,
          });
        });
      } catch (nextError) {
        if (active) {
          setError(
            getApiErrorMessage(nextError, {
              action: "load your postings",
              fallback:
                "We couldn't load your postings right now. Please try again.",
            }),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadList();

    return () => {
      active = false;
    };
  }, [status, canRead, statusFilter, query, page]);

  async function reloadList() {
    const result = await postingsApi.listMine({
      page,
      pageSize: PAGE_SIZE,
      status: statusFilter === "all" ? undefined : statusFilter,
      q: query || undefined,
    });
    startTransition(() => {
      setPostings(result.postings);
      setPageInfo({
        page: result.pagination.page,
        totalPages: result.pagination.totalPages,
        hasNextPage: result.pagination.hasNextPage,
        hasPreviousPage: result.pagination.hasPreviousPage,
        total: result.pagination.total,
      });
    });
  }

  async function handleLifecycle(postingId: string, action: LifecycleAction) {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      if (action === "publish") {
        await postingsApi.publish(postingId);
      } else if (action === "pause") {
        await postingsApi.pausePosting(postingId);
      } else if (action === "unpause") {
        await postingsApi.unpausePosting(postingId);
      } else {
        await postingsApi.archive(postingId);
      }

      await Promise.all([reloadList(), loadSummary()]);

      const pastTense: Record<LifecycleAction, string> = {
        publish: "published",
        pause: "paused",
        unpause: "unpaused",
        archive: "archived",
      };
      setMessage(`Posting ${pastTense[action]}.`);
    } catch (nextError) {
      const nextMessage = getApiErrorMessage(nextError, {
        action: `${action} that posting`,
        fallback:
          "We couldn't update that posting right now. Please try again.",
        preserveClientMessage: true,
      });
      setError(nextMessage);
      showError({
        title: "Couldn't update posting",
        message: nextMessage,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading") {
    return (
      <PageShell>
        <div className="h-40 animate-pulse rounded-[1.8rem] bg-slate-200/70 dark:bg-slate-800/70" />
      </PageShell>
    );
  }

  if (status !== "authenticated" || !session) {
    return null;
  }

  if (!canRead) {
    return (
      <PageShell>
        <div className="rounded-[1.8rem] border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            Postings
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
            Select an organization first
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            Posting management follows your active organization. Switch into an
            organization workspace first, then return here.
          </p>
          <Link href="/organizations" className={`${primaryButtonClass} mt-6`}>
            Open organizations
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {/* Header */}
      <section className="rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.35)] sm:p-7 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 shadow-sm dark:border-violet-900/60 dark:bg-slate-900 dark:text-violet-300">
              Posting dashboard
            </span>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
              {activeOrganization?.name ?? "Postings"}
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Manage every listing owned by this organization.
              {!canManage ? " Read-only access." : null}
            </p>
          </div>
          {canManage ? (
            <Link href="/postings/create" className={primaryButtonClass}>
              New posting
            </Link>
          ) : null}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            eyebrow="Total"
            value={summary.total}
            accent="from-violet-500 to-indigo-500"
          />
          <StatTile
            eyebrow="Published"
            value={summary.byStatus.published}
            accent="from-emerald-500 to-teal-500"
          />
          <StatTile
            eyebrow="Drafts"
            value={summary.byStatus.draft}
            accent="from-slate-400 to-slate-500"
          />
          <StatTile
            eyebrow="Paused"
            value={summary.byStatus.paused}
            accent="from-amber-400 to-orange-500"
          />
        </div>
      </section>

      {/* Toolbar */}
      <section className="rounded-[1.8rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {STATUS_TABS.map((tab) => {
              const count =
                tab.id === "all" ? summary.total : summary.byStatus[tab.id];
              const active = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setStatusFilter(tab.id);
                    setPage(1);
                  }}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                    active
                      ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                      : "border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-violet-800"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`rounded-full px-1.5 text-xs ${
                      active
                        ? "bg-violet-600 text-white"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="lg:w-72">
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by name…"
              aria-label="Search postings"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-500/20"
            />
          </div>
        </div>
      </section>

      {message ? (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          {message}
        </div>
      ) : null}

      {/* List */}
      <section className="rounded-[1.8rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-20 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-dashed border-rose-300 px-4 py-6 text-center text-sm text-rose-600 dark:border-rose-900/60 dark:text-rose-300">
            {error}
          </div>
        ) : postings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-12 text-center dark:border-slate-700">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {query || statusFilter !== "all"
                ? "No postings match your filters"
                : "No postings yet"}
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {query || statusFilter !== "all"
                ? "Try a different status or search term."
                : canManage
                  ? "Create the first listing for this organization."
                  : "Managers haven't created any listings yet."}
            </p>
            {canManage && !query && statusFilter === "all" ? (
              <Link
                href="/postings/create"
                className={`${primaryButtonClass} mt-4`}
              >
                New posting
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            {postings.map((posting) => (
              <article
                key={posting.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <PostingThumb posting={posting} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-slate-950 dark:text-white">
                        {posting.name}
                      </h2>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${POSTING_STATUS_STYLES[posting.status]}`}
                      >
                        {posting.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {formatVariant(posting)} · {posting.location.city},{" "}
                      {posting.location.region} · {safePrice(posting)} · Updated{" "}
                      {formatDate(posting.updatedAt)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canManage
                    ? lifecycleActions(posting.status).map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() =>
                            void handleLifecycle(posting.id, action.id)
                          }
                          disabled={saving}
                          className={
                            action.tone === "primary"
                              ? rowActionPrimaryClass
                              : rowActionMutedClass
                          }
                        >
                          {action.label}
                        </button>
                      ))
                    : null}
                  {posting.status === "published" ? (
                    <Link
                      href={`/postings/${encodeURIComponent(posting.id)}`}
                      className={rowActionMutedClass}
                    >
                      View
                    </Link>
                  ) : null}
                  <Link
                    href={`/postings/create?posting=${encodeURIComponent(posting.id)}`}
                    className={rowActionMutedClass}
                  >
                    {canManage ? "Edit" : "Details"}
                  </Link>
                </div>
              </article>
            ))}

            {/* Pagination */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Page {pageInfo.page} of {Math.max(pageInfo.totalPages, 1)} ·{" "}
                {pageInfo.total} total
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={!pageInfo.hasPreviousPage || loading}
                  className={rowActionMutedClass}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={!pageInfo.hasNextPage || loading}
                  className={rowActionMutedClass}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </PageShell>
  );
}
