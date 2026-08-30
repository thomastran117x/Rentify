import type { Request, Response } from "express";
import { getQuery } from "@/configuration/http/request";
import { ok, paginationMeta } from "@/configuration/http/responses";
import {
  requireAuth,
  requireOrganizationId,
  requireRouteValue,
} from "@/features/organizations/organizations.request-helpers";
import {
  listOrganizationAuditQuerySchema,
  organizationAuditIdSchema,
} from "@/features/organizations/audit/audit.model";
import { OrganizationAuditService } from "@/features/organizations/audit/audit.service";
import { asUuid } from "@/configuration/validation/uuid";

export class OrganizationAuditController {
  constructor(private readonly auditService: OrganizationAuditService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireAuth(request);
    const query = listOrganizationAuditQuerySchema.parse(getQuery(request));
    const result = await this.auditService.list({
      ...query,
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
    });
    ok(response, result, { meta: paginationMeta(result) });
  };

  restoreVersion = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await requireAuth(request);
    const result = await this.auditService.restoreVersion({
      organizationId: asUuid(requireOrganizationId(request)),
      actorUserId: asUuid(auth.sub),
      auditId: requireRouteValue(
        request,
        "auditId",
        organizationAuditIdSchema,
        "Route parameter validation failed.",
      ),
    });
    ok(response, result, {
      message: "Organization version restored successfully.",
    });
  };
}
