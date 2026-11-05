import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { SecurityNotificationService } from "@/features/auth/security-notification/security-notification.service";

export const authSecurityNotificationsRegistrationModule: ContainerRegistrationModule =
  {
    id: "auth-security-notifications",
    register(container) {
      container.register({
        token: containerTokens.securityNotificationService,
        lifetime: "singleton",
        dependencies: [
          containerTokens.authUsersRepository,
          containerTokens.emailService,
          containerTokens.cacheService,
          containerTokens.selfLockTokenStore,
        ],
        resolve: ({ resolve }) =>
          new SecurityNotificationService({
            usersRepository: resolve(containerTokens.authUsersRepository),
            emailService: resolve(containerTokens.emailService),
            cache: resolve(containerTokens.cacheService),
            selfLockTokenStore: resolve(containerTokens.selfLockTokenStore),
          }),
      });
    },
  };
