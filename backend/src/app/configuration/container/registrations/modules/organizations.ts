import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationsController } from "@/features/organizations/organizations.controller";
import { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { OrganizationAuditRepository } from "@/features/organizations/organization-audit.repository";
import { OrganizationAuditService } from "@/features/organizations/organization-audit.service";
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
      token: containerTokens.organizationAccessService,
      lifetime: "scoped",
      dependencies: [containerTokens.authRepository],
      resolve: ({ resolve }) =>
        new OrganizationAccessService(resolve(containerTokens.authRepository)),
    });
    container.register({
      token: containerTokens.organizationAuditRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new OrganizationAuditRepository(),
    });
    container.register({
      token: containerTokens.organizationAuditService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.organizationAuditRepository,
        containerTokens.organizationAccessService,
      ],
      resolve: ({ resolve }) =>
        new OrganizationAuditService(
          resolve(containerTokens.organizationAuditRepository),
          resolve(containerTokens.organizationAccessService),
        ),
    });
    container.register({
      token: containerTokens.organizationsService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.organizationsRepository,
        containerTokens.authRepository,
        containerTokens.emailService,
        containerTokens.organizationAuditService,
        containerTokens.postingsRepository,
        containerTokens.seasonalPricingRepository,
      ],
      resolve: ({ resolve }) =>
        new OrganizationsService(
          resolve(containerTokens.organizationsRepository),
          resolve(containerTokens.authRepository),
          resolve(containerTokens.emailService),
          resolve(containerTokens.organizationAuditService),
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.seasonalPricingRepository),
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
