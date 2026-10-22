import { containerTokens } from "@/configuration/container/tokens";
import type { ContainerRegistrationModule } from "@/configuration/container/registrations/types";
import { AccountStatusAdminController } from "@/features/auth/account-status/account-status-admin.controller";
import { AccountStatusService } from "@/features/auth/account-status/account-status.service";

export const authAccountStatusRegistrationModule: ContainerRegistrationModule =
  {
    id: "auth-account-status",
    register(container) {
      container.register({
        token: containerTokens.accountStatusService,
        lifetime: "singleton",
        dependencies: [
          containerTokens.authUsersRepository,
          containerTokens.tokenService,
          containerTokens.authAuditService,
          containerTokens.emailService,
        ],
        resolve: ({ resolve }) =>
          new AccountStatusService(
            resolve(containerTokens.authUsersRepository),
            resolve(containerTokens.tokenService),
            resolve(containerTokens.authAuditService),
            resolve(containerTokens.emailService),
          ),
      });
      container.register({
        token: containerTokens.accountStatusAdminController,
        lifetime: "scoped",
        dependencies: [containerTokens.accountStatusService],
        resolve: ({ resolve }) =>
          new AccountStatusAdminController(
            resolve(containerTokens.accountStatusService),
          ),
      });
    },
  };
