"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
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
import { organizationHref } from "@/lib/organizations/urls";
import { formatOrganizationDate } from "@/components/organizations/organization-public-visuals";
import {
  AuthorAvatar,
  authorName,
  displayReadingMinutes,
} from "@/components/organizations/blog-visuals";
import { theme } from "@/styles/theme";

interface OrganizationBlogListPageProps {
  /** Organization id used for API calls. */
  id: string;
  /** Canonical slug used to build public links. Falls back to `id`. */
  organizationSlug?: string;
}

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

function PostMeta({
  post,
  className = "",
}: {
  post: OrganizationBlogPostRecord;
  className?: string;
}) {
  const published = post.publishedAt ?? post.createdAt;
  return (
    <div
      className={`flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 ${className}`}
    >
      <span className="flex items-center gap-2">
        <AuthorAvatar author={post.author} size="sm" />
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {authorName(post.author)}
        </span>
      </span>
      <span className="text-slate-300 dark:text-slate-600">·</span>
      <span className="inline-flex items-center gap-1">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
        {formatOrganizationDate(published, "long")}
      </span>
      <span className="text-slate-300 dark:text-slate-600">·</span>
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {displayReadingMinutes(post)} min read
      </span>
    </div>
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

function FeaturedPost({
  organizationSlug,
  post,
}: {
  organizationSlug: string;
  post: OrganizationBlogPostRecord;
}) {
  return (
    <Link
      href={organizationHref(organizationSlug, "blog", post.slug)}
      className="group mt-6 grid overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white/80 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-950/5 lg:grid-cols-2 dark:border-slate-800 dark:bg-slate-950/40"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100 lg:aspect-auto dark:bg-slate-900">
        {post.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImageUrl}
            alt=""
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-500/10 to-sky-500/10 text-violet-300 dark:text-violet-500">
            <Newspaper className="h-14 w-14" aria-hidden="true" />
          </div>
        )}
        <span className="absolute left-4 top-4 inline-flex items-center rounded-full bg-slate-950/80 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
          Featured
        </span>
      </div>
      <div className="flex flex-col justify-center gap-4 p-7 lg:p-9">
        <TagPills tags={post.tags} />
        <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950 group-hover:text-violet-700 sm:text-3xl dark:text-white dark:group-hover:text-violet-300">
          {post.title}
        </h2>
        {post.excerpt ? (
          <p className="line-clamp-3 text-base leading-7 text-slate-600 dark:text-slate-300">
            {post.excerpt}
          </p>
        ) : null}
        <PostMeta post={post} />
        <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 dark:text-violet-300">
          Read article
          <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </span>
      </div>
    </Link>
  );
}

function BlogCard({
  organizationSlug,
  post,
}: {
  organizationSlug: string;
  post: OrganizationBlogPostRecord;
}) {
  return (
    <Link
      href={organizationHref(organizationSlug, "blog", post.slug)}
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
            {displayReadingMinutes(post)} min
          </span>
        </div>
      </div>
    </Link>
  );
}

export function OrganizationBlogListPage({
  id,
  organizationSlug,
}: OrganizationBlogListPageProps) {
  const publicSlug = organizationSlug ?? id;
  const [result, setResult] = useState<OrganizationBlogResult | null>(null);
  const [page, setPage] = useState(1);
  const [activeTag, setActiveTag] = useState<string | null>(null);
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
        const nextResult = await organizationsApi.listPublicBlog(id, {
          page,
          ...(activeTag ? { tag: activeTag } : {}),
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
            action: "load this organization's blog",
            fallback: "We couldn't load these blog posts right now.",
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
  }, [id, page, activeTag, activeQuery]);

  const posts = result?.posts ?? [];
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    (result?.posts ?? []).forEach((post) =>
      post.tags.forEach((tag) => set.add(tag)),
    );
    return Array.from(set).slice(0, 8);
  }, [result]);

  const isFirstPage = page === 1 && !activeTag && !activeQuery;
  const featured = isFirstPage ? posts[0] : undefined;
  const gridPosts = featured ? posts.slice(1) : posts;

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
        href={organizationHref(publicSlug)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 transition duration-200 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to organization
      </Link>

      <header className="mt-8">
        <p className={theme.marketplace.eyebrow}>
          <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
          Blog
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-5xl dark:text-white">
          Stories &amp; updates
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300">
          News, guides, and announcements from our team.
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
              placeholder="Search posts…"
              aria-label="Search blog posts"
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

        {availableTags.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTag(null);
                setPage(1);
              }}
              className={
                activeTag === null
                  ? theme.marketplace.chipActive
                  : theme.marketplace.chip
              }
            >
              All
            </button>
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setActiveTag(tag);
                  setPage(1);
                }}
                className={
                  activeTag === tag
                    ? theme.marketplace.chipActive
                    : theme.marketplace.chip
                }
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {loading ? (
        <div className="mt-8 space-y-6">
          <div className="h-72 animate-pulse rounded-[1.75rem] bg-slate-200 dark:bg-slate-800" />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-80 animate-pulse rounded-[1.5rem] bg-slate-200 dark:bg-slate-800"
              />
            ))}
          </div>
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
            {activeQuery
              ? "No matching posts"
              : activeTag
                ? "No posts with this tag"
                : "No posts yet"}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            {activeQuery
              ? `No published posts matched “${activeQuery}”. Try a different search.`
              : activeTag
                ? "Try a different tag or view all posts."
                : "This organization hasn't published any blog posts yet. Check back soon."}
          </p>
        </section>
      ) : (
        <>
          {featured ? (
            <FeaturedPost organizationSlug={publicSlug} post={featured} />
          ) : null}

          {gridPosts.length > 0 ? (
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {gridPosts.map((post) => (
                <BlogCard
                  key={post.id}
                  organizationSlug={publicSlug}
                  post={post}
                />
              ))}
            </div>
          ) : null}

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
