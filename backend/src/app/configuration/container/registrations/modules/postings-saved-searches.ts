import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { SavedSearchAlertService } from "@/features/postings/saved-searches/saved-search-alert.service";
import { SavedSearchEmailComposer } from "@/features/postings/saved-searches/saved-search-email.composer";
import { SavedSearchesController } from "@/features/postings/saved-searches/saved-searches.controller";
import { SavedSearchesRepository } from "@/features/postings/saved-searches/saved-searches.repository";
import { SavedSearchesService } from "@/features/postings/saved-searches/saved-searches.service";

export const postingsSavedSearchesRegistrationModule: ContainerRegistrationModule =
  {
    id: "postings-saved-searches",
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
        dependencies: [
          containerTokens.savedSearchesRepository,
          containerTokens.postingsService,
        ],
        resolve: ({ resolve }) =>
          new SavedSearchesService(
            resolve(containerTokens.savedSearchesRepository),
            resolve(containerTokens.postingsService),
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
      // Worker-side. Registered here rather than in a workers module so the
      // sweep resolves the same search service the HTTP layer uses, which is
      // what keeps a saved search executing exactly like the browse page.
      container.register({
        token: containerTokens.savedSearchAlertService,
        lifetime: "scoped",
        dependencies: [
          containerTokens.savedSearchesRepository,
          containerTokens.postingsService,
          containerTokens.authUsersRepository,
          containerTokens.emailService,
        ],
        resolve: ({ resolve }) =>
          new SavedSearchAlertService(
            resolve(containerTokens.savedSearchesRepository),
            resolve(containerTokens.postingsService),
            resolve(containerTokens.authUsersRepository),
            resolve(containerTokens.emailService),
          ),
      });
      container.register({
        token: containerTokens.savedSearchEmailComposer,
        lifetime: "scoped",
        dependencies: [
          containerTokens.savedSearchesRepository,
          containerTokens.postingsPublicCacheService,
          containerTokens.authUsersRepository,
        ],
        resolve: ({ resolve }) =>
          new SavedSearchEmailComposer(
            resolve(containerTokens.savedSearchesRepository),
            resolve(containerTokens.postingsPublicCacheService),
            resolve(containerTokens.authUsersRepository),
          ),
      });
    },
  };
