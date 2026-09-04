import { loggerFactory } from "@/configuration/logging";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import type { Uuid } from "@/configuration/validation/uuid";
import { asUuid } from "@/configuration/validation/uuid";

/**
 * Postings carry a denormalized copy of their organization's name (in the
 * search index) and slug (in the cached public projection), so an
 * organization rename or restore has to refresh both. Shared by profile
 * updates and audit-driven restores. Runs after the underlying change has
 * committed and never fails it -- a stale projection is recoverable, a failed
 * rename or restore is not.
 */
export class OrganizationPostingProjectionService {
  private readonly logger = loggerFactory.forClass(
    OrganizationPostingProjectionService,
    "service",
  );

  constructor(
    private readonly postingsRepository: PostingsRepository,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
  ) {}

  /**
   * `reindex` is only needed for name changes: the slug is not part of the
   * Elasticsearch document, so a slug change is cache-only.
   */
  async cascade(
    organizationId: Uuid,
    options: { reindex: boolean },
  ): Promise<void> {
    try {
      const postingIds = options.reindex
        ? await this.postingsRepository.enqueueSearchSyncForOrganization(
            organizationId,
          )
        : await this.postingsRepository.listPublicPostingIdsForOrganization(
            organizationId,
          );

      for (const postingId of postingIds) {
        await invalidatePublicPostingProjection(
          this.postingsPublicCacheService,
          asUuid(postingId),
        );
      }
    } catch (error) {
      this.logger.error(
        "Failed to refresh posting projections after an organization change.",
        {
          organizationId,
          reindex: options.reindex,
          error,
        },
      );
    }
  }
}
