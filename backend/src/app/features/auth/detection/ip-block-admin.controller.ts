import { isIP } from "node:net";
import type { Request, Response } from "express";
import { noContent, ok } from "@/configuration/http/responses";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import { RequestValidationError } from "@/configuration/validation/request";
import { asUuid } from "@/configuration/validation/uuid";
import type { AdminAuditReader } from "@/features/auth/audit/auth-audit-admin.model";
import { toAuthAuditContext } from "@/features/auth/audit/auth-audit-context";
import { requireMinimumRole } from "@/features/auth/authorization";
import type { AuthIpBlockAdminService } from "@/features/auth/detection/ip-block-admin.service";

/**
 * Admin-only view and removal of IP blocks. As with the audit log, the role
 * is checked before the address is looked at, and personal access tokens are
 * rejected.
 */
export class AuthIpBlockAdminController {
  constructor(private readonly adminService: AuthIpBlockAdminService) {}

  listBlocks = async (request: Request, response: Response): Promise<void> => {
    const reader = await this.requireAdmin(request);
    ok(response, await this.adminService.listBlocks(reader));
  };

  unblock = async (request: Request, response: Response): Promise<void> => {
    const reader = await this.requireAdmin(request);
    const ipAddress = requireSafeRouteParam(request, "ip").trim();

    if (isIP(ipAddress) === 0) {
      throw new RequestValidationError("Route parameter validation failed.", [
        { path: "ip", message: "`ip` must be an IPv4 or IPv6 address." },
      ]);
    }

    await this.adminService.unblock(ipAddress, reader);
    noContent(response);
  };

  private async requireAdmin(request: Request): Promise<AdminAuditReader> {
    const auth = await requireSessionAuth(request);
    requireMinimumRole(auth, "admin");

    return {
      userId: asUuid(auth.sub),
      context: toAuthAuditContext(request),
    };
  }
}
