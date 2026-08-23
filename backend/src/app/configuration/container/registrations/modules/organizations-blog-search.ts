import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationBlogSearchController } from "@/features/organizations/blog/search/blog-search.controller";
import { OrganizationBlogSearchIndexService } from "@/features/organizations/blog/search/index.service";
import { OrganizationBlogPublicSearchService } from "@/features/organizations/blog/search/public-search.service";
import { OrganizationBlogSearchService } from "@/features/organizations/blog/search/blog-search.service";
import { SearchQueueService } from "@/features/search/search.queue.service";

export const organizationsBlogSearchRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-blog-search",
    register(container) {
      container.register({
        token: containerTokens.organizationBlogSearchIndexService,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new OrganizationBlogSearchIndexService(),
      });
      container.register({
        token: containerTokens.organizationBlogSearchQueueService,
        lifetime: "singleton",
        dependencies: [containerTokens.organizationBlogSearchIndexService],
        // Scope the RabbitMQ exchange/queue names to the blog index so blog,
        // organization, and posting index jobs never share a topology.
        resolve: ({ resolve }) =>
          new SearchQueueService(
            resolve(
              containerTokens.organizationBlogSearchIndexService,
            ).getBaseIndexName(),
          ),
      });
      container.register({
        token: containerTokens.organizationBlogPublicSearchService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.organizationBlogRepository,
          containerTokens.organizationBlogSearchIndexService,
        ],
        resolve: ({ resolve }) =>
          new OrganizationBlogPublicSearchService(
            resolve(containerTokens.organizationBlogRepository),
            resolve(containerTokens.organizationBlogSearchIndexService),
          ),
      });
      container.register({
        token: containerTokens.organizationBlogSearchService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.organizationBlogRepository,
          containerTokens.organizationBlogSearchIndexService,
          containerTokens.organizationBlogSearchQueueService,
        ],
        resolve: ({ resolve }) =>
          new OrganizationBlogSearchService(
            resolve(containerTokens.organizationBlogRepository),
            resolve(containerTokens.organizationBlogSearchIndexService),
            resolve(containerTokens.organizationBlogSearchQueueService),
          ),
      });
      container.register({
        token: containerTokens.organizationBlogSearchController,
        lifetime: "scoped",
        dependencies: [containerTokens.organizationBlogSearchService],
        resolve: ({ resolve }) =>
          new OrganizationBlogSearchController(
            resolve(containerTokens.organizationBlogSearchService),
          ),
      });
    },
  };
