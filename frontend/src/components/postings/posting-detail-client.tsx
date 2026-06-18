"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
import { ReportDialog } from "@/components/reports/report-dialog";
import { AvailabilityBadge } from "@/components/postings/availability-badge";
import { PostingDetailGallery } from "@/components/postings/posting-detail-gallery";
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
  }, [posting.id, reviewsPage]);

  return (
    <main className={theme.marketplace.page}>
      <div className={theme.marketplace.background} aria-hidden="true" />
      <div className={theme.marketplace.orbPrimary} aria-hidden="true" />
      <div className={theme.marketplace.orbSecondary} aria-hidden="true" />

      <div className={theme.marketplace.container}>
        <div className="mb-5">
          <Link
            href="/postings"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition duration-200 hover:text-violet-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to postings
          </Link>
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-950/5">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]">
            <div className="border-b border-slate-200 p-5 sm:p-6 lg:border-b-0 lg:border-r lg:p-7">
              <PostingDetailGallery
                photos={posting.photos}
                name={posting.name}
              />
            </div>

            <div className="bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_26%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-6 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <span className={theme.marketplace.metaBadge}>
                    {humanizePostingValue(posting.variant.family)}
                  </span>
                  <span className={theme.marketplace.metaBadge}>
                    {humanizePostingValue(posting.variant.subtype)}
                  </span>
                </div>

                <ReportDialog
                  subjectType="posting"
                  subjectId={posting.id}
                  subjectLabel="Posting"
                  triggerLabel="Report posting"
                />
              </div>

              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.055em] text-slate-950 sm:text-[2.8rem]">
                {posting.name}
              </h1>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <AvailabilityBadge status={posting.availabilityStatus} />
                <span className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                  {formatPostingPrice(
                    posting.pricing.daily.amount,
                    posting.pricing.currency,
                  )}
                </span>
                <span className="text-sm text-slate-500">per day</span>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <SummaryCard
                  icon={
                    <MapPin
                      className="h-4 w-4 text-violet-600"
                      aria-hidden="true"
                    />
                  }
                  label="Location"
                  value={locationLine}
                />
                <SummaryCard
                  icon={
                    <CalendarClock
                      className="h-4 w-4 text-violet-600"
                      aria-hidden="true"
                    />
                  }
                  label="Published"
                  value={publishedDate ?? "Recently added"}
                />
                <SummaryCard
                  icon={
                    <Clock3
                      className="h-4 w-4 text-violet-600"
                      aria-hidden="true"
                    />
                  }
                  label="Booking window"
                  value={`${posting.effectiveMaxBookingDurationDays} day max`}
                />
                <SummaryCard
                  icon={
                    <Package
                      className="h-4 w-4 text-violet-600"
                      aria-hidden="true"
                    />
                  }
                  label="Listing type"
                  value={humanizePostingValue(posting.variant.subtype)}
                />
              </div>

              <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white/90 p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Overview
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-600">
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
                  className="h-4 w-4 text-violet-600"
                  aria-hidden="true"
                />
              }
              title="About this posting"
              description="The essentials a renter would want to review before reaching out."
            >
              <p className="text-sm leading-8 text-slate-600">
                {posting.description}
              </p>
            </Panel>

            <Panel
              icon={
                <Package
                  className="h-4 w-4 text-violet-600"
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
                      className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 px-4 py-3"
                    >
                      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                        {formatPostingAttributeLabel(key)}
                      </dt>
                      <dd className="mt-2 text-sm font-medium text-slate-700">
                        {formatPostingAttributeValue(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-slate-500">
                  No additional details were provided.
                </p>
              )}
            </Panel>

            <Panel
              icon={
                <Star className="h-4 w-4 text-violet-600" aria-hidden="true" />
              }
              title="Reviews"
              description="Recent renter feedback for this posting."
            >
              {reviewsLoading ? (
                <p className="text-sm text-slate-500">Loading reviews...</p>
              ) : reviewsError ? (
                <p className="rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {reviewsError}
                </p>
              ) : reviewsResult && reviewsResult.reviews.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3 rounded-[1.25rem] border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-950">
                      {reviewsResult.summary.averageRating.toFixed(1)} average
                      rating
                    </p>
                    <p className="text-sm text-slate-500">
                      {reviewsResult.summary.reviewCount} review
                      {reviewsResult.summary.reviewCount === 1 ? "" : "s"}
                    </p>
                  </div>

                  {reviewsResult.reviews.map((review) => (
                    <article
                      key={review.id}
                      className="rounded-[1.4rem] border border-slate-200 bg-white px-4 py-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-950">
                              {review.title ?? "Review"}
                            </p>
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
                              {review.rating}/5
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-7 text-slate-600">
                            {review.comment ?? "No written comment was shared."}
                          </p>
                          <p className="mt-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
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
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                          />
                          <ReportDialog
                            subjectType="user"
                            subjectId={review.reviewerId}
                            subjectLabel="User"
                            triggerLabel="Report user"
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                          />
                        </div>
                      </div>
                    </article>
                  ))}

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-500">
                      Page {reviewsResult.pagination.page} of{" "}
                      {reviewsResult.pagination.totalPages}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setNextReviewsPage((current) =>
                            Math.max(1, current - 1),
                          )
                        }
                        disabled={!reviewsResult.pagination.hasPreviousPage}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNextReviewsPage((current) =>
                            reviewsResult.pagination.hasNextPage
                              ? current + 1
                              : current,
                          )
                        }
                        disabled={!reviewsResult.pagination.hasNextPage}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  No reviews have been shared for this posting yet.
                </p>
              )}
            </Panel>
          </div>

          <div className="space-y-6">
            {posting.organization ? (
              <Panel
                icon={
                  <Building2
                    className="h-4 w-4 text-violet-600"
                    aria-hidden="true"
                  />
                }
                title="Organization"
                description="The team responsible for this posting."
              >
                <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                  <p className="text-lg font-semibold text-slate-950">
                    {posting.organization.name}
                  </p>
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
                  className="h-4 w-4 text-violet-600"
                  aria-hidden="true"
                />
              }
              title="Location"
              description="Where this posting is based."
            >
              <div className="space-y-3 text-sm text-slate-600">
                <p>{locationLine}</p>
                {posting.location.postalCode ? (
                  <p>Postal code: {posting.location.postalCode}</p>
                ) : null}
              </div>
            </Panel>

            <Panel
              icon={
                <CalendarClock
                  className="h-4 w-4 text-violet-600"
                  aria-hidden="true"
                />
              }
              title="Availability"
              description="Current booking posture for this posting."
            >
              <div className="space-y-4 text-sm text-slate-600">
                <div className="flex flex-wrap items-center gap-3">
                  <AvailabilityBadge status={posting.availabilityStatus} />
                  <span>
                    {posting.effectiveMaxBookingDurationDays} day maximum
                    booking
                  </span>
                </div>
                {posting.availabilityNotes ? (
                  <p className="rounded-[1.25rem] border border-slate-200 bg-slate-50/70 px-4 py-3">
                    {posting.availabilityNotes}
                  </p>
                ) : (
                  <p>No extra availability notes were added.</p>
                )}
              </div>
            </Panel>

            <Panel
              icon={
                <Tags className="h-4 w-4 text-violet-600" aria-hidden="true" />
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
                <p className="text-sm text-slate-500">
                  No tags were added to this posting.
                </p>
              )}
            </Panel>

            <Panel
              icon={
                <ShieldAlert
                  className="h-4 w-4 text-violet-600"
                  aria-hidden="true"
                />
              }
              title="Safety"
              description="If something feels off, you can report the listing, a review, or a user."
            >
              <p className="text-sm leading-7 text-slate-600">
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
    <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-700">{value}</p>
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
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50">
          {icon}
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}
