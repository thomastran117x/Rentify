import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { UsernameController } from "@/features/auth/username/username.controller";
import { UsernameService } from "@/features/auth/username/username.service";

export const authUsernameRegistrationModule: ContainerRegistrationModule = {
  id: "auth-username",
  register(container) {
    container.register({
      token: containerTokens.usernameService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authRepository,
        containerTokens.usernameBloomService,
        containerTokens.pendingSignupStore,
        containerTokens.publicOtpService,
      ],
      resolve: ({ resolve }) =>
        new UsernameService(
          resolve(containerTokens.authRepository),
          resolve(containerTokens.usernameBloomService),
          resolve(containerTokens.pendingSignupStore),
          resolve(containerTokens.publicOtpService),
        ),
    });
    container.register({
      token: containerTokens.usernameController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.usernameService,
        containerTokens.captchaService,
      ],
      resolve: ({ resolve }) =>
        new UsernameController(
          resolve(containerTokens.usernameService),
          resolve(containerTokens.captchaService),
        ),
    });
  },
};
