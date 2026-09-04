import { environment } from "@/configuration/environment/index";
import { loggerFactory, type Logger } from "@/configuration/logging";
import type { ReadThroughCachePolicy } from "@/features/cache/read-through-swr-cache.service";
import { ReadThroughSwrCacheService } from "@/features/cache/read-through-swr-cache.service";
import type { CacheService } from "@/features/cache/cache.service";
import type {
  BatchPostingsResult,
  PublicPostingRecord,
} from "@/features/postings/postings.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";

const POSTINGS_PUBLIC_CACHE_NAMESPACE = "postings:public";

export interface PostingsPublicCacheConfig extends ReadThroughCachePolicy {}

export class PostingsPublicCacheService {
  private readonly logger: Logger;
  private readonly readThroughCacheService: ReadThroughSwrCacheService;

  constructor(
    cacheService: CacheService,
    private readonly postingsRepository: PostingsRepository,
    private readonly config?: PostingsPublicCacheConfig,
  ) {
    this.logger = loggerFactory.forClass(PostingsPublicCacheService, "service");
    this.readThroughCacheService = new ReadThroughSwrCacheService(
      cacheService,
      Math.random,
      {
        onBackgroundRefreshError: ({ key, error }) => {
          this.logger.warn(
            "Failed to refresh stale public posting cache entry.",
            {
              postingId: key,
            },
            error,
          );
        },
      },
    );
  }

  async getPublicById(postingId: Uuid): Promise<PublicPostingRecord | null> {
    const normalizedPostingId = postingId.trim();

    if (!normalizedPostingId) {
      return null;
    }

    return this.readThroughCacheService.get(
      POSTINGS_PUBLIC_CACHE_NAMESPACE,
      normalizedPostingId,
      () => this.resolvePublicPosting(asUuid(normalizedPostingId)),
      this.getConfig(),
    );
  }

  async getPublicByIds(
    ids: string[],
  ): Promise<BatchPostingsResult<PublicPostingRecord>> {
    const normalizedIds = Array.from(
      new Set(ids.map((id) => id.trim()).filter(Boolean)),
    );
    const byId = new Map<string, PublicPostingRecord>();

    await Promise.all(
      normalizedIds.map(async (id) => {
        const posting = await this.getPublicById(asUuid(id));

        if (posting) {
          byId.set(id, posting);
        }
      }),
    );

    const postings: PublicPostingRecord[] = [];
    const missingIds: Uuid[] = [];

    for (const id of ids) {
      const normalizedId = id.trim();

      if (!normalizedId) {
        missingIds.push(asUuid(id));
        continue;
      }

      const posting = byId.get(normalizedId);

      if (!posting) {
        missingIds.push(asUuid(normalizedId));
        continue;
      }

      postings.push(posting);
    }

    return {
      postings,
      missingIds,
    };
  }

  async invalidatePublic(postingId: Uuid): Promise<number> {
    return this.readThroughCacheService.invalidate(
      POSTINGS_PUBLIC_CACHE_NAMESPACE,
      postingId,
    );
  }

  private async resolvePublicPosting(
    postingId: Uuid,
  ): Promise<PublicPostingRecord | null> {
    const batch = await this.postingsRepository.batchFindPublic({
      ids: [postingId],
    });

    return batch.postings[0] ?? null;
  }

  private getConfig(): PostingsPublicCacheConfig {
    return this.config ?? environment.getPostingsPublicCacheConfig();
  }
}
