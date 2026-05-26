import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { RecommendationPrecomputeRepository } from "@/features/recommendations/recommendation-precompute.repository";
import { RecommendationPrecomputeService } from "@/features/recommendations/recommendation-precompute.service";

export const recommendationsPrecomputeRegistrationModule: ContainerRegistrationModule =
  {
    id: "recommendations-precompute",
    register(container) {
      container.register({
        token: containerTokens.recommendationPrecomputeRepository,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new RecommendationPrecomputeRepository(),
      });
      container.register({
        token: containerTokens.recommendationPrecomputeService,
        lifetime: "scoped",
        dependencies: [containerTokens.recommendationPrecomputeRepository],
        resolve: ({ resolve }) =>
          new RecommendationPrecomputeService(
            resolve(containerTokens.recommendationPrecomputeRepository),
          ),
      });
    },
  };
