import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { environment } from "@/configuration/environment";
import { OtpService } from "@/features/auth/otp/otp.service";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";

export const authOtpRegistrationModule: ContainerRegistrationModule = {
  id: "auth-otp",
  register(container) {
    container.register({
      token: containerTokens.otpService,
      lifetime: "singleton",
      dependencies: [containerTokens.cacheService],
      resolve: ({ resolve }) => {
        const otp = environment.getAuthSecurityConfig().otp;

        return new OtpService({
          cache: resolve(containerTokens.cacheService),
          hashSecret: environment.getTokenConfig().otpHashSecret,
          // The dev preview routes are registered under the same condition.
          previewEnabled: !environment.isProduction(),
          ttlInSeconds: otp.ttlSeconds,
          resendCooldownInSeconds: otp.resendCooldownSeconds,
          maxAttempts: otp.maxAttempts,
        });
      },
    });
    container.register({
      token: containerTokens.publicOtpService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.cacheService,
        containerTokens.otpService,
        containerTokens.emailService,
      ],
      resolve: ({ resolve }) =>
        new PublicOtpService(
          resolve(containerTokens.cacheService),
          resolve(containerTokens.otpService),
          resolve(containerTokens.emailService),
        ),
    });
  },
};
