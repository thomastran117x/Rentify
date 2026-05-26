import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { RecommendationActivityProcessor } from "@/features/recommendations/recommendation-activity.processor";
import { RecommendationActivityPublisher } from "@/features/recommendations/recommendation-activity.publisher";
import { RecommendationActivityQueueService } from "@/features/recommendations/recommendation-activity.queue.service";
import { RecommendationActivityRepository } from "@/features/recommendations/recommendation-activity.repository";

export const recommendationsActivityRegistrationModule: ContainerRegistrationModule =
  {
    id: "recommendations-activity",
    register(container) {
      container.register({
        token: containerTokens.recommendationActivityQueueService,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new RecommendationActivityQueueService(),
      });
      container.register({
        token: containerTokens.recommendationActivityRepository,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new RecommendationActivityRepository(),
      });
      container.register({
        token: containerTokens.recommendationActivityProcessor,
        lifetime: "scoped",
        dependencies: [containerTokens.recommendationActivityRepository],
        resolve: ({ resolve }) =>
          new RecommendationActivityProcessor(
            resolve(containerTokens.recommendationActivityRepository),
          ),
      });
      container.register({
        token: containerTokens.recommendationActivityPublisher,
        lifetime: "scoped",
        dependencies: [
          containerTokens.recommendationActivityQueueService,
          containerTokens.profileRepository,
        ],
        resolve: ({ resolve }) =>
          new RecommendationActivityPublisher(
            resolve(containerTokens.recommendationActivityQueueService),
            resolve(containerTokens.profileRepository),
          ),
      });
    },
  };
