import { authenticatedJson, buildPathWithQuery } from "@/lib/api/client";
import type { Pagination } from "@/lib/api/types";
import type { PublicPostingSearchParams } from "@/lib/postings/search";

/**
 * The filters a saved search stores.
 *
 * `page`, `pageSize` and `sort` are excluded because they are presentation
 * choices: the alert sweep picks its own, and including them would make two
 * saves of the same filters look different to the duplicate guard.
 */
export type SavedSearchQueryParams = Omit<
  PublicPostingSearchParams,
  "page" | "pageSize" | "sort"
>;

export type SavedSearchNotifyFrequency = "instant" | "daily" | "off";

export interface SavedSearchRecord {
  id: string;
  name: string;
  queryParams: SavedSearchQueryParams;
  notifyFrequency: SavedSearchNotifyFrequency;
  /** Matches found since the visitor last opened this search. */
  newMatchCount: number;
  lastCheckedAt: string | null;
  lastNotifiedAt: string | null;
  /**
   * True when the stored filters no longer validate against the current search
   * contract. The search is kept and shown, but it no longer runs.
   */
  invalidated: boolean;
  createdAt: string;
}

export interface ListSavedSearchesResult {
  searches: SavedSearchRecord[];
  pagination: Pagination;
  /** How many searches one account may save. */
  limit: number;
}

export interface ListSavedSearchesInput {
  page?: number;
  pageSize?: number;
}

export interface CreateSavedSearchInput {
  name?: string;
  queryParams: SavedSearchQueryParams;
  notifyFrequency?: SavedSearchNotifyFrequency;
}

export interface UpdateSavedSearchInput {
  name?: string;
  notifyFrequency?: SavedSearchNotifyFrequency;
}

export const savedSearchesApi = {
  list(input: ListSavedSearchesInput = {}): Promise<ListSavedSearchesResult> {
    return authenticatedJson<ListSavedSearchesResult>(
      "GET",
      buildPathWithQuery("/postings/saved/searches", {
        page: input.page ?? 1,
        pageSize: input.pageSize ?? 20,
      }),
    );
  },
  create(input: CreateSavedSearchInput): Promise<SavedSearchRecord> {
    return authenticatedJson<SavedSearchRecord, CreateSavedSearchInput>(
      "POST",
      "/postings/saved/searches",
      input,
    );
  },
  update(
    id: string,
    input: UpdateSavedSearchInput,
  ): Promise<SavedSearchRecord> {
    return authenticatedJson<SavedSearchRecord, UpdateSavedSearchInput>(
      "PATCH",
      `/postings/saved/searches/${encodeURIComponent(id)}`,
      input,
    );
  },
  remove(id: string): Promise<void> {
    return authenticatedJson<void>(
      "DELETE",
      `/postings/saved/searches/${encodeURIComponent(id)}`,
    );
  },
  markSeen(id: string): Promise<void> {
    return authenticatedJson<void>(
      "POST",
      `/postings/saved/searches/${encodeURIComponent(id)}/seen`,
    );
  },
};
