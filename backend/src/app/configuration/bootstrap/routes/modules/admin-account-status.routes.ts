import { containerTokens } from "@/configuration/bootstrap/container";
import type { AccountStatusAdminController } from "@/features/auth/account-status/account-status-admin.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const adminAccountStatusRouteModule: RouteModule = {
  id: "admin-account-status",
  register(app, { resolveHandler }) {
    app.post(
      "/admin/users/:id/lock",
      resolveHandler<AccountStatusAdminController>(
        containerTokens.accountStatusAdminController,
        "lock",
      ),
    );
    app.post(
      "/admin/users/:id/suspend",
      resolveHandler<AccountStatusAdminController>(
        containerTokens.accountStatusAdminController,
        "suspend",
      ),
    );
    app.post(
      "/admin/users/:id/reinstate",
      resolveHandler<AccountStatusAdminController>(
        containerTokens.accountStatusAdminController,
        "reinstate",
      ),
    );
  },
};
