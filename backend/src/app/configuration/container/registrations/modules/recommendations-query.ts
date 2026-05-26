import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { RecommendationQueryRepository } from "@/features/recommendations/recommendation-query.repository";
import { RecommendationQueryService } from "@/features/recommendations/recommendation-query.service";
import { RecommendationsController } from "@/features/recommendations/recommendations.controller";

export const recommendationsQueryRegistrationModule: ContainerRegistrationModule =
  {
    id: "recommendations-query",
    register(container) {
      container.register({
        token: containerTokens.recommendationQueryRepository,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new RecommendationQueryRepository(),
      });
      container.register({
        token: containerTokens.recommendationQueryService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.recommendationQueryRepository,
          containerTokens.postingsPublicCacheService,
        ],
        resolve: ({ resolve }) =>
          new RecommendationQueryService(
            resolve(containerTokens.recommendationQueryRepository),
            resolve(containerTokens.postingsPublicCacheService),
          ),
      });
      container.register({
        token: containerTokens.recommendationsController,
        lifetime: "scoped",
        dependencies: [containerTokens.recommendationQueryService],
        resolve: ({ resolve }) =>
          new RecommendationsController(
            resolve(containerTokens.recommendationQueryService),
          ),
      });
    },
  };
