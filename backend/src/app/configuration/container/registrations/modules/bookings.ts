import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { BookingsController } from "@/features/bookings/bookings.controller";
import { BookingsRepository } from "@/features/bookings/bookings.repository";
import { BookingsService } from "@/features/bookings/bookings.service";
import { BookingMessageEmailComposer } from "@/features/bookings/messages/booking-message-email.composer";
import { BookingMessagesController } from "@/features/bookings/messages/booking-messages.controller";
import { BookingMessagesRepository } from "@/features/bookings/messages/booking-messages.repository";
import { BookingMessageSocketServer } from "@/features/bookings/messages/booking-message-socket.server";
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
      token: containerTokens.bookingMessageEmailComposer,
      lifetime: "singleton",
      dependencies: [
        containerTokens.bookingMessagesRepository,
        containerTokens.authUsersRepository,
        containerTokens.organizationAccessService,
      ],
      resolve: ({ resolve }) =>
        new BookingMessageEmailComposer(
          resolve(containerTokens.bookingMessagesRepository),
          resolve(containerTokens.authUsersRepository),
          resolve(containerTokens.organizationAccessService),
        ),
    });
    container.register({
      token: containerTokens.bookingMessagesService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.bookingMessagesRepository,
        containerTokens.bookingsRepository,
        containerTokens.organizationAccessService,
        containerTokens.organizationsMembersRepository,
        containerTokens.cacheService,
        containerTokens.emailService,
        containerTokens.tokenService,
        containerTokens.bookingMessageSocketServer,
      ],
      resolve: ({ resolve }) =>
        new BookingMessagesService(
          resolve(containerTokens.bookingMessagesRepository),
          resolve(containerTokens.bookingsRepository),
          resolve(containerTokens.organizationAccessService),
          resolve(containerTokens.organizationsMembersRepository),
          resolve(containerTokens.cacheService),
          resolve(containerTokens.emailService),
          resolve(containerTokens.tokenService),
          resolve(containerTokens.bookingMessageSocketServer),
        ),
    });
    container.register({
      // Singleton with a dispose hook: it owns the Socket.IO server, its Redis
      // adapter connections and every open socket, so it must outlive any
      // request scope. The service resolves it as its realtime seam, which is
      // not a cycle: this constructor takes no dependencies.
      token: containerTokens.bookingMessageSocketServer,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new BookingMessageSocketServer(),
      dispose: (socketServer) => socketServer.close(),
    });
    container.register({
      token: containerTokens.bookingMessagesController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.bookingMessagesService,
        containerTokens.tokenService,
      ],
      resolve: ({ resolve }) =>
        new BookingMessagesController(
          resolve(containerTokens.bookingMessagesService),
          resolve(containerTokens.tokenService),
        ),
    });
  },
};
