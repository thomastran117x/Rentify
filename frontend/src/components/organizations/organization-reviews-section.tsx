"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Star } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Pagination } from "@/components/common/pagination";
import type { Pagination as PaginationMeta } from "@/lib/api/types";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type OrganizationReviewRecord,
  type OrganizationReviewSummary,
} from "@/lib/organizations/api";
import { StarRating, StarRatingInput } from "@/components/reviews/star-rating";
import { formatOrganizationDate } from "@/components/organizations/organization-public-visuals";

const PAGE_SIZE = 5;

const EMPTY_SUMMARY: OrganizationReviewSummary = {
  averageRating: 0,
  reviewCount: 0,
};

interface OrganizationReviewsSectionProps {
  organizationId: string;
}

export function OrganizationReviewsSection({
  organizationId,
}: OrganizationReviewsSectionProps) {
  const { status, session } = useAuth();
  const viewerId = session?.user.id ?? null;

  const [reviews, setReviews] = useState<OrganizationReviewRecord[]>([]);
  const [summary, setSummary] =
    useState<OrganizationReviewSummary>(EMPTY_SUMMARY);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ownReview, setOwnReview] = useState<OrganizationReviewRecord | null>(
    null,
  );
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const loadReviews = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      setError(null);

      try {
        const result = await organizationsApi.listPublicReviews(
          organizationId,
          { page: nextPage, pageSize: PAGE_SIZE },
        );
        setReviews(result.reviews);
        setSummary(result.summary);
        setPagination(result.pagination);
      } catch (nextError) {
        setError(
          getApiErrorMessage(nextError, {
            action: "load reviews",
            fallback: "We couldn't load reviews right now. Please try again.",
          }),
        );
      } finally {
        setLoading(false);
      }
    },
    [organizationId],
  );

  useEffect(() => {
    void loadReviews(1);
  }, [loadReviews]);

  // Track the viewer's own review so the form doubles as an editor.
  const syncOwnReview = useCallback(
    (record: OrganizationReviewRecord | null) => {
      setOwnReview(record);
      setRating(record?.rating ?? 0);
      setTitle(record?.title ?? "");
      setComment(record?.comment ?? "");
    },
    [],
  );

  // Fetch the viewer's own review directly rather than scanning the current
  // page of public reviews — their review may live on a later page, and the
  // form must open in edit mode (and submit PUT) whenever a review exists.
  useEffect(() => {
    if (!viewerId) {
      syncOwnReview(null);
      return;
    }

    let active = true;

    void organizationsApi
      .getOwnReview(organizationId)
      .then((record) => {
        if (active) {
          syncOwnReview(record ?? null);
        }
      })
      .catch(() => {
        // Non-fatal: fall back to "write a review" mode if the lookup fails.
      });

    return () => {
      active = false;
    };
  }, [organizationId, viewerId, syncOwnReview]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (rating < 1) {
      setFormError("Please choose a star rating.");
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        rating,
        title: title.trim() ? title.trim() : null,
        comment: comment.trim() ? comment.trim() : null,
      };
      const saved = ownReview
        ? await organizationsApi.updateOwnReview(organizationId, payload)
        : await organizationsApi.createReview(organizationId, payload);
      syncOwnReview(saved);
      setFormSuccess(
        ownReview ? "Your review was updated." : "Thanks for your review!",
      );
      await loadReviews(1);
    } catch (nextError) {
      setFormError(
        getApiErrorMessage(nextError, {
          action: "submit your review",
          fallback: "We couldn't submit your review right now.",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOwn = async () => {
    setSubmitting(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      await organizationsApi.deleteOwnReview(organizationId);
      syncOwnReview(null);
      setFormSuccess("Your review was removed.");
      await loadReviews(1);
    } catch (nextError) {
      setFormError(
        getApiErrorMessage(nextError, {
          action: "remove your review",
          fallback: "We couldn't remove your review right now.",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-500 dark:bg-amber-500/10">
            <Star className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              Reviews
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              What renters say about this organization.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StarRating value={summary.averageRating} size="md" />
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <span className="text-base font-semibold text-slate-950 tabular-nums dark:text-white">
              {summary.averageRating.toFixed(1)}
            </span>{" "}
            · {summary.reviewCount} review
            {summary.reviewCount === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {status === "authenticated" ? (
        <form
          onSubmit={handleSubmit}
          className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-950/40"
        >
          <p className="text-sm font-semibold text-slate-950 dark:text-white">
            {ownReview ? "Update your review" : "Write a review"}
          </p>
          <p className="mt-1 text-xs leading-6 text-slate-500 dark:text-slate-400">
            You can review an organization once you have completed a rental with
            them.
          </p>
          <div className="mt-4">
            <StarRatingInput
              value={rating}
              onChange={setRating}
              disabled={submitting}
            />
          </div>
          <input
            type="text"
            value={title}
            maxLength={120}
            disabled={submitting}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a title (optional)"
            className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
          <textarea
            value={comment}
            maxLength={2000}
            rows={3}
            disabled={submitting}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Share the details of your experience (optional)"
            className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />

          {formError ? (
            <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
              {formError}
            </p>
          ) : null}
          {formSuccess ? (
            <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
              {formSuccess}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? "Saving…"
                : ownReview
                  ? "Update review"
                  : "Submit review"}
            </button>
            {ownReview ? (
              <button
                type="button"
                onClick={handleDeleteOwn}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Remove review
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
          <Link
            href="/login"
            className="font-semibold text-violet-700 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200"
          >
            Sign in
          </Link>{" "}
          to review an organization you have rented from.
        </div>
      )}

      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((key) => (
              <div
                key={key}
                className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
              />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
        ) : reviews.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No reviews yet. Be the first to share your experience.
          </p>
        ) : (
          reviews.map((review) => (
            <article
              key={review.id}
              className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <StarRating value={review.rating} size="sm" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {review.reviewer.username ?? "Verified renter"}
                  </span>
                </div>
                <time className="text-xs text-slate-400 dark:text-slate-500">
                  {formatOrganizationDate(review.createdAt, "long")}
                </time>
              </div>
              {review.title ? (
                <h3 className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
                  {review.title}
                </h3>
              ) : null}
              {review.comment ? (
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {review.comment}
                </p>
              ) : null}

              {review.response ? (
                <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3 dark:border-violet-500/20 dark:bg-violet-500/10">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                    <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                    Response from{" "}
                    {review.response.author?.username ?? "the organization"}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {review.response.body}
                  </p>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

      {/* Fixed page size: this is an embedded widget, so no size selector
          and no page jump. */}
      {pagination ? (
        <Pagination
          pagination={pagination}
          itemLabel={{ one: "review", other: "reviews" }}
          ariaLabel="Reviews pagination"
          disabled={loading}
          onPageChange={(nextPage) => void loadReviews(nextPage)}
        />
      ) : null}
    </section>
  );
}
