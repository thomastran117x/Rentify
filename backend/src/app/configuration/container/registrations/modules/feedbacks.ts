import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { FeedbacksController } from "@/features/feedbacks/feedbacks.controller";
import { FeedbacksRepository } from "@/features/feedbacks/feedbacks.repository";
import { FeedbacksService } from "@/features/feedbacks/feedbacks.service";

export const feedbacksRegistrationModule: ContainerRegistrationModule = {
  id: "feedbacks",
  register(container) {
    container.register({
      token: containerTokens.feedbacksRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new FeedbacksRepository(),
    });
    container.register({
      token: containerTokens.feedbacksService,
      lifetime: "scoped",
      dependencies: [containerTokens.feedbacksRepository],
      resolve: ({ resolve }) =>
        new FeedbacksService(resolve(containerTokens.feedbacksRepository)),
    });
    container.register({
      token: containerTokens.feedbacksController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.feedbacksService,
        containerTokens.captchaService,
      ],
      resolve: ({ resolve }) =>
        new FeedbacksController(
          resolve(containerTokens.feedbacksService),
          resolve(containerTokens.captchaService),
        ),
    });
  },
};
