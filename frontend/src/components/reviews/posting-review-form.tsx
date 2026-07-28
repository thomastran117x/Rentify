"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { StarRatingInput } from "@/components/reviews/star-rating";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { postingsApi } from "@/lib/postings/api";
import type { PublicPostingReviewRecord } from "@/lib/postings/public";

interface PostingReviewFormProps {
  postingId: string;
  onSaved?: (review: PublicPostingReviewRecord) => void;
  /**
   * Render a short explanation instead of nothing when the viewer cannot
   * review. Call sites that already gate on a completed renting (the bookings
   * card) pass this so an expanded panel is never empty; the posting detail
   * page leaves it off so signed-in browsers see no extra noise.
   */
  showIneligibleNotice?: boolean;
  className?: string;
}

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

/**
 * Create/edit form for a posting review. Self-loads the viewer's eligibility
 * and existing review so both call sites stay a single line, and so the form
 * opens in edit mode regardless of which review page the viewer is on.
 */
export function PostingReviewForm({
  postingId,
  onSaved,
  showIneligibleNotice = false,
  className,
}: PostingReviewFormProps) {
  const { status } = useAuth();
  const authenticated = status === "authenticated";

  const [loading, setLoading] = useState(true);
  const [eligible, setEligible] = useState(false);
  const [ownReview, setOwnReview] = useState<PublicPostingReviewRecord | null>(
    null,
  );

  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const syncOwnReview = useCallback(
    (record: PublicPostingReviewRecord | null) => {
      setOwnReview(record);
      setRating(record?.rating ?? 0);
      setTitle(record?.title ?? "");
      setComment(record?.comment ?? "");
    },
    [],
  );

  useEffect(() => {
    if (!authenticated) {
      setLoading(false);
      setEligible(false);
      syncOwnReview(null);
      return;
    }

    let active = true;
    setLoading(true);

    void postingsApi
      .getOwnReview(postingId)
      .then((state) => {
        if (!active) {
          return;
        }

        setEligible(state.eligible);
        syncOwnReview(state.review);
      })
      .catch(() => {
        // Non-fatal: treat a failed lookup as "cannot review right now".
        if (active) {
          setEligible(false);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [authenticated, postingId, syncOwnReview]);

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
        ? await postingsApi.updateOwnReview(postingId, payload)
        : await postingsApi.createReview(postingId, payload);

      syncOwnReview(saved);
      setFormSuccess(
        ownReview ? "Your review was updated." : "Thanks for your review!",
      );
      onSaved?.(saved);
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

  if (loading) {
    return authenticated ? (
      <div
        className={`h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800 ${className ?? ""}`}
        aria-hidden="true"
      />
    ) : null;
  }

  if (!eligible) {
    if (!showIneligibleNotice) {
      return null;
    }

    return (
      <p
        className={`text-sm text-slate-500 dark:text-slate-400 ${className ?? ""}`}
      >
        {authenticated
          ? "You can review this posting once your rental is complete."
          : "Sign in to review a posting you have rented."}
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`rounded-2xl border border-slate-200 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-950/40 ${className ?? ""}`}
    >
      <p className="text-sm font-semibold text-slate-950 dark:text-white">
        {ownReview ? "Update your review" : "Write a review"}
      </p>
      <p className="mt-1 text-xs leading-6 text-slate-500 dark:text-slate-400">
        Your rating helps other renters and the owner you rented from.
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
        aria-label="Review title"
        className={`mt-4 ${INPUT_CLASS}`}
      />
      <textarea
        value={comment}
        maxLength={2000}
        rows={3}
        disabled={submitting}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Share the details of your experience (optional)"
        aria-label="Review comment"
        className={`mt-3 ${INPUT_CLASS}`}
      />

      {formError ? (
        <p
          className="mt-3 text-sm text-rose-600 dark:text-rose-400"
          role="alert"
        >
          {formError}
        </p>
      ) : null}
      {formSuccess ? (
        <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
          {formSuccess}
        </p>
      ) : null}

      <div className="mt-4">
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
      </div>
    </form>
  );
}
