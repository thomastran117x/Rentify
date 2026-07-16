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

function formatLocation(organization: PublicOrganizationSummary): string | null {
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

function OrganizationCard({ organization }: { organization: PublicOrganizationSummary }) {
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
    <article className="group rounded-[1.8rem] border border-stone-200 bg-white/90 p-6 shadow-[0_22px_60px_-40px_rgba(41,37,36,0.45)] transition duration-200 hover:-translate-y-1 hover:border-amber-300 hover:shadow-[0_28px_80px_-38px_rgba(180,83,9,0.32)]">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <p className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            Public organization
          </p>
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-stone-950">
              {organization.name}
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              {location ?? "Location shared on request"}
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
            Published postings
          </p>
          <p className="mt-1 text-2xl font-semibold text-stone-950">
            {organization.publishedPostingCount}
          </p>
        </div>
      </div>

      <p className="mt-5 line-clamp-3 min-h-[4.5rem] text-sm leading-7 text-stone-600">
        {organization.description ??
          "This organization currently has published Rentify postings and a public profile available for browsing."}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {websiteHost ? (
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
            {websiteHost}
          </span>
        ) : null}
        <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
          Joined {formatDate(organization.createdAt)}
        </span>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-stone-200 pt-4">
        <p className="text-xs text-stone-500">
          Browse public profile details and active marketplace presence.
        </p>
        <Link
          href={`/organizations/${organization.id}`}
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-amber-700"
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
  const [result, setResult] = useState<PublicOrganizationListResult | null>(null);
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_transparent_30%),linear-gradient(180deg,_#fffaf1,_#ffffff_45%,_#f5f5f4)] px-6 py-10 text-stone-950">
      <div className="mx-auto max-w-6xl">
        <section className="overflow-hidden rounded-[2rem] border border-stone-200 bg-white/85 p-8 shadow-[0_40px_120px_-60px_rgba(120,53,15,0.35)] backdrop-blur sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.4fr_0.9fr] lg:items-end">
            <div>
              <p className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                Rentify organization directory
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.06em] text-stone-950 sm:text-5xl">
                Browse organizations with live public postings.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-stone-600">
                Explore verified organization profiles, search by name, and open public detail pages before you ever step into a private workspace.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
                  Visibility rule
                </p>
                <p className="mt-2 text-sm leading-7 text-stone-600">
                  Only organizations with at least one published posting appear here.
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
                  Workspace access
                </p>
                <p className="mt-2 text-sm leading-7 text-stone-600">
                  Signed-in members can manage teams and settings from the dashboard workspace.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3 rounded-[1.6rem] border border-stone-200 bg-stone-50/80 p-4 sm:flex-row sm:items-center">
            <input
              type="search"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Search organizations by name"
              className="h-12 flex-1 rounded-2xl border border-stone-200 bg-white px-4 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
            />
            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-stone-950 px-6 text-sm font-semibold text-white transition hover:bg-amber-700"
            >
              Search directory
            </button>
          </form>
        </section>

        <section className="mt-8 rounded-[1.8rem] border border-stone-200 bg-white/90 p-6 shadow-[0_24px_80px_-50px_rgba(41,37,36,0.28)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.03em] text-stone-950">
                Directory results
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                {loading
                  ? "Loading organizations..."
                  : total === 0
                    ? "No public organizations matched this search yet."
                    : `Showing ${organizations.length} of ${total} public organizations.`}
              </p>
            </div>
            <Link
              href="/dashboard/organizations"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-stone-200 bg-white px-4 text-sm font-semibold text-stone-700 transition hover:border-amber-300 hover:text-amber-700"
            >
              Open workspace
            </Link>
          </div>

          {error ? (
            <div className="mt-6 rounded-[1.4rem] border border-rose-200 bg-rose-50 p-5 text-sm leading-7 text-rose-800">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {[0, 1, 2, 3].map((key) => (
                <div
                  key={key}
                  className="h-64 animate-pulse rounded-[1.8rem] bg-stone-100"
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
            <div className="mt-6 rounded-[1.6rem] border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center">
              <h3 className="text-xl font-semibold tracking-[-0.03em] text-stone-950">
                No public organizations found
              </h3>
              <p className="mt-3 text-sm leading-7 text-stone-600">
                Try a broader name search, or check back once more organizations publish postings.
              </p>
            </div>
          )}

          {pagination && organizations.length > 0 ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4">
              <p className="text-sm text-stone-500">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!pagination.hasPreviousPage}
                  onClick={() => updateRoute(query, pagination.page - 1)}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-stone-200 bg-white px-4 text-sm font-semibold text-stone-700 transition hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!pagination.hasNextPage}
                  onClick={() => updateRoute(query, pagination.page + 1)}
                  className="inline-flex h-11 items-center justify-center rounded-2xl bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
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
