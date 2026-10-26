import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { AuthIpBlockStore } from "@/features/auth/detection/ip-block.store";
import { SuspiciousActivityDetector } from "@/features/auth/detection/suspicious-activity.detector";

export const authDetectionRegistrationModule: ContainerRegistrationModule = {
  id: "auth-detection",
  register(container) {
    container.register({
      token: containerTokens.authIpBlockStore,
      lifetime: "singleton",
      dependencies: [containerTokens.cacheService],
      resolve: ({ resolve }) =>
        new AuthIpBlockStore(resolve(containerTokens.cacheService)),
    });
    container.register({
      token: containerTokens.suspiciousActivityDetector,
      lifetime: "singleton",
      dependencies: [
        containerTokens.cacheService,
        containerTokens.authAuditRepository,
        containerTokens.accountStatusService,
        containerTokens.authUsersRepository,
        containerTokens.emailService,
        containerTokens.selfLockTokenStore,
        containerTokens.authIpBlockStore,
      ],
      resolve: ({ resolve }) =>
        new SuspiciousActivityDetector({
          cache: resolve(containerTokens.cacheService),
          repository: resolve(containerTokens.authAuditRepository),
          accountStatusService: resolve(containerTokens.accountStatusService),
          usersRepository: resolve(containerTokens.authUsersRepository),
          emailService: resolve(containerTokens.emailService),
          selfLockTokenStore: resolve(containerTokens.selfLockTokenStore),
          ipBlockStore: resolve(containerTokens.authIpBlockStore),
        }),
    });
  },
};
