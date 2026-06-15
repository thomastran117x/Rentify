import { containerTokens } from "@/configuration/bootstrap/container";
import type { FeedbacksController } from "@/features/feedbacks/feedbacks.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const feedbacksRouteModule: RouteModule = {
  id: "feedbacks",
  register(app, { resolveHandler }) {
    app.post(
      "/feedback",
      resolveHandler<FeedbacksController>(
        containerTokens.feedbacksController,
        "create",
      ),
    );
  },
};
