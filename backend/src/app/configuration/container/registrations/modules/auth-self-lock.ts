import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { SelfLockController } from "@/features/auth/self-lock/self-lock.controller";
import { SelfLockService } from "@/features/auth/self-lock/self-lock.service";
import { SelfLockTokenStore } from "@/features/auth/self-lock/self-lock-token.store";

export const authSelfLockRegistrationModule: ContainerRegistrationModule = {
  id: "auth-self-lock",
  register(container) {
    container.register({
      token: containerTokens.selfLockTokenStore,
      lifetime: "singleton",
      dependencies: [containerTokens.cacheService],
      resolve: ({ resolve }) =>
        new SelfLockTokenStore(resolve(containerTokens.cacheService)),
    });
    container.register({
      token: containerTokens.selfLockService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.selfLockTokenStore,
        containerTokens.authUsersRepository,
        containerTokens.accountStatusService,
      ],
      resolve: ({ resolve }) =>
        new SelfLockService(
          resolve(containerTokens.selfLockTokenStore),
          resolve(containerTokens.authUsersRepository),
          resolve(containerTokens.accountStatusService),
        ),
    });
    container.register({
      token: containerTokens.selfLockController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.selfLockService,
        containerTokens.mfaVerificationService,
      ],
      resolve: ({ resolve }) =>
        new SelfLockController(
          resolve(containerTokens.selfLockService),
          resolve(containerTokens.mfaVerificationService),
        ),
    });
  },
};
