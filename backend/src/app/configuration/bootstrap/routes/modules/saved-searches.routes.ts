import { containerTokens } from "@/configuration/bootstrap/container";
import type { SavedSearchesController } from "@/features/saved-searches/saved-searches.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const savedSearchesRouteModule: RouteModule = {
  id: "saved-searches",
  register(app, { resolveHandler }) {
    app.post(
      "/saved-searches",
      resolveHandler<SavedSearchesController>(
        containerTokens.savedSearchesController,
        "create",
      ),
    );
    app.get(
      "/saved-searches",
      resolveHandler<SavedSearchesController>(
        containerTokens.savedSearchesController,
        "list",
      ),
    );
    app.patch(
      "/saved-searches/:id",
      resolveHandler<SavedSearchesController>(
        containerTokens.savedSearchesController,
        "update",
      ),
    );
    app.delete(
      "/saved-searches/:id",
      resolveHandler<SavedSearchesController>(
        containerTokens.savedSearchesController,
        "delete",
      ),
    );
  },
};
