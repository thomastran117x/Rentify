"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type PublicOrganizationListResult,
  type PublicOrganizationSummary,
} from "@/lib/organizations/api";

function formatLocation(
  organization: PublicOrganizationSummary,
): string | null {
  const parts = [organization.city, organization.region, organization.country]
    .map((part) => part?.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function buildSearchParams(query: string, page: number): URLSearchParams {
  const params = new URLSearchParams();
  const trimmed = query.trim();

  if (trimmed) {
    params.set("q", trimmed);
  }
  if (page > 1) {
    params.set("page", String(page));
  }

  return params;
}

function readPositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function OrganizationCard({
  organization,
}: {
  organization: PublicOrganizationSummary;
}) {
  const location = formatLocation(organization);
  const websiteHost = (() => {
    if (!organization.websiteUrl) {
      return null;
    }

    try {
      return new URL(organization.websiteUrl).host.replace(/^www\./, "");
    } catch {
      return organization.websiteUrl;
    }
  })();

  return (
    <article className="group rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-1 hover:border-violet-200 hover:shadow-xl hover:shadow-slate-950/5 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30 dark:hover:border-violet-800 dark:hover:shadow-black/40">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <p className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300">
            Public organization
          </p>
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
              {organization.name}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {location ?? "Location shared on request"}
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right dark:border-slate-800 dark:bg-slate-950/60">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            Published postings
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
            {organization.publishedPostingCount}
          </p>
        </div>
      </div>

      <p className="mt-5 line-clamp-3 min-h-[4.5rem] text-sm leading-7 text-slate-600 dark:text-slate-300">
        {organization.description ??
          "This organization currently has published Rentify postings and a public profile available for browsing."}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {websiteHost ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {websiteHost}
          </span>
        ) : null}
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          Joined {formatDate(organization.createdAt)}
        </span>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Browse public profile details and active marketplace presence.
        </p>
        <Link
          href={`/organizations/${organization.id}`}
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-violet-700 dark:bg-white dark:text-slate-950 dark:hover:bg-violet-100"
        >
          View organization
        </Link>
      </div>
    </article>
  );
}

export function OrganizationDirectoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [queryInput, setQueryInput] = useState(searchParams.get("q") ?? "");
  const [result, setResult] = useState<PublicOrganizationListResult | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = searchParams.get("q") ?? "";
  const page = readPositiveInt(searchParams.get("page"), 1);

  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  useEffect(() => {
    let active = true;

    async function loadOrganizations() {
      setLoading(true);
      setError(null);

      try {
        const nextResult = await organizationsApi.listPublic({
          page,
          pageSize: 20,
          query: query || undefined,
        });

        if (!active) {
          return;
        }

        setResult(nextResult);
      } catch (nextError) {
        if (!active) {
          return;
        }

        setError(
          getApiErrorMessage(nextError, {
            action: "load the organization directory",
            fallback:
              "We couldn't load the organization directory right now. Please try again.",
          }),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadOrganizations();

    return () => {
      active = false;
    };
  }, [page, query]);

  function updateRoute(nextQuery: string, nextPage: number) {
    const nextParams = buildSearchParams(nextQuery, nextPage);
    const href = nextParams.toString()
      ? `${pathname}?${nextParams.toString()}`
      : pathname;
    router.replace(href, { scroll: false });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateRoute(queryInput, 1);
  }

  const organizations = result?.organizations ?? [];
  const pagination = result?.pagination;
  const total = pagination?.total ?? 0;

  return (
    <main className="min-h-[calc(100vh-5.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(124,58,237,0.14),_transparent_28%),linear-gradient(180deg,_#f8fafc,_#ffffff)] px-6 py-10 text-slate-900 dark:bg-[radial-gradient(circle_at_top_left,_rgba(124,58,237,0.18),_transparent_28%),linear-gradient(180deg,_#020617,_#0f172a)] dark:text-white">
      <div className="mx-auto max-w-6xl">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white/90 p-8 shadow-[0_28px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-10 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-black/40">
          <div className="grid gap-8 lg:grid-cols-[1.4fr_0.9fr] lg:items-end">
            <div>
              <p className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300">
                Rentify organization directory
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-5xl dark:text-white">
                Browse organizations with live public postings.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300">
                Explore verified organization profiles, search by name, and open
                public detail pages before you ever step into a private
                workspace.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  Visibility rule
                </p>
                <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Only organizations with at least one published posting appear
                  here.
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/40">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  Workspace access
                </p>
                <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  Signed-in members can manage teams and settings from the
                  dashboard workspace.
                </p>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="mt-8 flex flex-col gap-3 rounded-[1.6rem] border border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-950/40"
          >
            <input
              type="search"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Search organizations by name"
              className="h-12 flex-1 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-500/20"
            />
            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-violet-600 px-6 text-sm font-semibold text-white transition hover:bg-violet-700"
            >
              Search directory
            </button>
          </form>
        </section>

        <section className="mt-8 rounded-[1.8rem] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                Directory results
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {loading
                  ? "Loading organizations..."
                  : total === 0
                    ? "No public organizations matched this search yet."
                    : `Showing ${organizations.length} of ${total} public organizations.`}
              </p>
            </div>
            <Link
              href="/dashboard/organizations"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
            >
              Open workspace
            </Link>
          </div>

          {error ? (
            <div className="mt-6 rounded-[1.4rem] border border-rose-200 bg-rose-50 p-5 text-sm leading-7 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {[0, 1, 2, 3].map((key) => (
                <div
                  key={key}
                  className="h-64 animate-pulse rounded-[1.8rem] bg-slate-100 dark:bg-slate-800"
                />
              ))}
            </div>
          ) : organizations.length > 0 ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {organizations.map((organization) => (
                <OrganizationCard
                  key={organization.id}
                  organization={organization}
                />
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-[1.6rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-950/40">
              <h3 className="text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                No public organizations found
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                Try a broader name search, or check back once more organizations
                publish postings.
              </p>
            </div>
          )}

          {!loading && pagination && organizations.length > 0 ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!pagination.hasPreviousPage}
                  onClick={() => updateRoute(query, pagination.page - 1)}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!pagination.hasNextPage}
                  onClick={() => updateRoute(query, pagination.page + 1)}
                  className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-violet-100"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
