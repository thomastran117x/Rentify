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

export interface ListSavedPostingsResult {
  postings: SavedPostingRecord[];
  pagination: SavedPostingsPagination;
  /**
   * Saved rows on this page whose posting is no longer publicly visible
   * because it was paused or archived after being saved. `pagination.total`
   * still counts them, so a page can render fewer cards than `pageSize`.
   */
  unavailablePostingIds: string[];
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
