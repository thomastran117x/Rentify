import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { BookingsController } from "@/features/bookings/bookings.controller";
import { BookingsRepository } from "@/features/bookings/bookings.repository";
import { BookingsService } from "@/features/bookings/bookings.service";
import { BookingMessageEmailComposer } from "@/features/bookings/messages/booking-message-email.composer";
import { BookingMessageStreamHub } from "@/features/bookings/messages/booking-message-stream.hub";
import { BookingMessagesController } from "@/features/bookings/messages/booking-messages.controller";
import { BookingMessagesRepository } from "@/features/bookings/messages/booking-messages.repository";
import { BookingMessagesService } from "@/features/bookings/messages/booking-messages.service";

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
        containerTokens.seasonalPricingRepository,
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
          resolve(containerTokens.seasonalPricingRepository),
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
    container.register({
      token: containerTokens.bookingMessagesRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new BookingMessagesRepository(),
    });
    container.register({
      // Singleton: the hub owns a dedicated Redis subscriber connection and
      // must outlive the request scope, which is disposed as soon as a
      // streaming handler returns its Response.
      token: containerTokens.bookingMessageStreamHub,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new BookingMessageStreamHub(),
      dispose: (hub) => hub.dispose(),
    });
    container.register({
      token: containerTokens.bookingMessageEmailComposer,
      lifetime: "singleton",
      dependencies: [
        containerTokens.bookingMessagesRepository,
        containerTokens.authRepository,
      ],
      resolve: ({ resolve }) =>
        new BookingMessageEmailComposer(
          resolve(containerTokens.bookingMessagesRepository),
          resolve(containerTokens.authRepository),
        ),
    });
    container.register({
      token: containerTokens.bookingMessagesService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.bookingMessagesRepository,
        containerTokens.bookingsRepository,
        containerTokens.organizationAccessService,
        containerTokens.organizationsRepository,
        containerTokens.cacheService,
        containerTokens.emailService,
      ],
      resolve: ({ resolve }) =>
        new BookingMessagesService(
          resolve(containerTokens.bookingMessagesRepository),
          resolve(containerTokens.bookingsRepository),
          resolve(containerTokens.organizationAccessService),
          resolve(containerTokens.organizationsRepository),
          resolve(containerTokens.cacheService),
          resolve(containerTokens.emailService),
        ),
    });
    container.register({
      token: containerTokens.bookingMessagesController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.bookingMessagesService,
        containerTokens.bookingMessageStreamHub,
        containerTokens.tokenService,
      ],
      resolve: ({ resolve }) =>
        new BookingMessagesController(
          resolve(containerTokens.bookingMessagesService),
          resolve(containerTokens.bookingMessageStreamHub),
          resolve(containerTokens.tokenService),
        ),
    });
  },
};
