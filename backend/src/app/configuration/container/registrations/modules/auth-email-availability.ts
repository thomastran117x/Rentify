import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { EmailAvailabilityService } from "@/features/auth/email-availability/email-availability.service";

export const authEmailAvailabilityRegistrationModule: ContainerRegistrationModule =
  {
    id: "auth-email-availability",
    register(container) {
      container.register({
        token: containerTokens.emailAvailabilityService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.authUsersRepository,
          containerTokens.pendingSignupStore,
          containerTokens.emailChangeStore,
          containerTokens.emailChangeRevertRepository,
        ],
        resolve: ({ resolve }) =>
          new EmailAvailabilityService(
            resolve(containerTokens.authUsersRepository),
            resolve(containerTokens.pendingSignupStore),
            resolve(containerTokens.emailChangeStore),
            resolve(containerTokens.emailChangeRevertRepository),
          ),
      });
    },
  };
