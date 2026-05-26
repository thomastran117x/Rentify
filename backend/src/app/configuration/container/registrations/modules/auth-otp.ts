import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OtpService } from "@/features/auth/otp/otp.service";

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
  },
};
