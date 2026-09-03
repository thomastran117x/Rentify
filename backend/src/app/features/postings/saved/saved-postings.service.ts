import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { isPostingPubliclyVisible } from "@/features/postings/postings.model";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { CacheService } from "@/features/cache/cache.service";
import type { SavedPostingsRepository } from "@/features/postings/saved/saved-postings.repository";
import {
  SAVED_POSTING_IDS_LIMIT,
  type ListSavedPostingIdsResult,
  type ListSavedPostingsResult,
  type SavedPostingState,
  type UnavailableSavedPosting,
} from "@/features/postings/saved/saved-postings.model";
import {
  asOptionalUuid,
  asUuid,
  type Uuid,
} from "@/configuration/validation/uuid";

/**
 * The identifier set is read on essentially every authenticated marketplace
 * page view, so it is cached per user. Both writes go through this service and
 * invalidate it, and the short lifetime bounds staleness from the paths that
 * do not, such as the cascade delete when a posting or account is removed.
 */
const SAVED_POSTING_IDS_CACHE_TTL_SECONDS = 60;

function savedPostingIdsCacheKey(userId: Uuid): string {
  return `postings:saved:ids:${userId}`;
}

export class SavedPostingsService {
  constructor(
    private readonly savedPostingsRepository: SavedPostingsRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
    private readonly cacheService: CacheService,
  ) {}

  async save(postingId: Uuid, userId: Uuid): Promise<SavedPostingState> {
    await this.requirePubliclyVisiblePosting(postingId);

    const { createdAt } = await this.savedPostingsRepository.save(
      asUuid(userId),
      asUuid(postingId),
    );
    await this.invalidateIdsCache(userId);

    return {
      postingId: asUuid(postingId),
      saved: true,
      savedAt: createdAt.toISOString(),
    };
  }

  /**
   * Deliberately skips the public-visibility gate that `save` applies. A
   * posting can be paused or archived after it was saved, and the owner of the
   * bookmark must still be able to clear it from their list.
   */
  async unsave(postingId: Uuid, userId: Uuid): Promise<SavedPostingState> {
    await this.savedPostingsRepository.unsave(userId, postingId);
    await this.invalidateIdsCache(userId);

    return {
      postingId: asUuid(postingId),
      saved: false,
      savedAt: null,
    };
  }

  async list(
    userId: Uuid,
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
        unavailablePostings: [],
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
      unavailablePostings: await this.describeUnavailable(
        batch.missingIds,
        savedAtByPostingId,
      ),
    };
  }

  /**
   * Saved postings that dropped out of the public projection still belong to
   * the visitor, so they are described rather than silently omitted: without a
   * name there is no way to tell which save died or whether it is worth
   * keeping.
   */
  private async describeUnavailable(
    postingIds: Uuid[],
    savedAtByPostingId: Map<string, string>,
  ): Promise<UnavailableSavedPosting[]> {
    if (postingIds.length === 0) {
      return [];
    }

    const summaries =
      await this.postingsRepository.findLifecycleSummariesByIds(postingIds);
    const summaryByPostingId = new Map(
      summaries.map((summary) => [summary.id, summary]),
    );

    return postingIds.map((postingId) => {
      const summary = summaryByPostingId.get(postingId);
      const savedAt =
        savedAtByPostingId.get(postingId) ?? new Date(0).toISOString();

      // A paused posting can be brought back by its owner, so it is reported
      // separately from one that was archived, unpublished, or removed.
      if (summary?.status === "paused") {
        return {
          postingId,
          name: summary.name,
          reason: "paused" as const,
          savedAt,
        };
      }

      return {
        postingId,
        name: summary?.name ?? null,
        reason: "unavailable" as const,
        savedAt,
      };
    });
  }

  async listIds(userId: Uuid): Promise<ListSavedPostingIdsResult> {
    const cacheKey = savedPostingIdsCacheKey(userId);
    const cached = await this.readCachedIds(cacheKey);

    if (cached) {
      return cached;
    }

    const postingIds = await this.savedPostingsRepository.listIds(
      userId,
      SAVED_POSTING_IDS_LIMIT + 1,
    );
    const result: ListSavedPostingIdsResult = {
      postingIds: postingIds.slice(0, SAVED_POSTING_IDS_LIMIT),
      truncated: postingIds.length > SAVED_POSTING_IDS_LIMIT,
    };

    await this.writeCachedIds(cacheKey, result);

    return result;
  }

  /**
   * Cache faults are never fatal here: a miss or a Redis outage just means the
   * set is read from the database, which is the behaviour without a cache.
   */
  private async readCachedIds(
    cacheKey: string,
  ): Promise<ListSavedPostingIdsResult | null> {
    try {
      return await this.cacheService.getJson<ListSavedPostingIdsResult>(
        cacheKey,
      );
    } catch {
      return null;
    }
  }

  private async writeCachedIds(
    cacheKey: string,
    result: ListSavedPostingIdsResult,
  ): Promise<void> {
    try {
      await this.cacheService.setJson(
        cacheKey,
        result,
        SAVED_POSTING_IDS_CACHE_TTL_SECONDS,
      );
    } catch {
      // Losing the write only costs a database read next time.
    }
  }

  private async invalidateIdsCache(userId: Uuid): Promise<void> {
    try {
      await this.cacheService.delete(savedPostingIdsCacheKey(userId));
    } catch {
      // The short lifetime bounds how long a stale entry can survive.
    }
  }

  private async requirePubliclyVisiblePosting(postingId: Uuid) {
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
