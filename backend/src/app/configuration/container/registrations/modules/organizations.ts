import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationsController } from "@/features/organizations/organizations.controller";
import { OrganizationsRepository } from "@/features/organizations/organizations.repository";
import { OrganizationsService } from "@/features/organizations/organizations.service";

export const organizationsRegistrationModule: ContainerRegistrationModule = {
  id: "organizations",
  register(container) {
    container.register({
      token: containerTokens.organizationsRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new OrganizationsRepository(),
    });
    container.register({
      token: containerTokens.organizationsService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.organizationsRepository,
        containerTokens.authRepository,
        containerTokens.emailService,
      ],
      resolve: ({ resolve }) =>
        new OrganizationsService(
          resolve(containerTokens.organizationsRepository),
          resolve(containerTokens.authRepository),
          resolve(containerTokens.emailService),
        ),
    });
    container.register({
      token: containerTokens.organizationsController,
      lifetime: "scoped",
      dependencies: [containerTokens.organizationsService],
      resolve: ({ resolve }) =>
        new OrganizationsController(
          resolve(containerTokens.organizationsService),
        ),
    });
  },
};
