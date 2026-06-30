import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { AuthController } from "@/features/auth/auth.controller";
import { AuthRepository } from "@/features/auth/auth.repository";
import { AuthService } from "@/features/auth/auth.service";
import { CaptchaService } from "@/features/auth/captcha/captcha.service";
import { TokenService } from "@/features/auth/token/token.service";
import { MfaVerificationService } from "@/features/auth/mfa/verification/mfa-verification.service";

export const authCoreRegistrationModule: ContainerRegistrationModule = {
  id: "auth-core",
  register(container) {
    container.register({
      token: containerTokens.captchaService,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new CaptchaService(),
    });
    container.register({
      token: containerTokens.authRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new AuthRepository(),
    });
    container.register({
      token: containerTokens.tokenService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.cacheService,
        containerTokens.authRepository,
      ],
      resolve: ({ resolve }) =>
        new TokenService({
          cache: resolve(containerTokens.cacheService),
          authRepository: resolve(containerTokens.authRepository),
        }),
    });
    container.register({
      token: containerTokens.authService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authRepository,
        containerTokens.tokenService,
        containerTokens.otpService,
        containerTokens.deviceService,
        containerTokens.emailService,
        containerTokens.googleOAuthService,
        containerTokens.microsoftOAuthService,
        containerTokens.appleOAuthService,
        containerTokens.cacheService,
        containerTokens.mfaTotpService,
      ],
      resolve: ({ resolve }) =>
        new AuthService(
          resolve(containerTokens.authRepository),
          resolve(containerTokens.tokenService),
          resolve(containerTokens.otpService),
          resolve(containerTokens.deviceService),
          resolve(containerTokens.emailService),
          resolve(containerTokens.googleOAuthService),
          resolve(containerTokens.microsoftOAuthService),
          resolve(containerTokens.appleOAuthService),
          resolve(containerTokens.cacheService),
          resolve(containerTokens.mfaTotpService),
        ),
    });
    container.register({
      token: containerTokens.authController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authService,
        containerTokens.captchaService,
        containerTokens.tokenService,
        containerTokens.mfaVerificationService,
      ],
      resolve: ({ resolve }) =>
        new AuthController(
          resolve(containerTokens.authService),
          resolve(containerTokens.captchaService),
          resolve(containerTokens.tokenService),
          resolve(containerTokens.mfaVerificationService),
        ),
    });
  },
};
