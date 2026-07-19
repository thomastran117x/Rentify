"use client";

import { useCallback, useEffect, useState } from "react";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import {
  organizationsApi,
  type OrganizationReviewRecord,
  type OrganizationReviewSummary,
} from "@/lib/organizations/api";
import { StarRating } from "@/components/organizations/star-rating";
import {
  inputClass,
  primaryButtonClass,
  rowActionMutedClass,
  secondaryButtonClass,
} from "@/components/organizations/shared/styles";
import { SectionCard } from "@/components/organizations/shared/primitives";
import { formatDateTime } from "@/components/organizations/shared/format";

const EMPTY_SUMMARY: OrganizationReviewSummary = {
  averageRating: 0,
  reviewCount: 0,
};

interface ReviewsPanelProps {
  organizationId: string;
  canManage: boolean;
}

export function ReviewsPanel({ organizationId, canManage }: ReviewsPanelProps) {
  const [reviews, setReviews] = useState<OrganizationReviewRecord[]>([]);
  const [summary, setSummary] =
    useState<OrganizationReviewSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await organizationsApi.listPublicReviews(organizationId, {
        pageSize: 50,
      });
      setReviews(result.reviews);
      setSummary(result.summary);
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
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyUpdatedReview = (updated: OrganizationReviewRecord) => {
    setReviews((current) =>
      current.map((review) => (review.id === updated.id ? updated : review)),
    );
  };

  const handleReply = async (reviewId: string) => {
    const body = (replyDrafts[reviewId] ?? "").trim();
    if (!body) {
      return;
    }

    setSavingId(reviewId);
    setError(null);

    try {
      const updated = await organizationsApi.replyToReview(
        organizationId,
        reviewId,
        body,
      );
      applyUpdatedReview(updated);
      setOpenReplyId(null);
    } catch (nextError) {
      setError(
        getApiErrorMessage(nextError, {
          action: "save your reply",
          fallback: "We couldn't save your reply right now.",
        }),
      );
    } finally {
      setSavingId(null);
    }
  };

  const handleRemoveReply = async (reviewId: string) => {
    setSavingId(reviewId);
    setError(null);

    try {
      const updated = await organizationsApi.removeReviewReply(
        organizationId,
        reviewId,
      );
      applyUpdatedReview(updated);
    } catch (nextError) {
      setError(
        getApiErrorMessage(nextError, {
          action: "remove your reply",
          fallback: "We couldn't remove the reply right now.",
        }),
      );
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (reviewId: string) => {
    setSavingId(reviewId);
    setError(null);

    try {
      await organizationsApi.deleteReview(organizationId, reviewId);
      await load();
    } catch (nextError) {
      setError(
        getApiErrorMessage(nextError, {
          action: "delete this review",
          fallback: "We couldn't delete this review right now.",
        }),
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <SectionCard
      eyebrow="Reputation"
      title="Reviews"
      description={
        canManage
          ? "Reviews from renters who have completed a rental with your organization. Reply publicly or remove reviews that break the rules."
          : "Reviews from renters who have completed a rental with your organization."
      }
      action={
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <StarRating value={summary.averageRating} size="sm" />
          {summary.averageRating.toFixed(1)} · {summary.reviewCount}
        </span>
      }
    >
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <div
              key={key}
              className="h-24 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-dashed border-rose-300 px-4 py-6 text-center text-sm text-rose-600 dark:border-rose-700 dark:text-rose-400">
          {error}
        </div>
      ) : reviews.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No reviews yet.
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <div
              key={review.id}
              className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-4 dark:border-slate-800 dark:bg-slate-950/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StarRating value={review.rating} size="sm" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {review.reviewer.username ?? "Verified renter"}
                  </span>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDateTime(review.createdAt)}
                </span>
              </div>
              {review.title ? (
                <p className="mt-2 font-semibold text-slate-950 dark:text-white">
                  {review.title}
                </p>
              ) : null}
              {review.comment ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                  {review.comment}
                </p>
              ) : null}

              {review.response ? (
                <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3 dark:border-violet-500/20 dark:bg-violet-500/10">
                  <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                    Your response
                  </p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {review.response.body}
                  </p>
                </div>
              ) : null}

              {canManage ? (
                <div className="mt-3">
                  {openReplyId === review.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={replyDrafts[review.id] ?? ""}
                        maxLength={2000}
                        rows={2}
                        onChange={(event) =>
                          setReplyDrafts((current) => ({
                            ...current,
                            [review.id]: event.target.value,
                          }))
                        }
                        placeholder="Write a public response…"
                        className={`${inputClass} h-auto py-2`}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleReply(review.id)}
                          disabled={savingId === review.id}
                          className={primaryButtonClass}
                        >
                          {savingId === review.id ? "Saving…" : "Save reply"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpenReplyId(null)}
                          disabled={savingId === review.id}
                          className={secondaryButtonClass}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenReplyId(review.id);
                          setReplyDrafts((current) => ({
                            ...current,
                            [review.id]: review.response?.body ?? "",
                          }));
                        }}
                        disabled={savingId !== null}
                        className={rowActionMutedClass}
                      >
                        {review.response ? "Edit reply" : "Reply"}
                      </button>
                      {review.response ? (
                        <button
                          type="button"
                          onClick={() => void handleRemoveReply(review.id)}
                          disabled={savingId !== null}
                          className={rowActionMutedClass}
                        >
                          Remove reply
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleDelete(review.id)}
                        disabled={savingId !== null}
                        className={rowActionMutedClass}
                      >
                        {savingId === review.id ? "Working…" : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
