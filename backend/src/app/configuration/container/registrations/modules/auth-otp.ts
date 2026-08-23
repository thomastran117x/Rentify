import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OtpService } from "@/features/auth/otp/otp.service";
import { PublicOtpService } from "@/features/auth/otp/public-otp.service";

export const authOtpRegistrationModule: ContainerRegistrationModule = {
  id: "auth-otp",
  register(container) {
    container.register({
      token: containerTokens.otpService,
      lifetime: "singleton",
      dependencies: [containerTokens.cacheService],
      resolve: ({ resolve }) =>
        new OtpService({
          cache: resolve(containerTokens.cacheService),
        }),
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
