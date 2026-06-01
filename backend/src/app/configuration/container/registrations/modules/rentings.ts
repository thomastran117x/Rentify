import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { RentingsController } from "@/features/rentings/rentings.controller";
import { RentingsRepository } from "@/features/rentings/rentings.repository";
import { RentingsService } from "@/features/rentings/rentings.service";

export const rentingsRegistrationModule: ContainerRegistrationModule = {
  id: "rentings",
  register(container) {
    container.register({
      token: containerTokens.rentingsRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new RentingsRepository(),
    });
    container.register({
      token: containerTokens.rentingsService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.rentingsRepository,
        containerTokens.bookingsRepository,
        containerTokens.postingsAnalyticsRepository,
        containerTokens.postingsRepository,
        containerTokens.cacheService,
        containerTokens.postingsPublicCacheService,
        containerTokens.organizationAccessService,
      ],
      resolve: ({ resolve }) =>
        new RentingsService(
          resolve(containerTokens.rentingsRepository),
          resolve(containerTokens.bookingsRepository),
          resolve(containerTokens.postingsAnalyticsRepository),
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.cacheService),
          resolve(containerTokens.postingsPublicCacheService),
          resolve(containerTokens.organizationAccessService),
        ),
    });
    container.register({
      token: containerTokens.rentingsController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.rentingsService,
        containerTokens.recommendationActivityPublisher,
      ],
      resolve: ({ resolve }) =>
        new RentingsController(
          resolve(containerTokens.rentingsService),
          resolve(containerTokens.recommendationActivityPublisher),
        ),
    });
  },
};
