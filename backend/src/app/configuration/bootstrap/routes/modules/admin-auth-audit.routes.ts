import { containerTokens } from "@/configuration/bootstrap/container";
import type { AuthAuditAdminController } from "@/features/auth/audit/auth-audit-admin.controller";
import type { AuthIpBlockAdminController } from "@/features/auth/detection/ip-block-admin.controller";
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
    app.get(
      "/admin/auth/ip-blocks",
      resolveHandler<AuthIpBlockAdminController>(
        containerTokens.authIpBlockAdminController,
        "listBlocks",
      ),
    );
    app.delete(
      "/admin/auth/ip-blocks/:ip",
      resolveHandler<AuthIpBlockAdminController>(
        containerTokens.authIpBlockAdminController,
        "unblock",
      ),
    );
  },
};
