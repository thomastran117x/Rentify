import { z } from "zod";
import type { PublicPostingRecord } from "@/features/postings/postings.model";
import { uuidSchema, type Uuid } from "@/configuration/validation/uuid";

/**
 * Rows kept per account. Browsing history is bounded by construction rather
 * than by a retention policy: the write path prunes back to this many rows, so
 * there is no sweeper to schedule and no unbounded table to reason about later.
 */
export const RECENTLY_VIEWED_CAP = 50;

/**
 * Entries one sync request may carry. Equal to {@link RECENTLY_VIEWED_CAP}
 * because the browser mirror is capped at the same number -- accepting more
 * than the account can keep would only mean pruning most of it back off.
 */
export const RECENTLY_VIEWED_SYNC_MAX = 50;

export const RECENTLY_VIEWED_DEFAULT_LIMIT = 24;

/**
 * How far back a client-supplied `viewedAt` may reach. A browser mirror that
 * has been closed for months should not be able to seed an account's history
 * with dates that predate the feature; anything older is clamped forward.
 */
export const RECENTLY_VIEWED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const listRecentlyViewedQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(RECENTLY_VIEWED_CAP)
    .default(RECENTLY_VIEWED_DEFAULT_LIMIT),
});

export type ListRecentlyViewedQuery = z.infer<
  typeof listRecentlyViewedQuerySchema
>;

/**
 * One entry from the browser's mirror. `viewedAt` is client-supplied and
 * therefore untrusted: the service clamps it into a sane window rather than
 * rejecting the batch, because a genuinely skewed device clock is far more
 * likely than a forgery, and a forgery buys nothing a plain view would not.
 */
export const syncRecentlyViewedEntrySchema = z.object({
  postingId: uuidSchema,
  viewedAt: z.iso.datetime("Viewed-at must be an ISO datetime."),
});

export const syncRecentlyViewedRequestSchema = z.object({
  entries: z
    .array(syncRecentlyViewedEntrySchema)
    .min(1, "At least one entry is required.")
    .max(
      RECENTLY_VIEWED_SYNC_MAX,
      `At most ${RECENTLY_VIEWED_SYNC_MAX} entries may be synced at once.`,
    ),
});

export type SyncRecentlyViewedRequest = z.infer<
  typeof syncRecentlyViewedRequestSchema
>;

export interface RecentlyViewedEntry {
  postingId: Uuid;
  viewedAt: Date;
}

export interface RecentlyViewedPostingRecord extends PublicPostingRecord {
  viewedAt: string;
}

export interface ListRecentlyViewedPostingsResult {
  postings: RecentlyViewedPostingRecord[];
  /**
   * Whether this account is still recording views. Carried on the read so
   * the browser learns about an opt-out made on another device without a
   * second request, and stops writing its own local mirror too -- the
   * server enforces the flag regardless, but a client that keeps recording
   * locally would still be building a history the visitor asked not to have.
   */
  trackingEnabled: boolean;
}

/**
 * Returned by the view endpoint. It reports only that the request was
 * understood: the write is skipped for signed-out visitors, for bots, and for
 * postings that are not publicly visible, and none of those are the caller's
 * business to distinguish.
 */
export interface RecordPostingViewResult {
  accepted: true;
}
