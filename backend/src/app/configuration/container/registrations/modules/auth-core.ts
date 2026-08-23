import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { AuthRepository } from "@/features/auth/auth.repository";
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
  },
};
