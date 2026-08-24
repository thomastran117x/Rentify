import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationsInvitationsRepository } from "@/features/organizations/invitations/invitations.repository";
import { OrganizationInvitationsService } from "@/features/organizations/invitations/invitations.service";
import { OrganizationInvitationsController } from "@/features/organizations/invitations/invitations.controller";

export const organizationsInvitationsRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-invitations",
    register(container) {
      container.register({
        token: containerTokens.organizationsInvitationsRepository,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new OrganizationsInvitationsRepository(),
      });
      container.register({
        token: containerTokens.organizationInvitationsService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.organizationsInvitationsRepository,
          containerTokens.organizationsMembersRepository,
          containerTokens.organizationsProfileRepository,
          containerTokens.authUsersRepository,
          containerTokens.emailService,
          containerTokens.organizationAuditService,
        ],
        resolve: ({ resolve }) =>
          new OrganizationInvitationsService(
            resolve(containerTokens.organizationsInvitationsRepository),
            resolve(containerTokens.organizationsMembersRepository),
            resolve(containerTokens.organizationsProfileRepository),
            resolve(containerTokens.authUsersRepository),
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
