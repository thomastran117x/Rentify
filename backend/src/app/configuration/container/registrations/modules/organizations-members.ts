import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationMembersService } from "@/features/organizations/members/members.service";
import { OrganizationMembersController } from "@/features/organizations/members/members.controller";

export const organizationsMembersRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-members",
    register(container) {
      container.register({
        token: containerTokens.organizationMembersService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.organizationsRepository,
          containerTokens.authRepository,
          containerTokens.organizationAuditService,
        ],
        resolve: ({ resolve }) =>
          new OrganizationMembersService(
            resolve(containerTokens.organizationsRepository),
            resolve(containerTokens.authRepository),
            resolve(containerTokens.organizationAuditService),
          ),
      });
      container.register({
        token: containerTokens.organizationMembersController,
        lifetime: "scoped",
        dependencies: [containerTokens.organizationMembersService],
        resolve: ({ resolve }) =>
          new OrganizationMembersController(
            resolve(containerTokens.organizationMembersService),
          ),
      });
    },
  };
