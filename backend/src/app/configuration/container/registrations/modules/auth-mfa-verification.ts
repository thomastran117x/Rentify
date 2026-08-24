import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { MfaVerificationController } from "@/features/auth/mfa/verification/mfa-verification.controller";
import { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";
import { MfaVerificationRepository } from "@/features/auth/mfa/verification/mfa-verification.repository";

export const authMfaVerificationRegistrationModule: ContainerRegistrationModule =
  {
    id: "auth-mfa-verification",
    register(container) {
      container.register({
        token: containerTokens.authMfaVerificationRepository,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new MfaVerificationRepository(),
      });
      container.register({
        token: containerTokens.mfaVerificationService,
        lifetime: "singleton",
        dependencies: [
          containerTokens.authMfaVerificationRepository,
          containerTokens.cacheService,
          containerTokens.otpService,
          containerTokens.emailService,
          containerTokens.mfaTotpService,
        ],
        resolve: ({ resolve }) =>
          new MfaVerificationService({
            mfaVerificationRepository: resolve(
              containerTokens.authMfaVerificationRepository,
            ),
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
