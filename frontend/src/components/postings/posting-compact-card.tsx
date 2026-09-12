import type { ReactNode } from "react";
import Link from "next/link";
import { AvailabilityBadge } from "@/components/postings/availability-badge";
import {
  formatPostingPrice,
  isRenderablePreviewImageUrl,
} from "@/lib/postings/public-format";
import type { PublicPostingSummary } from "@/lib/postings/search";
import { theme } from "@/styles/theme";

// A sibling of PostingResultCard rather than a variant of it. That component is
// a wide list row -- two-column layout, description, tags, published date, an
// id line and an action bar -- and this tile keeps four of those elements. A
// `variant` prop would fork its whole tree for two call sites that both want
// the row. Deliberately not a "use client" module, for the same reason as its
// sibling: the browse page renders it inside a server tree.
interface PostingCompactCardProps {
  posting: PublicPostingSummary;
  /** Small line under the price. Used for "Viewed 2 days ago". */
  footnote?: ReactNode;
  /** Rendered in the top-right corner of the media area. */
  actions?: ReactNode;
}

export function PostingCompactCard({
  posting,
  footnote,
  actions,
}: PostingCompactCardProps) {
  const previewImageUrl = [
    posting.primaryThumbnailUrl,
    posting.primaryPhotoUrl,
  ].find(isRenderablePreviewImageUrl);

  return (
    <article
      className={`${theme.marketplace.resultCard} relative flex h-full flex-col`}
    >
      <div className="relative aspect-[4/3] w-full shrink-0 border-b border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800">
        {previewImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewImageUrl}
            alt={posting.name}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className={theme.marketplace.resultFallback}>No Image</div>
        )}

        {actions ? (
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
            {actions}
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-6 tracking-[-0.02em] text-slate-950 dark:text-white">
          <Link
            href={`/postings/${posting.id}`}
            className="transition duration-200 hover:text-violet-700 dark:hover:text-violet-300"
          >
            {/* Stretches the link over the whole tile so the entire card is
                clickable, while the remove control above stays on top of it. */}
            <span className="absolute inset-0" aria-hidden="true" />
            {posting.name}
          </Link>
        </h3>

        <p className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
          {posting.location.city}, {posting.location.region}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="text-sm font-semibold text-slate-950 dark:text-white">
            {formatPostingPrice(
              posting.pricing.daily.amount,
              posting.pricing.currency,
            )}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              {" "}
              / day
            </span>
          </span>
          <AvailabilityBadge status={posting.availabilityStatus} />
        </div>

        {footnote ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {footnote}
          </p>
        ) : null}
      </div>
    </article>
  );
}
