import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import { PostingsAnalyticsService } from "@/features/postings/analytics/analytics.service";

export const postingsAnalyticsRegistrationModule: ContainerRegistrationModule =
  {
    id: "postings-analytics",
    register(container) {
      container.register({
        token: containerTokens.postingsAnalyticsRepository,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new PostingsAnalyticsRepository(),
      });
      container.register({
        token: containerTokens.postingsAnalyticsService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.postingsAnalyticsRepository,
          containerTokens.postingsRepository,
        ],
        resolve: ({ resolve }) =>
          new PostingsAnalyticsService(
            resolve(containerTokens.postingsAnalyticsRepository),
            resolve(containerTokens.postingsRepository),
          ),
      });
    },
  };
