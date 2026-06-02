import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { BookingsController } from "@/features/bookings/bookings.controller";
import { BookingsRepository } from "@/features/bookings/bookings.repository";
import { BookingsService } from "@/features/bookings/bookings.service";

export const bookingsRegistrationModule: ContainerRegistrationModule = {
  id: "bookings",
  register(container) {
    container.register({
      token: containerTokens.bookingsRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new BookingsRepository(),
    });
    container.register({
      token: containerTokens.bookingsService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.bookingsRepository,
        containerTokens.postingsRepository,
        containerTokens.postingsAnalyticsRepository,
        containerTokens.rentingsRepository,
        containerTokens.cacheService,
        containerTokens.postingsPublicCacheService,
        containerTokens.paymentsRepository,
        containerTokens.paymentProvider,
        containerTokens.organizationAccessService,
      ],
      resolve: ({ resolve }) =>
        new BookingsService(
          resolve(containerTokens.bookingsRepository),
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.postingsAnalyticsRepository),
          resolve(containerTokens.rentingsRepository),
          resolve(containerTokens.cacheService),
          resolve(containerTokens.postingsPublicCacheService),
          resolve(containerTokens.paymentsRepository),
          resolve(containerTokens.paymentProvider),
          resolve(containerTokens.organizationAccessService),
        ),
    });
    container.register({
      token: containerTokens.bookingsController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.bookingsService,
        containerTokens.recommendationActivityPublisher,
      ],
      resolve: ({ resolve }) =>
        new BookingsController(
          resolve(containerTokens.bookingsService),
          resolve(containerTokens.recommendationActivityPublisher),
        ),
    });
  },
};
