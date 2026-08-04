import { authenticatedJson, buildPathWithQuery } from "@/lib/api/client";
import type { Pagination } from "@/lib/api/types";
import type { PublicPostingSummary } from "@/lib/postings/search";

/**
 * Returned by both save and unsave so an optimistic toggle always has a
 * canonical value to reconcile against.
 */
export interface SavedPostingState {
  postingId: string;
  saved: boolean;
  savedAt: string | null;
}

export interface SavedPostingSummary extends PublicPostingSummary {
  savedAt: string;
}

/**
 * `paused` can be reversed by the owner, so the visitor is offered the choice
 * of waiting rather than being nudged to remove the save; `unavailable` covers
 * archived, unpublished, and removed postings.
 */
export type SavedPostingUnavailableReason = "paused" | "unavailable";

export interface UnavailableSavedPosting {
  postingId: string;
  /** Null once the posting record itself is gone. */
  name: string | null;
  reason: SavedPostingUnavailableReason;
  savedAt: string;
}

export interface ListSavedPostingsResult {
  postings: SavedPostingSummary[];
  pagination: Pagination;
  /**
   * Saved postings on this page that are no longer publicly viewable. They are
   * still counted by `pagination.total`, so a page can render fewer cards than
   * its page size.
   */
  unavailablePostings: UnavailableSavedPosting[];
}

export interface ListSavedPostingIdsResult {
  postingIds: string[];
  truncated: boolean;
}

export interface ListSavedPostingsInput {
  page?: number;
  pageSize?: number;
}

export const savedPostingsApi = {
  save(postingId: string): Promise<SavedPostingState> {
    return authenticatedJson<SavedPostingState>(
      "POST",
      `/postings/${encodeURIComponent(postingId)}/save`,
    );
  },
  unsave(postingId: string): Promise<SavedPostingState> {
    return authenticatedJson<SavedPostingState>(
      "DELETE",
      `/postings/${encodeURIComponent(postingId)}/save`,
    );
  },
  list(input: ListSavedPostingsInput = {}): Promise<ListSavedPostingsResult> {
    return authenticatedJson<ListSavedPostingsResult>(
      "GET",
      buildPathWithQuery("/postings/saved", {
        page: input.page ?? 1,
        pageSize: input.pageSize ?? 20,
      }),
    );
  },
  listIds(signal?: AbortSignal): Promise<ListSavedPostingIdsResult> {
    return authenticatedJson<ListSavedPostingIdsResult>(
      "GET",
      "/postings/saved/ids",
      undefined,
      undefined,
      signal,
    );
  },
};
