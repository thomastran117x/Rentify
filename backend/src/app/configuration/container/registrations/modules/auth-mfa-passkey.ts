import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PasskeyChallengeStore } from "@/features/auth/mfa/passkey/passkey-challenge.store";
import { PasskeyController } from "@/features/auth/mfa/passkey/passkey.controller";
import { PasskeyRepository } from "@/features/auth/mfa/passkey/passkey.repository";
import { PasskeyService } from "@/features/auth/mfa/passkey/passkey.service";

export const authMfaPasskeyRegistrationModule: ContainerRegistrationModule = {
  id: "auth-mfa-passkey",
  register(container) {
    container.register({
      token: containerTokens.passkeyRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new PasskeyRepository(),
    });
    container.register({
      token: containerTokens.passkeyChallengeStore,
      lifetime: "singleton",
      dependencies: [containerTokens.cacheService],
      resolve: ({ resolve }) =>
        new PasskeyChallengeStore(resolve(containerTokens.cacheService)),
    });
    container.register({
      token: containerTokens.passkeyService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.passkeyRepository,
        containerTokens.passkeyChallengeStore,
        containerTokens.authUsersRepository,
        containerTokens.authAuditService,
        containerTokens.securityNotificationService,
      ],
      resolve: ({ resolve }) =>
        new PasskeyService({
          passkeyRepository: resolve(containerTokens.passkeyRepository),
          passkeyChallengeStore: resolve(containerTokens.passkeyChallengeStore),
          usersRepository: resolve(containerTokens.authUsersRepository),
          authAuditService: resolve(containerTokens.authAuditService),
          securityNotificationService: resolve(
            containerTokens.securityNotificationService,
          ),
        }),
    });
    container.register({
      token: containerTokens.passkeyController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.passkeyService,
        containerTokens.mfaVerificationService,
      ],
      resolve: ({ resolve }) =>
        new PasskeyController(
          resolve(containerTokens.passkeyService),
          resolve(containerTokens.mfaVerificationService),
        ),
    });
  },
};
