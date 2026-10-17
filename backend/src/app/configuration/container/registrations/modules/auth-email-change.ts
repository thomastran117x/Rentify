import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { EmailChangeController } from "@/features/auth/email-change/email-change.controller";
import { EmailChangeService } from "@/features/auth/email-change/email-change.service";
import { EmailChangeStore } from "@/features/auth/email-change/email-change.store";

export const authEmailChangeRegistrationModule: ContainerRegistrationModule = {
  id: "auth-email-change",
  register(container) {
    container.register({
      token: containerTokens.emailChangeStore,
      lifetime: "singleton",
      dependencies: [containerTokens.cacheService],
      resolve: ({ resolve }) =>
        new EmailChangeStore(resolve(containerTokens.cacheService)),
    });
    container.register({
      token: containerTokens.emailChangeService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authUsersRepository,
        containerTokens.authTokenRepository,
        containerTokens.emailChangeStore,
        containerTokens.emailAvailabilityService,
        containerTokens.otpService,
        containerTokens.emailService,
        containerTokens.authSessionService,
        containerTokens.emailBloomService,
        containerTokens.authAuditService,
      ],
      resolve: ({ resolve }) =>
        new EmailChangeService(
          resolve(containerTokens.authUsersRepository),
          resolve(containerTokens.authTokenRepository),
          resolve(containerTokens.emailChangeStore),
          resolve(containerTokens.emailAvailabilityService),
          resolve(containerTokens.otpService),
          resolve(containerTokens.emailService),
          resolve(containerTokens.authSessionService),
          resolve(containerTokens.emailBloomService),
          resolve(containerTokens.authAuditService),
        ),
    });
    container.register({
      token: containerTokens.emailChangeController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.emailChangeService,
        containerTokens.mfaVerificationService,
      ],
      resolve: ({ resolve }) =>
        new EmailChangeController(
          resolve(containerTokens.emailChangeService),
          resolve(containerTokens.mfaVerificationService),
        ),
    });
  },
};
