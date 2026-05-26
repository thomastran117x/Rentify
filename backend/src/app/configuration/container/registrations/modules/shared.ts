import { loggerFactory } from "@/configuration/logging";
import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { CacheService } from "@/features/cache/cache.service";
import { EmailDeliveryService } from "@/features/email/email.delivery.service";
import { EmailQueueService } from "@/features/email/email.queue.service";
import { EmailService } from "@/features/email/email.service";

export const sharedRegistrationModule: ContainerRegistrationModule = {
  id: "shared",
  register(container) {
    container.register({
      token: containerTokens.loggerFactory,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => loggerFactory,
    });
    container.register({
      token: containerTokens.cacheService,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new CacheService(),
    });
    container.register({
      token: containerTokens.emailQueueService,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new EmailQueueService(),
    });
    container.register({
      token: containerTokens.emailDeliveryService,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new EmailDeliveryService(),
    });
    container.register({
      token: containerTokens.emailService,
      lifetime: "singleton",
      dependencies: [containerTokens.emailQueueService],
      resolve: ({ resolve }) =>
        new EmailService(resolve(containerTokens.emailQueueService)),
    });
  },
};
