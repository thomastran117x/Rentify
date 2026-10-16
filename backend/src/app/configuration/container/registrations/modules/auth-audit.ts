import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";
import { AuthAuditService } from "@/features/auth/audit/auth-audit.service";

export const authAuditRegistrationModule: ContainerRegistrationModule = {
  id: "auth-audit",
  register(container) {
    container.register({
      token: containerTokens.authAuditRepository,
      lifetime: "singleton",
      dependencies: [],
      resolve: () => new AuthAuditRepository(),
    });
    container.register({
      token: containerTokens.authAuditService,
      lifetime: "singleton",
      dependencies: [containerTokens.authAuditRepository],
      resolve: ({ resolve }) =>
        new AuthAuditService(resolve(containerTokens.authAuditRepository)),
    });
  },
};
