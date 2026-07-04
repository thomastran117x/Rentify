import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { SavedSearchAlertService } from "@/features/saved-searches/saved-search-alert.service";
import { SavedSearchesController } from "@/features/saved-searches/saved-searches.controller";
import { SavedSearchesRepository } from "@/features/saved-searches/saved-searches.repository";
import { SavedSearchesService } from "@/features/saved-searches/saved-searches.service";

export const savedSearchesRegistrationModule: ContainerRegistrationModule = {
  id: "saved-searches",
  register(container) {
    container.register({
      token: containerTokens.savedSearchesRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new SavedSearchesRepository(),
    });
    container.register({
      token: containerTokens.savedSearchesService,
      lifetime: "scoped",
      dependencies: [containerTokens.savedSearchesRepository],
      resolve: ({ resolve }) =>
        new SavedSearchesService(
          resolve(containerTokens.savedSearchesRepository),
        ),
    });
    container.register({
      token: containerTokens.savedSearchesController,
      lifetime: "scoped",
      dependencies: [containerTokens.savedSearchesService],
      resolve: ({ resolve }) =>
        new SavedSearchesController(
          resolve(containerTokens.savedSearchesService),
        ),
    });
    container.register({
      token: containerTokens.savedSearchAlertService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.savedSearchesRepository,
        containerTokens.emailService,
      ],
      resolve: ({ resolve }) =>
        new SavedSearchAlertService(
          resolve(containerTokens.savedSearchesRepository),
          resolve(containerTokens.emailService),
        ),
    });
  },
};
