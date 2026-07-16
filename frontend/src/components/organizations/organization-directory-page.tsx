"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Globe,
  MapPin,
  Search,
  X,
} from "lucide-react";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type PublicOrganizationListResult,
  type PublicOrganizationSummary,
} from "@/lib/organizations/api";
import {
  OrganizationLogo,
  formatOrganizationDate,
  getWebsiteHost,
} from "@/components/organizations/organization-public-visuals";
import { theme } from "@/styles/theme";

const PAGE_SIZE = 20;

function formatLocation(organization: PublicOrganizationSummary): string | null {
  const parts = [organization.city, organization.region, organization.country]
    .map((part) => part?.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : null;
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
  const websiteHost = getWebsiteHost(organization.websiteUrl);

  return (
    <article className={theme.marketplace.resultCard}>
      <div className="grid gap-0 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div className="relative flex min-h-36 items-center justify-center border-b border-slate-200 bg-[radial-gradient(circle_at_30%_20%,rgba(124,58,237,0.18),transparent_28%),linear-gradient(135deg,#f8fafc,#ede9fe_55%,#ffffff)] p-6 sm:min-h-full sm:border-b-0 sm:border-r dark:border-slate-800 dark:bg-[radial-gradient(circle_at_30%_20%,rgba(124,58,237,0.28),transparent_30%),linear-gradient(135deg,#0f172a,#1e1b4b_55%,#020617)]">
          <OrganizationLogo
            name={organization.name}
            logoUrl={organization.logoUrl}
            size="lg"
          />
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
              {organization.name}
            </h2>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-semibold text-slate-950 dark:text-white">
                {organization.publishedPostingCount}
              </span>
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                published{" "}
                {organization.publishedPostingCount === 1
                  ? "posting"
                  : "postings"}
              </span>
            </div>
          </div>

          <p className="mt-3 line-clamp-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {organization.description ??
              "This organization has published Rentify postings and a public profile available for browsing."}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
            <span className={theme.marketplace.metaBadge}>
              <MapPin className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />
              {location ?? "Location shared on request"}
            </span>
            {websiteHost ? (
              <span className={theme.marketplace.metaBadge}>
                <Globe className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />
                {websiteHost}
              </span>
            ) : null}
            <span className={theme.marketplace.metaBadge}>
              <CalendarDays className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />
              Joined {formatOrganizationDate(organization.createdAt)}
            </span>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              View the public profile and marketplace presence.
            </p>
            <Link
              href={`/organizations/${organization.id}`}
              className={theme.marketplace.paginationButton}
            >
              View organization
            </Link>
          </div>
        </div>
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
          pageSize: PAGE_SIZE,
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

  function clearSearch() {
    setQueryInput("");
    updateRoute("", 1);
  }

  const organizations = result?.organizations ?? [];
  const pagination = result?.pagination;
  const total = pagination?.total ?? 0;
  const rangeStart = organizations.length > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = (page - 1) * PAGE_SIZE + organizations.length;

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
                  <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Rentify organization directory
                </p>
                <h1 className={theme.marketplace.title}>
                  Browse organizations with live public postings.
                </h1>
                <p className={theme.marketplace.description}>
                  Explore verified organization profiles, search by name, and
                  open public detail pages before you ever step into a private
                  workspace.
                </p>
              </div>

              <div className={theme.marketplace.utilityList}>
                <div className={theme.marketplace.utilityCard}>
                  <p className={theme.marketplace.utilityLabel}>
                    Listed right now
                  </p>
                  <p className="mt-1 flex items-end gap-2">
                    <span className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 tabular-nums dark:text-white">
                      {loading ? "—" : total}
                    </span>
                    <span className="pb-1 text-sm text-slate-500 dark:text-slate-400">
                      {total === 1 ? "organization" : "organizations"}
                    </span>
                  </p>
                </div>
                <div className={theme.marketplace.utilityCard}>
                  <p className={theme.marketplace.utilityLabel}>
                    Visibility rule
                  </p>
                  <p className={theme.marketplace.utilityDescription}>
                    Only organizations with at least one published posting appear
                    here.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className={theme.marketplace.searchBody}>
            <form onSubmit={handleSubmit}>
              <div className={theme.marketplace.primarySearchShell}>
                <div className={theme.marketplace.primarySearchGrid}>
                  <div className={theme.marketplace.primaryInputWrap}>
                    <Search
                      className={`h-5 w-5 ${theme.marketplace.primaryInputIcon}`}
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={queryInput}
                      onChange={(event) => setQueryInput(event.target.value)}
                      placeholder="Search organizations by name"
                      aria-label="Search organizations by name"
                      className={theme.marketplace.primaryInput}
                    />
                    {queryInput ? (
                      <button
                        type="button"
                        onClick={clearSearch}
                        aria-label="Clear search"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-400 transition duration-200 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  <button
                    type="submit"
                    className={theme.marketplace.primaryButton}
                  >
                    Search
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>

        <section className={theme.marketplace.resultsShell}>
          <div className={theme.marketplace.resultsMeta}>
            {loading ? (
              <span>Loading organizations...</span>
            ) : total === 0 ? (
              <span>No public organizations found</span>
            ) : (
              <span>
                Showing {rangeStart}-{rangeEnd} of {total}{" "}
                {total === 1 ? "organization" : "organizations"}
              </span>
            )}
            <Link
              href="/dashboard/organizations"
              className="text-xs font-semibold text-violet-700 transition duration-200 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
            >
              Open workspace
            </Link>
          </div>

          {query ? (
            <div className={`mt-4 ${theme.marketplace.summary}`}>
              <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Filtered
              </span>
              <span className={theme.marketplace.summaryPill}>
                Search: {query}
              </span>
              <button
                type="button"
                onClick={clearSearch}
                className="ml-auto text-xs font-semibold text-violet-700 transition duration-200 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
              >
                Clear
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/50 dark:bg-rose-950/40">
              <p className="font-semibold text-rose-900 dark:text-rose-200">
                Directory unavailable
              </p>
              <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                {error}
              </p>
            </div>
          ) : null}

          {loading ? (
            <div className="mt-5 space-y-4">
              {[0, 1, 2].map((key) => (
                <div
                  key={key}
                  className="h-44 animate-pulse rounded-[1.5rem] bg-slate-100 dark:bg-slate-800"
                />
              ))}
            </div>
          ) : organizations.length > 0 ? (
            <div className="mt-5 space-y-4">
              {organizations.map((organization) => (
                <OrganizationCard
                  key={organization.id}
                  organization={organization}
                />
              ))}
            </div>
          ) : (
            <p className={theme.marketplace.resultsEmpty}>
              {query
                ? "No organizations matched your search. Try a broader name, or clear the filter to see the full directory."
                : "No public organizations yet. Check back once more organizations publish postings."}
            </p>
          )}

          {!loading && pagination && organizations.length > 0 ? (
            <div className="mt-6 flex items-center gap-2">
              {pagination.hasPreviousPage ? (
                <button
                  type="button"
                  onClick={() => updateRoute(query, pagination.page - 1)}
                  className={theme.marketplace.paginationButton}
                >
                  Previous
                </button>
              ) : (
                <span className={theme.marketplace.paginationButtonDisabled}>
                  Previous
                </span>
              )}

              <span className="px-2 text-sm text-slate-500 dark:text-slate-400">
                Page {pagination.page} of {pagination.totalPages || 1}
              </span>

              {pagination.hasNextPage ? (
                <button
                  type="button"
                  onClick={() => updateRoute(query, pagination.page + 1)}
                  className={theme.marketplace.paginationButton}
                >
                  Next
                </button>
              ) : (
                <span className={theme.marketplace.paginationButtonDisabled}>
                  Next
                </span>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
