import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationAuditRepository } from "@/features/organizations/audit/audit.repository";
import { OrganizationAuditService } from "@/features/organizations/audit/audit.service";
import { OrganizationAuditController } from "@/features/organizations/audit/audit.controller";

export const organizationsAuditRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-audit",
    register(container) {
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
          containerTokens.organizationsRepository,
          containerTokens.postingsRepository,
          containerTokens.seasonalPricingRepository,
          containerTokens.emailService,
          containerTokens.organizationLogoService,
          containerTokens.organizationPostingProjectionService,
        ],
        resolve: ({ resolve }) =>
          new OrganizationAuditService(
            resolve(containerTokens.organizationAuditRepository),
            resolve(containerTokens.organizationAccessService),
            resolve(containerTokens.organizationsRepository),
            resolve(containerTokens.postingsRepository),
            resolve(containerTokens.seasonalPricingRepository),
            resolve(containerTokens.emailService),
            resolve(containerTokens.organizationLogoService),
            resolve(containerTokens.organizationPostingProjectionService),
          ),
      });
      container.register({
        token: containerTokens.organizationAuditController,
        lifetime: "scoped",
        dependencies: [containerTokens.organizationAuditService],
        resolve: ({ resolve }) =>
          new OrganizationAuditController(
            resolve(containerTokens.organizationAuditService),
          ),
      });
    },
  };
