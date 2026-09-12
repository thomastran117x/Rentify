"use client";

import Link from "next/link";
import { History } from "lucide-react";
import { PostingCompactCard } from "@/components/postings/posting-compact-card";
import { useRecentlyViewed } from "@/components/postings/recently-viewed-context";
import { theme } from "@/styles/theme";

interface RecentlyViewedRowProps {
  surface: "home" | "browse";
  limit?: number;
}

/**
 * A horizontal strip of the visitor's recently viewed postings.
 *
 * Renders nothing at all -- not a skeleton -- in every state that is not "I
 * have at least one card to show". That is what lets it be dropped onto the
 * marketing home page without teaching that page about auth: the store's
 * server snapshot is empty, so SSR and the first client render both produce
 * null and a first-time visitor's page is byte-identical to before. A skeleton
 * here would shift the layout of a page most visitors see with no history.
 */
export function RecentlyViewedRow({
  surface,
  limit = 12,
}: RecentlyViewedRowProps) {
  const { status, postings } = useRecentlyViewed();

  if (status !== "ready" || postings.length === 0) {
    return null;
  }

  const visible = postings.slice(0, limit);

  return (
    <section
      aria-labelledby={`recently-viewed-${surface}`}
      className="mt-10 first:mt-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id={`recently-viewed-${surface}`}
          className="flex items-center gap-2 text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-white"
        >
          <History
            className="h-5 w-5 text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          />
          Recently viewed
        </h2>
        <Link href="/saved/recent" className={theme.marketplace.chip}>
          See all
        </Link>
      </div>

      {/* Scrolls inside itself so a long history never makes the page scroll
          sideways. */}
      <ul
        className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
        role="list"
      >
        {visible.map((posting) => (
          <li
            key={posting.id}
            className="w-[15rem] shrink-0 snap-start sm:w-[16rem]"
          >
            <PostingCompactCard posting={posting} />
          </li>
        ))}
      </ul>
    </section>
  );
}
