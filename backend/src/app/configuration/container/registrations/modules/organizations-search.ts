import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { OrganizationsSearchController } from "@/features/organizations/search/search.controller";
import { OrganizationsSearchIndexService } from "@/features/organizations/search/index.service";
import { OrganizationsPublicSearchService } from "@/features/organizations/search/public-search.service";
import { OrganizationsSearchService } from "@/features/organizations/search/search.service";
import { SearchQueueService } from "@/features/search/search.queue.service";

export const organizationsSearchRegistrationModule: ContainerRegistrationModule =
  {
    id: "organizations-search",
    register(container) {
      container.register({
        token: containerTokens.organizationsSearchIndexService,
        lifetime: "singleton",
        dependencies: [],
        resolve: () => new OrganizationsSearchIndexService(),
      });
      container.register({
        token: containerTokens.organizationSearchQueueService,
        lifetime: "singleton",
        dependencies: [containerTokens.organizationsSearchIndexService],
        // Scope the RabbitMQ exchange/queue names to the organization index so
        // organization and posting index jobs never share a topology.
        resolve: ({ resolve }) =>
          new SearchQueueService(
            resolve(
              containerTokens.organizationsSearchIndexService,
            ).getBaseIndexName(),
          ),
      });
      container.register({
        token: containerTokens.organizationsPublicSearchService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.organizationsRepository,
          containerTokens.organizationsSearchIndexService,
        ],
        resolve: ({ resolve }) =>
          new OrganizationsPublicSearchService(
            resolve(containerTokens.organizationsRepository),
            resolve(containerTokens.organizationsSearchIndexService),
          ),
      });
      container.register({
        token: containerTokens.organizationsSearchService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.organizationsRepository,
          containerTokens.organizationsSearchIndexService,
          containerTokens.organizationSearchQueueService,
        ],
        resolve: ({ resolve }) =>
          new OrganizationsSearchService(
            resolve(containerTokens.organizationsRepository),
            resolve(containerTokens.organizationsSearchIndexService),
            resolve(containerTokens.organizationSearchQueueService),
          ),
      });
      container.register({
        token: containerTokens.organizationsSearchController,
        lifetime: "scoped",
        dependencies: [containerTokens.organizationsSearchService],
        resolve: ({ resolve }) =>
          new OrganizationsSearchController(
            resolve(containerTokens.organizationsSearchService),
          ),
      });
    },
  };
