import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { MfaVerificationController } from "@/features/auth/mfa/verification/mfa-verification.controller";
import { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";

export const authMfaVerificationRegistrationModule: ContainerRegistrationModule = {
  id: "auth-mfa-verification",
  register(container) {
    container.register({
      token: containerTokens.mfaVerificationService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.authRepository,
        containerTokens.cacheService,
        containerTokens.otpService,
        containerTokens.emailService,
        containerTokens.mfaTotpService,
      ],
      resolve: ({ resolve }) =>
        new MfaVerificationService({
          authRepository: resolve(containerTokens.authRepository),
          cache: resolve(containerTokens.cacheService),
          otpService: resolve(containerTokens.otpService),
          emailService: resolve(containerTokens.emailService),
          mfaTotpService: resolve(containerTokens.mfaTotpService),
        }),
    });
    container.register({
      token: containerTokens.mfaVerificationController,
      lifetime: "scoped",
      dependencies: [containerTokens.mfaVerificationService],
      resolve: ({ resolve }) =>
        new MfaVerificationController(
          resolve(containerTokens.mfaVerificationService),
        ),
    });
  },
};
