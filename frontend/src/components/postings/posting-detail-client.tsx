"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Clock3,
  MapPin,
  Package,
  ScrollText,
  ShieldAlert,
  Star,
  Building2,
  Tags,
} from "lucide-react";
import { Pagination } from "@/components/common/pagination";
import { ReportDialog } from "@/components/reports/report-dialog";
import { AvailabilityBadge } from "@/components/postings/availability-badge";
import { InstantBookBadge } from "@/components/postings/instant-book-badge";
import { SavePostingButton } from "@/components/postings/save-posting-button";
import { BookingRequestPanel } from "@/components/bookings/booking-request-panel";
import { PostingDetailGallery } from "@/components/postings/posting-detail-gallery";
import { PostingReviewForm } from "@/components/reviews/posting-review-form";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  fetchPublicPostingReviews,
  type ListPublicPostingReviewsResult,
  type PublicPostingDetail,
} from "@/lib/postings/public";
import {
  formatPostingAttributeLabel,
  formatPostingAttributeValue,
  formatPostingPrice,
  formatPublishedDate,
  humanizePostingValue,
} from "@/lib/postings/public-format";
import { formatExpiryDate } from "@/lib/postings/expiry";
import { organizationHref } from "@/lib/organizations/urls";
import { theme } from "@/styles/theme";

function formatReviewDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

interface PostingDetailClientProps {
  posting: PublicPostingDetail;
}

export function PostingDetailClient({ posting }: PostingDetailClientProps) {
  const publishedDate = formatPublishedDate(posting.publishedAt);
  const detailEntries = Object.entries(posting.details);
  const locationLine = [
    posting.location.city,
    posting.location.region,
    posting.location.country,
  ]
    .filter(Boolean)
    .join(", ");
  const [reviewsPage, setReviewsPage] = useState(1);
  const [reviewsResult, setReviewsResult] =
    useState<ListPublicPostingReviewsResult | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [reviewsRefreshToken, setReviewsRefreshToken] = useState(0);

  // Bumping the token refetches even when the viewer is already on page 1,
  // which is the common case right after submitting a review.
  const refreshReviews = useCallback(() => {
    setReviewsLoading(true);
    setReviewsError(null);
    setReviewsPage(1);
    setReviewsRefreshToken((token) => token + 1);
  }, []);

  function setNextReviewsPage(
    updater: number | ((current: number) => number),
  ): void {
    setReviewsLoading(true);
    setReviewsError(null);
    setReviewsPage((current) =>
      typeof updater === "function"
        ? (updater as (value: number) => number)(current)
        : updater,
    );
  }

  useEffect(() => {
    let active = true;

    void fetchPublicPostingReviews(posting.id, reviewsPage, 5)
      .then((result) => {
        if (active) {
          setReviewsResult(result);
        }
      })
      .catch((error) => {
        if (active) {
          setReviewsError(
            getApiErrorMessage(error, {
              action: "load reviews for this posting",
              fallback:
                "We couldn't load reviews for this posting right now. Please try again.",
            }),
          );
        }
      })
      .finally(() => {
        if (active) {
          setReviewsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [posting.id, reviewsPage, reviewsRefreshToken]);

  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.orbPrimary} aria-hidden="true" />
      <div className={theme.marketplace.orbSecondary} aria-hidden="true" />

      <div className={theme.marketplace.container}>
        <div className="mb-5">
          <Link
            href="/postings"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 transition duration-200 hover:text-violet-700 dark:hover:text-violet-300"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to postings
          </Link>
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl shadow-slate-950/5">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]">
            <div className="border-b border-slate-200 dark:border-slate-800 p-5 sm:p-6 lg:border-b-0 lg:border-r lg:p-7">
              <PostingDetailGallery
                photos={posting.photos}
                name={posting.name}
              />
            </div>

            <div className="bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_26%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-6 sm:p-7 dark:bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.16),transparent_28%),linear-gradient(180deg,#0f172a_0%,#020617_100%)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <span className={theme.marketplace.metaBadge}>
                    {humanizePostingValue(posting.variant.family)}
                  </span>
                  <span className={theme.marketplace.metaBadge}>
                    {humanizePostingValue(posting.variant.subtype)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <SavePostingButton
                    postingId={posting.id}
                    postingName={posting.name}
                    variant="labelled"
                  />
                  <ReportDialog
                    subjectType="posting"
                    subjectId={posting.id}
                    subjectLabel="Posting"
                    triggerLabel="Report posting"
                  />
                </div>
              </div>

              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.055em] text-slate-950 dark:text-white sm:text-[2.8rem]">
                {posting.name}
              </h1>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <AvailabilityBadge status={posting.availabilityStatus} />
                <InstantBookBadge instantBooking={posting.instantBooking} />
                <span className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                  {formatPostingPrice(
                    posting.pricing.daily.amount,
                    posting.pricing.currency,
                  )}
                </span>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  per day
                </span>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <SummaryCard
                  icon={
                    <MapPin
                      className="h-4 w-4 text-violet-600 dark:text-violet-400"
                      aria-hidden="true"
                    />
                  }
                  label="Location"
                  value={locationLine}
                />
                <SummaryCard
                  icon={
                    <CalendarClock
                      className="h-4 w-4 text-violet-600 dark:text-violet-400"
                      aria-hidden="true"
                    />
                  }
                  label="Published"
                  value={publishedDate ?? "Recently added"}
                />
                <SummaryCard
                  icon={
                    <Clock3
                      className="h-4 w-4 text-violet-600 dark:text-violet-400"
                      aria-hidden="true"
                    />
                  }
                  label="Booking window"
                  value={`${posting.effectiveMaxBookingDurationDays} day max`}
                />
                <SummaryCard
                  icon={
                    <Package
                      className="h-4 w-4 text-violet-600 dark:text-violet-400"
                      aria-hidden="true"
                    />
                  }
                  label="Listing type"
                  value={humanizePostingValue(posting.variant.subtype)}
                />
              </div>

              <div className="mt-6 rounded-[1.5rem] border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                  Overview
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">
                  {posting.description}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_24rem]">
          <div className="space-y-6">
            <Panel
              icon={
                <ScrollText
                  className="h-4 w-4 text-violet-600 dark:text-violet-400"
                  aria-hidden="true"
                />
              }
              title="About this posting"
              description="The essentials a renter would want to review before reaching out."
            >
              <p className="text-sm leading-8 text-slate-600 dark:text-slate-300">
                {posting.description}
              </p>
            </Panel>

            <Panel
              icon={
                <Package
                  className="h-4 w-4 text-violet-600 dark:text-violet-400"
                  aria-hidden="true"
                />
              }
              title="Details"
              description="Variant-specific details for this listing."
            >
              {detailEntries.length > 0 ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {detailEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-[1.25rem] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 px-4 py-3"
                    >
                      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                        {formatPostingAttributeLabel(key)}
                      </dt>
                      <dd className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                        {formatPostingAttributeValue(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No additional details were provided.
                </p>
              )}
            </Panel>

            <Panel
              icon={
                <Star
                  className="h-4 w-4 text-violet-600 dark:text-violet-400"
                  aria-hidden="true"
                />
              }
              title="Reviews"
              description="Recent renter feedback for this posting."
            >
              <PostingReviewForm
                postingId={posting.id}
                onSaved={refreshReviews}
                className="mb-5"
              />

              {reviewsLoading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Loading reviews...
                </p>
              ) : reviewsError ? (
                <p className="rounded-[1.25rem] border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-300">
                  {reviewsError}
                </p>
              ) : reviewsResult && reviewsResult.reviews.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3 rounded-[1.25rem] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-950 dark:text-white">
                      {reviewsResult.summary.averageRating.toFixed(1)} average
                      rating
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {reviewsResult.summary.reviewCount} review
                      {reviewsResult.summary.reviewCount === 1 ? "" : "s"}
                    </p>
                  </div>

                  {reviewsResult.reviews.map((review) => (
                    <article
                      key={review.id}
                      className="rounded-[1.4rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-950 dark:text-white">
                              {review.title ?? "Review"}
                            </p>
                            <span className="rounded-full bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
                              {review.rating}/5
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
                            {review.comment ?? "No written comment was shared."}
                          </p>
                          <p className="mt-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                            {review.reviewer.username ?? "Anonymous renter"} ·{" "}
                            {formatReviewDate(review.createdAt)}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <ReportDialog
                            subjectType="posting_review"
                            subjectId={review.id}
                            subjectLabel="Review"
                            triggerLabel="Report review"
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800"
                          />
                          <ReportDialog
                            subjectType="user"
                            subjectId={review.reviewerId}
                            subjectLabel="User"
                            triggerLabel="Report user"
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-rose-200 dark:border-rose-900/50 bg-white dark:bg-slate-900 px-4 text-sm font-semibold text-rose-700 dark:text-rose-300 transition hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          />
                        </div>
                      </div>
                    </article>
                  ))}

                  {/* Fixed page size: no size selector, no page jump. */}
                  <Pagination
                    pagination={reviewsResult.pagination}
                    itemLabel={{ one: "review", other: "reviews" }}
                    ariaLabel="Reviews pagination"
                    disabled={reviewsLoading}
                    onPageChange={setNextReviewsPage}
                  />
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No reviews have been shared for this posting yet.
                </p>
              )}
            </Panel>
          </div>

          <div className="space-y-6">
            <BookingRequestPanel posting={posting} />

            {posting.organization ? (
              <Panel
                icon={
                  <Building2
                    className="h-4 w-4 text-violet-600 dark:text-violet-400"
                    aria-hidden="true"
                  />
                }
                title="Organization"
                description="The team responsible for this posting."
              >
                <div className="rounded-[1.4rem] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 px-4 py-4">
                  <p className="text-lg font-semibold text-slate-950 dark:text-white">
                    <Link
                      href={
                        posting.organization.slug
                          ? organizationHref(posting.organization.slug)
                          : `/organizations/${posting.organization.id}`
                      }
                      className="transition duration-200 hover:text-violet-700 dark:hover:text-violet-300"
                    >
                      {posting.organization.name}
                    </Link>
                  </p>
                  <Link
                    href={`/postings?organizationId=${encodeURIComponent(posting.organization.id)}&sort=newest&page=1&pageSize=20`}
                    className="mt-1 inline-block text-sm font-medium text-violet-700 dark:text-violet-300 transition duration-200 hover:text-violet-800 dark:hover:text-violet-200"
                  >
                    See all postings from {posting.organization.name}
                  </Link>
                  <div className="mt-4">
                    <ReportDialog
                      subjectType="posting"
                      subjectId={posting.id}
                      subjectLabel="Posting"
                      triggerLabel="Report posting"
                    />
                  </div>
                </div>
              </Panel>
            ) : null}

            <Panel
              icon={
                <MapPin
                  className="h-4 w-4 text-violet-600 dark:text-violet-400"
                  aria-hidden="true"
                />
              }
              title="Location"
              description="Where this posting is based."
            >
              <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p>{locationLine}</p>
                {posting.location.postalCode ? (
                  <p>Postal code: {posting.location.postalCode}</p>
                ) : null}
              </div>
            </Panel>

            <Panel
              icon={
                <CalendarClock
                  className="h-4 w-4 text-violet-600 dark:text-violet-400"
                  aria-hidden="true"
                />
              }
              title="Availability"
              description="Current booking posture for this posting."
            >
              <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
                <div className="flex flex-wrap items-center gap-3">
                  <AvailabilityBadge status={posting.availabilityStatus} />
                  <span>
                    {posting.effectiveMaxBookingDurationDays} day maximum
                    booking
                  </span>
                  {posting.minBookingDurationDays ? (
                    <span>
                      {posting.minBookingDurationDays} day minimum booking
                    </span>
                  ) : null}
                  {posting.advanceNoticeDays != null ? (
                    <span>
                      {posting.advanceNoticeDays === 0
                        ? "Same-day booking allowed"
                        : `${posting.advanceNoticeDays} day${posting.advanceNoticeDays === 1 ? "" : "s"} advance notice required`}
                    </span>
                  ) : null}
                  <InstantBookBadge instantBooking={posting.instantBooking} />
                </div>
                {posting.expiresAt ? (
                  <p className="rounded-[1.25rem] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 px-4 py-3">
                    Available until {formatExpiryDate(posting.expiresAt)}
                  </p>
                ) : null}
                {posting.availabilityNotes ? (
                  <p className="rounded-[1.25rem] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 px-4 py-3">
                    {posting.availabilityNotes}
                  </p>
                ) : (
                  <p>No extra availability notes were added.</p>
                )}
                {posting.cancellationPolicy ? (
                  <div className="rounded-[1.25rem] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 px-4 py-3">
                    <p className="font-medium capitalize">
                      {posting.cancellationPolicy} cancellation policy
                    </p>
                    {posting.cancellationPolicyNotes ? (
                      <p className="mt-1 text-slate-500 dark:text-slate-400">
                        {posting.cancellationPolicyNotes}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel
              icon={
                <Tags
                  className="h-4 w-4 text-violet-600 dark:text-violet-400"
                  aria-hidden="true"
                />
              }
              title="Tags"
              description="Helpful keywords associated with the posting."
            >
              {posting.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {posting.tags.map((tag) => (
                    <span key={tag} className={theme.marketplace.summaryPill}>
                      {formatPostingAttributeValue(tag)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No tags were added to this posting.
                </p>
              )}
            </Panel>

            <Panel
              icon={
                <ShieldAlert
                  className="h-4 w-4 text-violet-600 dark:text-violet-400"
                  aria-hidden="true"
                />
              }
              title="Safety"
              description="If something feels off, you can report the listing, a review, or a user."
            >
              <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
                Reports go to the moderation queue with your selected reason,
                title, and description so the team can review the issue quickly.
              </p>
            </Panel>
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.35rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        {value}
      </p>
    </div>
  );
}

function Panel({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm sm:p-7">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50 dark:bg-violet-950/40">
          {icon}
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}
