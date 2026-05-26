import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { ReportsController } from "@/features/reports/reports.controller";
import { ReportsRepository } from "@/features/reports/reports.repository";
import { ReportsService } from "@/features/reports/reports.service";
import { ReportsSearchIndexService } from "@/features/reports/search/index.service";

export const reportsRegistrationModule: ContainerRegistrationModule = {
  id: "reports",
  register(container) {
    container.register({
      token: containerTokens.reportsRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new ReportsRepository(),
    });
    container.register({
      token: containerTokens.reportsSearchIndexService,
      lifetime: "scoped",
      dependencies: [],
      resolve: () => new ReportsSearchIndexService(),
    });
    container.register({
      token: containerTokens.reportsService,
      lifetime: "scoped",
      dependencies: [
        containerTokens.reportsRepository,
        containerTokens.reportsSearchIndexService,
        containerTokens.contentSanitizationService,
      ],
      resolve: ({ resolve }) =>
        new ReportsService(
          resolve(containerTokens.reportsRepository),
          resolve(containerTokens.reportsSearchIndexService),
          resolve(containerTokens.contentSanitizationService),
        ),
    });
    container.register({
      token: containerTokens.reportsController,
      lifetime: "scoped",
      dependencies: [containerTokens.reportsService],
      resolve: ({ resolve }) =>
        new ReportsController(resolve(containerTokens.reportsService)),
    });
  },
};
