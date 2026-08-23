import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { AuthController } from "@/features/auth/auth.controller";
import { AuthRepository } from "@/features/auth/auth.repository";
import { AuthService } from "@/features/auth/auth.service";
import { AuthSessionService } from "@/features/auth/session/session.service";
import { AuthSessionController } from "@/features/auth/session/session.controller";
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
      token: containerTokens.authSessionService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authRepository,
        containerTokens.tokenService,
        containerTokens.deviceService,
      ],
      resolve: ({ resolve }) =>
        new AuthSessionService(
          resolve(containerTokens.authRepository),
          resolve(containerTokens.tokenService),
          resolve(containerTokens.deviceService),
        ),
    });
    container.register({
      token: containerTokens.authSessionController,
      lifetime: "scoped",
      dependencies: [containerTokens.authSessionService],
      resolve: ({ resolve }) =>
        new AuthSessionController(resolve(containerTokens.authSessionService)),
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
        new AuthService(
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
      token: containerTokens.authController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authService,
        containerTokens.captchaService,
      ],
      resolve: ({ resolve }) =>
        new AuthController(
          resolve(containerTokens.authService),
          resolve(containerTokens.captchaService),
        ),
    });
  },
};
