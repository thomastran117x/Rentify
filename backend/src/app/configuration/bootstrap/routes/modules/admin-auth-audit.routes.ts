import { containerTokens } from "@/configuration/bootstrap/container";
import type { AuthAuditAdminController } from "@/features/auth/audit/auth-audit-admin.controller";
import type { RouteModule } from "@/configuration/bootstrap/routes/types";

export const adminAuthAuditRouteModule: RouteModule = {
  id: "admin-auth-audit",
  register(app, { resolveHandler }) {
    app.get(
      "/admin/auth/audit",
      resolveHandler<AuthAuditAdminController>(
        containerTokens.authAuditAdminController,
        "listEvents",
      ),
    );
    app.get(
      "/admin/users/:id/security",
      resolveHandler<AuthAuditAdminController>(
        containerTokens.authAuditAdminController,
        "getUserSecurity",
      ),
    );
  },
};
