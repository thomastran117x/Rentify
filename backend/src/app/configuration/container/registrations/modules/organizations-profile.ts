import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationsRepository } from "@/features/organizations/organizations.repository";
import { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { OrganizationLogoService } from "@/features/organizations/organization-logo.service";
import { OrganizationPostingProjectionService } from "@/features/organizations/organization-posting-projection.service";
import { OrganizationProfileService } from "@/features/organizations/profile/profile.service";
import { OrganizationProfileController } from "@/features/organizations/profile/profile.controller";

export const organizationsProfileRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-profile",
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
      // Shared collaborators used by both the profile domain (create/update)
      // and the audit domain (restoring a version) -- registered here since
      // profile is the more foundational of the two.
      container.register({
        token: containerTokens.organizationLogoService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.blobService,
          containerTokens.organizationAuditRepository,
        ],
        resolve: ({ resolve }) =>
          new OrganizationLogoService(
            resolve(containerTokens.blobService),
            resolve(containerTokens.organizationAuditRepository),
          ),
      });
      container.register({
        token: containerTokens.organizationPostingProjectionService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.postingsRepository,
          containerTokens.postingsPublicCacheService,
        ],
        resolve: ({ resolve }) =>
          new OrganizationPostingProjectionService(
            resolve(containerTokens.postingsRepository),
            resolve(containerTokens.postingsPublicCacheService),
          ),
      });
      container.register({
        token: containerTokens.organizationProfileService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.organizationsRepository,
          containerTokens.authRepository,
          containerTokens.organizationAuditService,
          containerTokens.organizationInvitationsService,
          containerTokens.organizationLogoService,
          containerTokens.organizationPostingProjectionService,
          containerTokens.organizationsPublicSearchService,
        ],
        resolve: ({ resolve }) =>
          new OrganizationProfileService(
            resolve(containerTokens.organizationsRepository),
            resolve(containerTokens.authRepository),
            resolve(containerTokens.organizationAuditService),
            resolve(containerTokens.organizationInvitationsService),
            resolve(containerTokens.organizationLogoService),
            resolve(containerTokens.organizationPostingProjectionService),
            resolve(containerTokens.organizationsPublicSearchService),
          ),
      });
      container.register({
        token: containerTokens.organizationProfileController,
        lifetime: "scoped",
        dependencies: [containerTokens.organizationProfileService],
        resolve: ({ resolve }) =>
          new OrganizationProfileController(
            resolve(containerTokens.organizationProfileService),
          ),
      });
    },
  };
