import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PostingsReviewsRepository } from "@/features/postings/reviews/reviews.repository";
import { PostingsReviewsService } from "@/features/postings/reviews/reviews.service";

export const postingsReviewsRegistrationModule: ContainerRegistrationModule = {
  id: "postings-reviews",
  register(container) {
    container.register({
      token: containerTokens.postingsReviewsRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new PostingsReviewsRepository(),
    });
    container.register({
      token: containerTokens.postingsReviewsService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.postingsReviewsRepository,
        containerTokens.postingsRepository,
        containerTokens.rentingsRepository,
        containerTokens.organizationAccessService,
        containerTokens.postingsPublicCacheService,
      ],
      resolve: ({ resolve }) =>
        new PostingsReviewsService(
          resolve(containerTokens.postingsReviewsRepository),
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.rentingsRepository),
          resolve(containerTokens.organizationAccessService),
          resolve(containerTokens.postingsPublicCacheService),
        ),
    });
  },
};
