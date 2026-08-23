import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationAnnouncementRepository } from "@/features/organizations/announcements/announcements.repository";
import { OrganizationAnnouncementService } from "@/features/organizations/announcements/announcements.service";
import { OrganizationAnnouncementsController } from "@/features/organizations/announcements/announcements.controller";

export const organizationsAnnouncementsRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-announcements",
    register(container) {
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
        token: containerTokens.organizationAnnouncementsController,
        lifetime: "scoped",
        dependencies: [containerTokens.organizationAnnouncementService],
        resolve: ({ resolve }) =>
          new OrganizationAnnouncementsController(
            resolve(containerTokens.organizationAnnouncementService),
          ),
      });
    },
  };
