import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { ContentSanitizationService } from "@/features/security/content-sanitization.service";

export const securityRegistrationModule: ContainerRegistrationModule = {
  id: "security",
  register(container) {
    container.register({
      token: containerTokens.contentSanitizationService,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new ContentSanitizationService(),
    });
  },
};
