import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PostingThumbnailQueueService } from "@/features/postings/thumbnail/thumbnail.queue.service";
import { PostingThumbnailService } from "@/features/postings/thumbnail/thumbnail.service";

export const postingsThumbnailRegistrationModule: ContainerRegistrationModule =
  {
    id: "postings-thumbnail",
    register(container) {
      container.register({
        token: containerTokens.postingThumbnailQueueService,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new PostingThumbnailQueueService(),
      });
      container.register({
        token: containerTokens.postingThumbnailService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.postingsRepository,
          containerTokens.blobService,
          containerTokens.postingsPublicCacheService,
        ],
        resolve: ({ resolve }) =>
          new PostingThumbnailService(
            resolve(containerTokens.postingsRepository),
            resolve(containerTokens.blobService),
            resolve(containerTokens.postingsPublicCacheService),
          ),
      });
    },
  };
