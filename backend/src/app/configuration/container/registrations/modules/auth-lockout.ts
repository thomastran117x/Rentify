import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { LoginLockoutController } from "@/features/auth/lockout/login-lockout.controller";
import { LoginLockoutService } from "@/features/auth/lockout/login-lockout.service";

export const authLockoutRegistrationModule: ContainerRegistrationModule = {
  id: "auth-lockout",
  register(container) {
    container.register({
      token: containerTokens.loginLockoutService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.cacheService,
        containerTokens.authRepository,
        containerTokens.otpService,
        containerTokens.publicOtpService,
      ],
      resolve: ({ resolve }) =>
        new LoginLockoutService(
          resolve(containerTokens.cacheService),
          resolve(containerTokens.authRepository),
          resolve(containerTokens.otpService),
          resolve(containerTokens.publicOtpService),
        ),
    });
    container.register({
      token: containerTokens.loginLockoutController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.loginLockoutService,
        containerTokens.captchaService,
      ],
      resolve: ({ resolve }) =>
        new LoginLockoutController(
          resolve(containerTokens.loginLockoutService),
          resolve(containerTokens.captchaService),
        ),
    });
  },
};
