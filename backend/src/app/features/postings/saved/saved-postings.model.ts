import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type PublicPostingRecord,
} from "@/features/postings/postings.model";

export const listSavedPostingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type ListSavedPostingsQuery = z.infer<
  typeof listSavedPostingsQuerySchema
>;

/**
 * Returned by both the save and unsave endpoints so the client always has a
 * canonical state to reconcile its optimistic toggle against.
 */
export interface SavedPostingState {
  postingId: string;
  saved: boolean;
  savedAt: string | null;
}

export interface SavedPostingRecord extends PublicPostingRecord {
  savedAt: string;
}

export interface SavedPostingsPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Why a saved posting cannot be rendered. `paused` is reversible by the owner,
 * so the UI should let the visitor keep waiting on it rather than nudge them
 * to remove it; `unavailable` covers archived, unpublished, and removed.
 */
export type SavedPostingUnavailableReason = "paused" | "unavailable";

export interface UnavailableSavedPosting {
  postingId: string;
  /** Null when the posting record itself has gone. */
  name: string | null;
  reason: SavedPostingUnavailableReason;
  savedAt: string;
}

export interface ListSavedPostingsResult {
  postings: SavedPostingRecord[];
  pagination: SavedPostingsPagination;
  /**
   * Saved rows on this page whose posting is no longer publicly visible
   * because it was paused, archived, or removed after being saved.
   * `pagination.total` still counts them, so a page can render fewer cards
   * than `pageSize`.
   */
  unavailablePostings: UnavailableSavedPosting[];
}

/**
 * Upper bound on the identifier set handed to the client for rendering heart
 * state. Beyond this the extra hearts render unsaved; saving again is harmless
 * because the endpoint is idempotent.
 */
export const SAVED_POSTING_IDS_LIMIT = 500;

export interface ListSavedPostingIdsResult {
  postingIds: string[];
  truncated: boolean;
}

export interface SavedPostingEntry {
  postingId: string;
  createdAt: Date;
}

export interface ListSavedPostingEntriesResult {
  entries: SavedPostingEntry[];
  pagination: SavedPostingsPagination;
}
