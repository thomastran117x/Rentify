import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationsController } from "@/features/organizations/organizations.controller";
import { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { OrganizationAuditRepository } from "@/features/organizations/organization-audit.repository";
import { OrganizationAuditService } from "@/features/organizations/organization-audit.service";
import { OrganizationAnnouncementRepository } from "@/features/organizations/organization-announcement.repository";
import { OrganizationAnnouncementService } from "@/features/organizations/organization-announcement.service";
import { OrganizationBlogRepository } from "@/features/organizations/organization-blog.repository";
import { OrganizationBlogService } from "@/features/organizations/organization-blog.service";
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
      token: containerTokens.organizationAnnouncementRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new OrganizationAnnouncementRepository(),
    });
    container.register({
      token: containerTokens.organizationAnnouncementService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.organizationAnnouncementRepository,
        containerTokens.organizationAccessService,
        containerTokens.organizationAuditService,
      ],
      resolve: ({ resolve }) =>
        new OrganizationAnnouncementService(
          resolve(containerTokens.organizationAnnouncementRepository),
          resolve(containerTokens.organizationAccessService),
          resolve(containerTokens.organizationAuditService),
        ),
    });
    container.register({
      token: containerTokens.organizationBlogRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new OrganizationBlogRepository(),
    });
    container.register({
      token: containerTokens.organizationBlogService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.organizationBlogRepository,
        containerTokens.organizationAccessService,
        containerTokens.organizationAuditService,
        containerTokens.blobService,
      ],
      resolve: ({ resolve }) =>
        new OrganizationBlogService(
          resolve(containerTokens.organizationBlogRepository),
          resolve(containerTokens.organizationAccessService),
          resolve(containerTokens.organizationAuditService),
          resolve(containerTokens.blobService),
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
        containerTokens.blobService,
        containerTokens.organizationsPublicSearchService,
        containerTokens.organizationAnnouncementService,
        containerTokens.organizationBlogService,
      ],
      resolve: ({ resolve }) =>
        new OrganizationsService(
          resolve(containerTokens.organizationsRepository),
          resolve(containerTokens.authRepository),
          resolve(containerTokens.emailService),
          resolve(containerTokens.organizationAuditService),
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.seasonalPricingRepository),
          resolve(containerTokens.blobService),
          resolve(containerTokens.organizationsPublicSearchService),
          resolve(containerTokens.organizationAnnouncementService),
          resolve(containerTokens.organizationBlogService),
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
