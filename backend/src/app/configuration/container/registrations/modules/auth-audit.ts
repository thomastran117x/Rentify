import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { AuthAuditActivityService } from "@/features/auth/audit/auth-audit-activity.service";
import { AuthAuditController } from "@/features/auth/audit/auth-audit.controller";
import { AuthAuditRepository } from "@/features/auth/audit/auth-audit.repository";
import { AuthAuditRetentionService } from "@/features/auth/audit/auth-audit-retention.service";
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
    container.register({
      token: containerTokens.authAuditRetentionService,
      lifetime: "singleton",
      dependencies: [containerTokens.authAuditRepository],
      resolve: ({ resolve }) =>
        new AuthAuditRetentionService(
          resolve(containerTokens.authAuditRepository),
        ),
    });
    container.register({
      token: containerTokens.authAuditActivityService,
      lifetime: "singleton",
      dependencies: [
        containerTokens.authAuditRepository,
        containerTokens.deviceRepository,
      ],
      resolve: ({ resolve }) =>
        new AuthAuditActivityService(
          resolve(containerTokens.authAuditRepository),
          resolve(containerTokens.deviceRepository),
        ),
    });
    container.register({
      token: containerTokens.authAuditController,
      lifetime: "scoped",
      dependencies: [
        containerTokens.authAuditActivityService,
        containerTokens.mfaVerificationService,
      ],
      resolve: ({ resolve }) =>
        new AuthAuditController(
          resolve(containerTokens.authAuditActivityService),
          resolve(containerTokens.mfaVerificationService),
        ),
    });
  },
};
