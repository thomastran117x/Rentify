import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationBlogRepository } from "@/features/organizations/blog/blog.repository";
import { OrganizationBlogService } from "@/features/organizations/blog/blog.service";
import { OrganizationBlogController } from "@/features/organizations/blog/blog.controller";

export const organizationsBlogRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-blog",
    register(container) {
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
          containerTokens.organizationBlogPublicSearchService,
          containerTokens.organizationBlogCommentSocketServer,
        ],
        resolve: ({ resolve }) =>
          new OrganizationBlogService(
            resolve(containerTokens.organizationBlogRepository),
            resolve(containerTokens.organizationAccessService),
            resolve(containerTokens.organizationAuditService),
            resolve(containerTokens.blobService),
            resolve(containerTokens.organizationBlogPublicSearchService),
            resolve(containerTokens.organizationBlogCommentSocketServer),
          ),
      });
      container.register({
        token: containerTokens.organizationBlogController,
        lifetime: "scoped",
        dependencies: [containerTokens.organizationBlogService],
        resolve: ({ resolve }) =>
          new OrganizationBlogController(
            resolve(containerTokens.organizationBlogService),
          ),
      });
    },
  };
