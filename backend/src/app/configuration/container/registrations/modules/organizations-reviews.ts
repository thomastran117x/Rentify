import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationReviewRepository } from "@/features/organizations/reviews/reviews.repository";
import { OrganizationReviewService } from "@/features/organizations/reviews/reviews.service";
import { OrganizationReviewsController } from "@/features/organizations/reviews/reviews.controller";

export const organizationsReviewsRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-reviews",
    register(container) {
      container.register({
        token: containerTokens.organizationReviewRepository,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new OrganizationReviewRepository(),
      });
      container.register({
        token: containerTokens.organizationReviewService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.organizationReviewRepository,
          containerTokens.organizationAccessService,
          containerTokens.organizationAuditService,
          containerTokens.rentingsRepository,
        ],
        resolve: ({ resolve }) =>
          new OrganizationReviewService(
            resolve(containerTokens.organizationReviewRepository),
            resolve(containerTokens.organizationAccessService),
            resolve(containerTokens.organizationAuditService),
            resolve(containerTokens.rentingsRepository),
          ),
      });
      container.register({
        token: containerTokens.organizationReviewsController,
        lifetime: "scoped",
        dependencies: [containerTokens.organizationReviewService],
        resolve: ({ resolve }) =>
          new OrganizationReviewsController(
            resolve(containerTokens.organizationReviewService),
          ),
      });
    },
  };
