import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { isPostingPubliclyVisible } from "@/features/postings/postings.model";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { SavedPostingsRepository } from "@/features/postings/saved/saved-postings.repository";
import {
  SAVED_POSTING_IDS_LIMIT,
  type ListSavedPostingIdsResult,
  type ListSavedPostingsResult,
  type SavedPostingState,
} from "@/features/postings/saved/saved-postings.model";

export class SavedPostingsService {
  constructor(
    private readonly savedPostingsRepository: SavedPostingsRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
  ) {}

  async save(postingId: string, userId: string): Promise<SavedPostingState> {
    await this.requirePubliclyVisiblePosting(postingId);

    const { createdAt } = await this.savedPostingsRepository.save(
      userId,
      postingId,
    );

    return {
      postingId,
      saved: true,
      savedAt: createdAt.toISOString(),
    };
  }

  /**
   * Deliberately skips the public-visibility gate that `save` applies. A
   * posting can be paused or archived after it was saved, and the owner of the
   * bookmark must still be able to clear it from their list.
   */
  async unsave(postingId: string, userId: string): Promise<SavedPostingState> {
    await this.savedPostingsRepository.unsave(userId, postingId);

    return {
      postingId,
      saved: false,
      savedAt: null,
    };
  }

  async list(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<ListSavedPostingsResult> {
    const { entries, pagination } = await this.savedPostingsRepository.listPage(
      userId,
      page,
      pageSize,
    );

    if (entries.length === 0) {
      return {
        postings: [],
        pagination,
        unavailablePostingIds: [],
      };
    }

    const savedAtByPostingId = new Map(
      entries.map((entry) => [entry.postingId, entry.createdAt.toISOString()]),
    );
    // `getPublicByIds` preserves the requested order, so newest-saved-first
    // survives the hydration, and reports anything no longer visible.
    const batch = await this.postingsPublicCacheService.getPublicByIds(
      entries.map((entry) => entry.postingId),
    );

    return {
      postings: batch.postings.map((posting) => ({
        ...posting,
        savedAt:
          savedAtByPostingId.get(posting.id) ?? new Date(0).toISOString(),
      })),
      pagination,
      unavailablePostingIds: batch.missingIds,
    };
  }

  async listIds(userId: string): Promise<ListSavedPostingIdsResult> {
    const postingIds = await this.savedPostingsRepository.listIds(
      userId,
      SAVED_POSTING_IDS_LIMIT + 1,
    );

    return {
      postingIds: postingIds.slice(0, SAVED_POSTING_IDS_LIMIT),
      truncated: postingIds.length > SAVED_POSTING_IDS_LIMIT,
    };
  }

  private async requirePubliclyVisiblePosting(postingId: string) {
    // The metadata lookup is a four-column select; `findById` would join
    // photos, availability blocks and the organization just to read a status.
    const metadata =
      await this.postingsRepository.findPublicReadMetadataById(postingId);

    if (!metadata || !isPostingPubliclyVisible(metadata)) {
      throw new ResourceNotFoundError("Posting could not be found.");
    }

    return metadata;
  }
}
