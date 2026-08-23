import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationInvitationsService } from "@/features/organizations/invitations/invitations.service";
import { OrganizationInvitationsController } from "@/features/organizations/invitations/invitations.controller";

export const organizationsInvitationsRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-invitations",
    register(container) {
      container.register({
        token: containerTokens.organizationInvitationsService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.organizationsRepository,
          containerTokens.authRepository,
          containerTokens.emailService,
          containerTokens.organizationAuditService,
        ],
        resolve: ({ resolve }) =>
          new OrganizationInvitationsService(
            resolve(containerTokens.organizationsRepository),
            resolve(containerTokens.authRepository),
            resolve(containerTokens.emailService),
            resolve(containerTokens.organizationAuditService),
          ),
      });
      container.register({
        token: containerTokens.organizationInvitationsController,
        lifetime: "scoped",
        dependencies: [containerTokens.organizationInvitationsService],
        resolve: ({ resolve }) =>
          new OrganizationInvitationsController(
            resolve(containerTokens.organizationInvitationsService),
          ),
      });
    },
  };
