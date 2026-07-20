"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Newspaper,
  Search,
  X,
} from "lucide-react";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type OrganizationBlogPostRecord,
  type OrganizationBlogResult,
} from "@/lib/organizations/api";
import {
  AuthorAvatar,
  authorName,
  readingTimeMinutes,
} from "@/components/organizations/blog-visuals";
import { theme } from "@/styles/theme";

function PageChrome({ children }: { children: React.ReactNode }) {
  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.orbPrimary} aria-hidden="true" />
      <div className={theme.marketplace.orbSecondary} aria-hidden="true" />
      <div className={theme.marketplace.container}>{children}</div>
    </main>
  );
}

function TagPills({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.slice(0, 3).map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function FeedCard({ post }: { post: OrganizationBlogPostRecord }) {
  const organizationId = post.organization?.id ?? post.organizationId;
  const organizationName = post.organization?.name;

  return (
    <Link
      href={`/organizations/${organizationId}/blog/${post.slug}`}
      className="group flex flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white/80 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-950/5 dark:border-slate-800 dark:bg-slate-950/40"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100 dark:bg-slate-900">
        {post.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImageUrl}
            alt=""
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-500/10 to-sky-500/10 text-violet-300 dark:text-violet-500">
            <Newspaper className="h-10 w-10" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        {organizationName ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
            {organizationName}
          </span>
        ) : null}
        <TagPills tags={post.tags} />
        <h2 className="text-lg font-semibold leading-snug tracking-[-0.02em] text-slate-950 group-hover:text-violet-700 dark:text-white dark:group-hover:text-violet-300">
          {post.title}
        </h2>
        {post.excerpt ? (
          <p className="line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {post.excerpt}
          </p>
        ) : null}
        <div className="mt-auto flex items-center gap-2 pt-2 text-xs text-slate-500 dark:text-slate-400">
          <AuthorAvatar author={post.author} size="sm" />
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {authorName(post.author)}
          </span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {readingTimeMinutes(post.body)} min
          </span>
        </div>
      </div>
    </Link>
  );
}

export function BlogSearchPage() {
  const [result, setResult] = useState<OrganizationBlogResult | null>(null);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPosts() {
      setLoading(true);
      setError(null);

      try {
        const nextResult = await organizationsApi.searchBlogFeed({
          page,
          ...(activeQuery ? { q: activeQuery } : {}),
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
            action: "load the blog feed",
            fallback: "We couldn't load blog posts right now.",
          }),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadPosts();

    return () => {
      active = false;
    };
  }, [page, activeQuery]);

  const posts = result?.posts ?? [];

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = searchTerm.trim();
    setActiveQuery(trimmed ? trimmed : null);
    setPage(1);
  }

  function clearSearch() {
    setSearchTerm("");
    setActiveQuery(null);
    setPage(1);
  }

  return (
    <PageChrome>
      <Link
        href="/organizations"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 transition duration-200 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Browse organizations
      </Link>

      <header className="mt-8">
        <p className={theme.marketplace.eyebrow}>
          <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
          Blog
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-5xl dark:text-white">
          Stories from every organization
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300">
          Search published news, guides, and announcements across the whole
          marketplace.
        </p>

        <form onSubmit={submitSearch} className="mt-6 flex max-w-xl gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search all blog posts…"
              aria-label="Search all blog posts"
              className="w-full rounded-full border border-slate-200 bg-white/80 py-2.5 pl-10 pr-10 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:ring-violet-900"
            />
            {activeQuery ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <button type="submit" className={theme.marketplace.paginationButton}>
            Search
          </button>
        </form>
      </header>

      {loading ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <div
              key={key}
              className="h-80 animate-pulse rounded-[1.5rem] bg-slate-200 dark:bg-slate-800"
            />
          ))}
        </div>
      ) : error ? (
        <section className={`${theme.marketplace.resultsShell} mt-8`}>
          <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
            {error}
          </p>
        </section>
      ) : posts.length === 0 ? (
        <section className={`${theme.marketplace.resultsShell} mt-8`}>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
            <Newspaper className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
            {activeQuery ? "No matching posts" : "No posts yet"}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            {activeQuery
              ? `No published posts matched “${activeQuery}”. Try a different search.`
              : "No organizations have published blog posts yet. Check back soon."}
          </p>
        </section>
      ) : (
        <>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <FeedCard key={post.id} post={post} />
            ))}
          </div>

          {result && result.pagination.totalPages > 1 ? (
            <div className="mt-10 flex items-center justify-between border-t border-slate-200 pt-6 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={!result.pagination.hasPreviousPage}
                className={
                  result.pagination.hasPreviousPage
                    ? theme.marketplace.paginationButton
                    : theme.marketplace.paginationButtonDisabled
                }
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </button>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Page {result.pagination.page} of {result.pagination.totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={!result.pagination.hasNextPage}
                className={
                  result.pagination.hasNextPage
                    ? theme.marketplace.paginationButton
                    : theme.marketplace.paginationButtonDisabled
                }
              >
                Next
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </>
      )}
    </PageChrome>
  );
}
