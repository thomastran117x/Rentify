import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { PendingSignupStore } from "@/features/auth/pending-signup/pending-signup.store";

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
  },
};
