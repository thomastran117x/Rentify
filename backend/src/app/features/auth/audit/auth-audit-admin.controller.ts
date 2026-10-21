import type { Request, Response } from "express";
import { getQuery, getRequestUrl } from "@/configuration/http/request";
import { ok } from "@/configuration/http/responses";
import { requireSessionAuth } from "@/configuration/middlewares/jwt-middleware";
import { requireUuidRouteParam } from "@/configuration/validation/input-sanitization";
import { parseRequestQuery } from "@/configuration/validation/request";
import { asUuid } from "@/configuration/validation/uuid";
import { requireMinimumRole } from "@/features/auth/authorization";
import { toAuthAuditContext } from "@/features/auth/audit/auth-audit-context";
import {
  adminAuthAuditQuerySchema,
  type AdminAuditReader,
} from "@/features/auth/audit/auth-audit-admin.model";
import type { AuthAuditAdminService } from "@/features/auth/audit/auth-audit-admin.service";

/**
 * Admin-only reads of the auth audit log. The role is checked before the
 * query or route parameter is looked at, so a non-admin learns nothing from
 * a validation error. Personal access tokens are rejected: this view exposes
 * other users' IP addresses and devices.
 */
export class AuthAuditAdminController {
  constructor(private readonly adminService: AuthAuditAdminService) {}

  listEvents = async (request: Request, response: Response): Promise<void> => {
    const reader = await this.requireAdmin(request);
    // `eventType` is repeatable; getQuery keeps only the first value.
    const eventTypes = getRequestUrl(request).searchParams.getAll("eventType");
    const query = parseRequestQuery(
      {
        ...getQuery(request),
        ...(eventTypes.length > 0 ? { eventType: eventTypes } : {}),
      },
      adminAuthAuditQuerySchema,
    );
    const result = await this.adminService.listEvents(query, reader);
    ok(response, result);
  };

  getUserSecurity = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const reader = await this.requireAdmin(request);
    const userId = requireUuidRouteParam(request, "id");
    const result = await this.adminService.getUserSecuritySummary(
      userId,
      reader,
    );
    ok(response, result);
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
