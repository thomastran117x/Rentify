import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationsMembersRepository } from "@/features/organizations/members/members.repository";
import { OrganizationMembersService } from "@/features/organizations/members/members.service";
import { OrganizationMembersController } from "@/features/organizations/members/members.controller";

export const organizationsMembersRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-members",
    register(container) {
      container.register({
        token: containerTokens.organizationsMembersRepository,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new OrganizationsMembersRepository(),
      });
      container.register({
        token: containerTokens.organizationMembersService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.organizationsMembersRepository,
          containerTokens.organizationsProfileRepository,
          containerTokens.authUsersRepository,
          containerTokens.organizationAuditService,
        ],
        resolve: ({ resolve }) =>
          new OrganizationMembersService(
            resolve(containerTokens.organizationsMembersRepository),
            resolve(containerTokens.organizationsProfileRepository),
            resolve(containerTokens.authUsersRepository),
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
