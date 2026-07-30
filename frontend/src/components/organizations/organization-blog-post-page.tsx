"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Clock, Newspaper } from "lucide-react";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type OrganizationBlogPostRecord,
} from "@/lib/organizations/api";
import { organizationHref } from "@/lib/organizations/urls";
import { formatOrganizationDate } from "@/components/organizations/organization-public-visuals";
import {
  AuthorAvatar,
  authorName,
  readingTimeMinutes,
} from "@/components/organizations/blog-visuals";
import { theme } from "@/styles/theme";

interface OrganizationBlogPostPageProps {
  /** Organization id used for API calls. */
  id: string;
  /** Blog post slug. */
  slug: string;
  /** Canonical organization slug used to build public links. Falls back to `id`. */
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

export function OrganizationBlogPostPage({
  id,
  slug,
  organizationSlug,
}: OrganizationBlogPostPageProps) {
  const publicSlug = organizationSlug ?? id;
  const [post, setPost] = useState<OrganizationBlogPostRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadPost() {
      setLoading(true);
      setError(null);

      try {
        const nextPost = await organizationsApi.getPublicBlogPost(id, slug);

        if (!active) {
          return;
        }

        setPost(nextPost);
      } catch (nextError) {
        if (!active) {
          return;
        }

        setError(
          getApiErrorMessage(nextError, {
            action: "load this blog post",
            fallback: "We couldn't load this blog post right now.",
          }),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadPost();

    return () => {
      active = false;
    };
  }, [id, slug]);

  if (loading) {
    return (
      <PageChrome>
        <div className="mx-auto max-w-[760px] space-y-5">
          <div className="h-5 w-40 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
          <div className="h-10 w-3/4 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
          <div className="h-72 animate-pulse rounded-[1.75rem] bg-slate-200 dark:bg-slate-800" />
          <div className="space-y-3">
            {[0, 1, 2, 3].map((key) => (
              <div
                key={key}
                className="h-4 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800"
              />
            ))}
          </div>
        </div>
      </PageChrome>
    );
  }

  if (error || !post) {
    return (
      <PageChrome>
        <Link
          href={organizationHref(publicSlug, "blog")}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 transition duration-200 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to blog
        </Link>
        <section className={`${theme.marketplace.resultsShell} mt-6`}>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
            <Newspaper className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
            Post unavailable
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300">
            {error ?? "This blog post could not be found or is not published."}
          </p>
        </section>
      </PageChrome>
    );
  }

  const published = post.publishedAt ?? post.createdAt;

  return (
    <PageChrome>
      <div className="mx-auto max-w-[760px]">
        <Link
          href={organizationHref(publicSlug, "blog")}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 transition duration-200 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to blog
        </Link>

        <article className="mt-8">
          <header>
            {post.tags.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-2">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}

            <h1 className="mt-5 text-center text-4xl font-semibold leading-[1.1] tracking-[-0.045em] text-slate-950 sm:text-[2.75rem] dark:text-white">
              {post.title}
            </h1>

            {post.excerpt ? (
              <p className="mx-auto mt-5 max-w-2xl text-center text-lg leading-8 text-slate-600 dark:text-slate-300">
                {post.excerpt}
              </p>
            ) : null}

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3 text-sm text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-2">
                <AuthorAvatar author={post.author} size="md" />
                <span className="font-semibold text-slate-800 dark:text-slate-100">
                  {authorName(post.author)}
                </span>
              </span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                {formatOrganizationDate(published, "long")}
              </span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" aria-hidden="true" />
                {readingTimeMinutes(post.body)} min read
              </span>
            </div>
          </header>

          {post.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.coverImageUrl}
              alt=""
              className="mt-9 max-h-[460px] w-full rounded-[1.75rem] object-cover shadow-sm ring-1 ring-slate-200 dark:ring-slate-800"
            />
          ) : (
            <hr className="mt-9 border-slate-200 dark:border-slate-800" />
          )}

          {/*
            The body is authoritative-sanitized on the backend (allowlist HTML)
            before it is ever stored, so the public HTML is safe to render here.
          */}
          <div
            className="rich-text mt-10 text-[1.075rem] leading-8 text-slate-700 dark:text-slate-200"
            dangerouslySetInnerHTML={{ __html: post.body }}
          />
        </article>

        <footer className="mt-12 border-t border-slate-200 pt-8 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <AuthorAvatar author={post.author} size="lg" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Written by {authorName(post.author)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Published {formatOrganizationDate(published, "long")}
              </p>
            </div>
          </div>
          <Link
            href={organizationHref(publicSlug, "blog")}
            className={`${theme.marketplace.paginationButton} mt-6`}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to all posts
          </Link>
        </footer>
      </div>
    </PageChrome>
  );
}
