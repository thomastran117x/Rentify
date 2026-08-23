import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PendingSignupStore } from "@/features/auth/pending-signup/pending-signup.store";
import { LocalAuthController } from "@/features/auth/local/local-auth.controller";
import { LocalAuthService } from "@/features/auth/local/local-auth.service";

export const authLocalRegistrationModule: ContainerRegistrationModule = {
  id: "auth-local",
  register(container) {
    container.register({
      token: containerTokens.pendingSignupStore,
      lifetime: "scoped",
      dependencies: [
        containerTokens.cacheService,
        containerTokens.usernameBloomService,
      ],
      resolve: ({ resolve }) =>
        new PendingSignupStore(
          resolve(containerTokens.cacheService),
          resolve(containerTokens.usernameBloomService),
        ),
    });
    container.register({
      token: containerTokens.localAuthService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authRepository,
        containerTokens.tokenService,
        containerTokens.otpService,
        containerTokens.deviceService,
        containerTokens.emailService,
        containerTokens.cacheService,
        containerTokens.mfaTotpService,
        containerTokens.usernameBloomService,
        containerTokens.authSessionService,
        containerTokens.pendingSignupStore,
        containerTokens.publicOtpService,
        containerTokens.usernameService,
        containerTokens.loginLockoutService,
      ],
      resolve: ({ resolve }) =>
        new LocalAuthService(
          resolve(containerTokens.authRepository),
          resolve(containerTokens.tokenService),
          resolve(containerTokens.otpService),
          resolve(containerTokens.deviceService),
          resolve(containerTokens.emailService),
          resolve(containerTokens.cacheService),
          resolve(containerTokens.mfaTotpService),
          resolve(containerTokens.usernameBloomService),
          resolve(containerTokens.authSessionService),
          resolve(containerTokens.pendingSignupStore),
          resolve(containerTokens.publicOtpService),
          resolve(containerTokens.usernameService),
          resolve(containerTokens.loginLockoutService),
        ),
    });
    container.register({
      token: containerTokens.localAuthController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.localAuthService,
        containerTokens.captchaService,
      ],
      resolve: ({ resolve }) =>
        new LocalAuthController(
          resolve(containerTokens.localAuthService),
          resolve(containerTokens.captchaService),
        ),
    });
  },
};
