import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { Uuid } from "@/configuration/validation/uuid";

export async function invalidatePublicPostingProjection(
  publicCacheService: Pick<PostingsPublicCacheService, "invalidatePublic">,
  postingId?: Uuid,
): Promise<void> {
  if (!postingId) {
    return;
  }

  await publicCacheService.invalidatePublic(postingId);
}
