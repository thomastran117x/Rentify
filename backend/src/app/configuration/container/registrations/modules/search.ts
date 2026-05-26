import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { SearchController } from "@/features/search/search.controller";
import { SearchQueueService } from "@/features/search/search.queue.service";
import { SearchService } from "@/features/search/search.service";

export const searchRegistrationModule: ContainerRegistrationModule = {
  id: "search",
  register(container) {
    container.register({
      token: containerTokens.searchQueueService,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new SearchQueueService(),
    });
    container.register({
      token: containerTokens.searchService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.postingsRepository,
        containerTokens.postingsSearchIndexService,
        containerTokens.searchQueueService,
      ],
      resolve: ({ resolve }) =>
        new SearchService(
          resolve(containerTokens.postingsRepository),
          resolve(containerTokens.postingsSearchIndexService),
          resolve(containerTokens.searchQueueService),
        ),
    });
    container.register({
      token: containerTokens.searchController,
      lifetime: "scoped",
      dependencies: [containerTokens.searchService],
      resolve: ({ resolve }) =>
        new SearchController(resolve(containerTokens.searchService)),
    });
  },
};
