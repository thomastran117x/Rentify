import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { EmailAvailabilityController } from "@/features/auth/email-availability/email-availability.controller";
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
          containerTokens.emailBloomService,
          containerTokens.pendingSignupStore,
        ],
        resolve: ({ resolve }) =>
          new EmailAvailabilityService(
            resolve(containerTokens.authUsersRepository),
            resolve(containerTokens.emailBloomService),
            resolve(containerTokens.pendingSignupStore),
          ),
      });
      container.register({
        token: containerTokens.emailAvailabilityController,
        lifetime: "scoped",
        dependencies: [containerTokens.emailAvailabilityService],
        resolve: ({ resolve }) =>
          new EmailAvailabilityController(
            resolve(containerTokens.emailAvailabilityService),
          ),
      });
    },
  };
