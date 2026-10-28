import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PendingSignupStore } from "@/features/auth/pending-signup/pending-signup.store";
import { LocalAuthController } from "@/features/auth/local/local-auth.controller";
import { LocalAuthService } from "@/features/auth/local/local-auth.service";
import { LoginMfaChallengeStore } from "@/features/auth/mfa/login/login-mfa-challenge.store";
import { LoginMfaController } from "@/features/auth/mfa/login/login-mfa.controller";
import { LoginMfaService } from "@/features/auth/mfa/login/login-mfa.service";

export const authLocalRegistrationModule: ContainerRegistrationModule = {
  id: "auth-local",
  register(container) {
    container.register({
      token: containerTokens.loginMfaChallengeStore,
      lifetime: "scoped",
      dependencies: [containerTokens.cacheService],
      resolve: ({ resolve }) =>
        new LoginMfaChallengeStore(resolve(containerTokens.cacheService)),
    });
    container.register({
      token: containerTokens.pendingSignupStore,
      lifetime: "scoped",
      dependencies: [
        containerTokens.cacheService,
        containerTokens.usernameBloomService,
        containerTokens.emailBloomService,
      ],
      resolve: ({ resolve }) =>
        new PendingSignupStore(
          resolve(containerTokens.cacheService),
          resolve(containerTokens.usernameBloomService),
          resolve(containerTokens.emailBloomService),
        ),
    });
    container.register({
      token: containerTokens.localAuthService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authUsersRepository,
        containerTokens.tokenService,
        containerTokens.otpService,
        containerTokens.deviceService,
        containerTokens.emailService,
        containerTokens.cacheService,
        containerTokens.mfaTotpService,
        containerTokens.usernameBloomService,
        containerTokens.emailBloomService,
        containerTokens.authSessionService,
        containerTokens.pendingSignupStore,
        containerTokens.publicOtpService,
        containerTokens.usernameService,
        containerTokens.loginLockoutService,
        containerTokens.authAuditService,
        containerTokens.loginMfaChallengeStore,
      ],
      resolve: ({ resolve }) =>
        new LocalAuthService(
          resolve(containerTokens.authUsersRepository),
          resolve(containerTokens.tokenService),
          resolve(containerTokens.otpService),
          resolve(containerTokens.deviceService),
          resolve(containerTokens.emailService),
          resolve(containerTokens.cacheService),
          resolve(containerTokens.mfaTotpService),
          resolve(containerTokens.usernameBloomService),
          resolve(containerTokens.emailBloomService),
          resolve(containerTokens.authSessionService),
          resolve(containerTokens.pendingSignupStore),
          resolve(containerTokens.publicOtpService),
          resolve(containerTokens.usernameService),
          resolve(containerTokens.loginLockoutService),
          resolve(containerTokens.authAuditService),
          resolve(containerTokens.loginMfaChallengeStore),
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
    container.register({
      token: containerTokens.loginMfaService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authUsersRepository,
        containerTokens.loginMfaChallengeStore,
        containerTokens.mfaTotpService,
        containerTokens.mfaVerificationService,
        containerTokens.authSessionService,
        containerTokens.loginLockoutService,
        containerTokens.authAuditService,
      ],
      resolve: ({ resolve }) =>
        new LoginMfaService(
          resolve(containerTokens.authUsersRepository),
          resolve(containerTokens.loginMfaChallengeStore),
          resolve(containerTokens.mfaTotpService),
          resolve(containerTokens.mfaVerificationService),
          resolve(containerTokens.authSessionService),
          resolve(containerTokens.loginLockoutService),
          resolve(containerTokens.authAuditService),
        ),
    });
    container.register({
      token: containerTokens.loginMfaController,
      lifetime: "scoped",
      dependencies: [containerTokens.loginMfaService],
      resolve: ({ resolve }) =>
        new LoginMfaController(resolve(containerTokens.loginMfaService)),
    });
  },
};
