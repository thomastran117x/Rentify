import { containerTokens } from "@/configuration/bootstrap/container";
import type { BlobController } from "@/features/blob/blob.controller";
import type { ProfileController } from "@/features/profile/profile.controller";
import type { SearchController } from "@/features/search/search.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const blobRouteModule: RouteModule = {
  id: "blob",
  register(app, { resolveHandler }) {
    app.post(
      "/blob/upload-url",
      resolveHandler<BlobController>(
        containerTokens.blobController,
        "createUploadUrl",
      ),
    );
    app.put(
      "/blob/upload",
      resolveHandler<BlobController>(
        containerTokens.blobController,
        "uploadLocal",
      ),
    );
    app.get(
      "/blob/file",
      resolveHandler<BlobController>(
        containerTokens.blobController,
        "getLocal",
      ),
    );
  },
};

export const profilesRouteModule: RouteModule = {
  id: "profiles",
  register(app, { resolveHandler }) {
    app.get(
      "/profiles",
      resolveHandler<ProfileController>(
        containerTokens.profileController,
        "list",
      ),
    );
    app.get(
      "/profile/me",
      resolveHandler<ProfileController>(
        containerTokens.profileController,
        "getMe",
      ),
    );
    app.put(
      "/profile/me",
      resolveHandler<ProfileController>(
        containerTokens.profileController,
        "updateMe",
      ),
    );
  },
};

export const searchAdminRouteModule: RouteModule = {
  id: "search-admin",
  register(app, { resolveHandler }) {
    app.post(
      "/admin/search/reindex",
      resolveHandler<SearchController>(
        containerTokens.searchController,
        "startReindex",
      ),
    );
    app.get(
      "/admin/search/reindex-runs/:id",
      resolveHandler<SearchController>(
        containerTokens.searchController,
        "getReindexRun",
      ),
    );
    app.get(
      "/admin/search/status",
      resolveHandler<SearchController>(
        containerTokens.searchController,
        "getStatus",
      ),
    );
    app.post(
      "/admin/search/outbox/replay-dead-lettered",
      resolveHandler<SearchController>(
        containerTokens.searchController,
        "replayDeadLettered",
      ),
    );
    app.post(
      "/admin/search/cleanup-retained-indices",
      resolveHandler<SearchController>(
        containerTokens.searchController,
        "cleanupRetainedIndices",
      ),
    );
  },
};
