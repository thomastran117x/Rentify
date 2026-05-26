import { containerTokens } from "@/configuration/bootstrap/container";
import type { ReportsController } from "@/features/reports/reports.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const reportsRouteModule: RouteModule = {
  id: "reports",
  register(app, { resolveHandler }) {
    app.post(
      "/reports",
      resolveHandler<ReportsController>(
        containerTokens.reportsController,
        "create",
      ),
    );
  },
};

export const moderationReportsRouteModule: RouteModule = {
  id: "moderation-reports",
  register(app, { resolveHandler }) {
    app.get(
      "/moderation/reports",
      resolveHandler<ReportsController>(
        containerTokens.reportsController,
        "listModeration",
      ),
    );
    app.get(
      "/moderation/reports/:id",
      resolveHandler<ReportsController>(
        containerTokens.reportsController,
        "getModerationById",
      ),
    );
    app.post(
      "/moderation/reports/:id/assignment",
      resolveHandler<ReportsController>(
        containerTokens.reportsController,
        "assign",
      ),
    );
    app.post(
      "/moderation/reports/:id/status",
      resolveHandler<ReportsController>(
        containerTokens.reportsController,
        "updateStatus",
      ),
    );
  },
};
