import type { ReactNode } from "react";
import Link from "next/link";
import { AvailabilityBadge } from "@/components/postings/availability-badge";
import { InstantBookBadge } from "@/components/postings/instant-book-badge";
import { organizationHref } from "@/lib/organizations/urls";
import {
  formatPostingPrice,
  formatPublishedDate,
  humanizePostingValue,
  isRenderablePreviewImageUrl,
} from "@/lib/postings/public-format";
import type { PublicPostingSummary } from "@/lib/postings/search";
import { theme } from "@/styles/theme";

// Intentionally not a "use client" module. The search page renders this as a
// server component (only the `actions` island hydrates); the saved-postings
// page renders the very same component inside its own client tree.
interface PostingResultCardProps {
  posting: PublicPostingSummary;
  /**
   * Builds the href for the "Only this organization" chip. Omit it on pages
   * without a search query string, and the chip is not rendered.
   */
  buildOrganizationFilterHref?: (organizationId: string) => string;
  /** Rendered at the start of the top-right badge cluster. */
  actions?: ReactNode;
}

export function PostingResultCard({
  posting,
  buildOrganizationFilterHref,
  actions,
}: PostingResultCardProps) {
  const publishedDate = formatPublishedDate(posting.publishedAt);
  const previewImageUrl = [
    posting.primaryThumbnailUrl,
    posting.primaryPhotoUrl,
  ].find(isRenderablePreviewImageUrl);
  const organization = posting.organization;

  return (
    <article className={theme.marketplace.resultCard}>
      <div className="grid gap-0 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="relative min-h-48 border-b border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 md:min-h-full md:border-b-0 md:border-r">
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
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap gap-2">
                <span className={theme.marketplace.metaBadge}>
                  {humanizePostingValue(posting.variant.family)}
                </span>
                <span className={theme.marketplace.metaBadge}>
                  {humanizePostingValue(posting.variant.subtype)}
                </span>
              </div>

              <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
                {posting.name}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {actions}
              <AvailabilityBadge status={posting.availabilityStatus} />
              <InstantBookBadge instantBooking={posting.instantBooking} />
              <span className="text-lg font-semibold text-slate-950 dark:text-white">
                {formatPostingPrice(
                  posting.pricing.daily.amount,
                  posting.pricing.currency,
                )}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  {" "}
                  / day
                </span>
              </span>
            </div>
          </div>

          <p className="mt-3 line-clamp-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {posting.description}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
            <span className={theme.marketplace.metaBadge}>
              {posting.location.city}, {posting.location.region},{" "}
              {posting.location.country}
            </span>
            {publishedDate ? (
              <span className={theme.marketplace.metaBadge}>
                Published {publishedDate}
              </span>
            ) : null}
            <span className={theme.marketplace.metaBadge}>
              ID: {posting.id}
            </span>
          </div>

          {organization ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <span className="text-slate-500 dark:text-slate-400">
                Offered by{" "}
                <Link
                  href={
                    organization.slug
                      ? organizationHref(organization.slug)
                      : `/organizations/${organization.id}`
                  }
                  className="font-semibold text-slate-700 dark:text-slate-200 transition duration-200 hover:text-violet-700 dark:hover:text-violet-300"
                >
                  {organization.name}
                </Link>
              </span>
              {buildOrganizationFilterHref ? (
                <Link
                  href={buildOrganizationFilterHref(organization.id)}
                  className={theme.marketplace.chip}
                >
                  Only this organization
                </Link>
              ) : null}
            </div>
          ) : null}

          {posting.tags.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {posting.tags.map((tag) => (
                <span key={tag} className={theme.marketplace.summaryPill}>
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Review pricing, availability, and listing details.
            </p>
            <Link
              href={`/postings/${posting.id}`}
              className={theme.marketplace.paginationButton}
            >
              View details
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
