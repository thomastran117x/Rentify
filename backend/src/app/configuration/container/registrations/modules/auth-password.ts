import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PasswordController } from "@/features/auth/password/password.controller";
import { PasswordService } from "@/features/auth/password/password.service";
import { PasswordRepository } from "@/features/auth/password/password.repository";
import { PasswordPolicyService } from "@/features/auth/password/policy/password-policy.service";

export const authPasswordRegistrationModule: ContainerRegistrationModule = {
  id: "auth-password",
  register(container) {
    container.register({
      token: containerTokens.authPasswordRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new PasswordRepository(),
    });
    container.register({
      token: containerTokens.passwordPolicyService,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new PasswordPolicyService(),
    });
    container.register({
      token: containerTokens.passwordService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authUsersRepository,
        containerTokens.authPasswordRepository,
        containerTokens.authTokenRepository,
        containerTokens.otpService,
        containerTokens.authSessionService,
        containerTokens.loginLockoutService,
        containerTokens.publicOtpService,
        containerTokens.authAuditService,
        containerTokens.accountStatusService,
        containerTokens.securityNotificationService,
        containerTokens.passwordPolicyService,
      ],
      resolve: ({ resolve }) =>
        new PasswordService(
          resolve(containerTokens.authUsersRepository),
          resolve(containerTokens.authPasswordRepository),
          resolve(containerTokens.authTokenRepository),
          resolve(containerTokens.otpService),
          resolve(containerTokens.authSessionService),
          resolve(containerTokens.loginLockoutService),
          resolve(containerTokens.publicOtpService),
          resolve(containerTokens.authAuditService),
          resolve(containerTokens.accountStatusService),
          resolve(containerTokens.securityNotificationService),
          resolve(containerTokens.passwordPolicyService),
        ),
    });
    container.register({
      token: containerTokens.passwordController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.passwordService,
        containerTokens.captchaService,
        containerTokens.mfaVerificationService,
      ],
      resolve: ({ resolve }) =>
        new PasswordController(
          resolve(containerTokens.passwordService),
          resolve(containerTokens.captchaService),
          resolve(containerTokens.mfaVerificationService),
        ),
    });
  },
};
