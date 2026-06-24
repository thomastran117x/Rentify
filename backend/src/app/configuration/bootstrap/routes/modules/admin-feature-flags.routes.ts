import { containerTokens } from "@/configuration/bootstrap/container";
import type { FeatureFlagController } from "@/features/feature-flags/feature-flag.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const adminFeatureFlagsRouteModule: RouteModule = {
  id: "admin-feature-flags",
  register(app, { resolveHandler }) {
    app.get(
      "/admin/feature-flags",
      resolveHandler<FeatureFlagController>(
        containerTokens.featureFlagController,
        "list",
      ),
    );
    app.put(
      "/admin/feature-flags/:name",
      resolveHandler<FeatureFlagController>(
        containerTokens.featureFlagController,
        "set",
      ),
    );
    app.delete(
      "/admin/feature-flags/:name",
      resolveHandler<FeatureFlagController>(
        containerTokens.featureFlagController,
        "delete",
      ),
    );
  },
};
