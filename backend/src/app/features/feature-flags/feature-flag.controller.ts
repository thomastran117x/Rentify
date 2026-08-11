import type { Request, Response } from "express";
import { getQuery } from "@/configuration/http/request";
import { ok } from "@/configuration/http/responses";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import { requireMinimumRole } from "@/features/auth/authorization";
import type { FeatureFlagService } from "@/features/feature-flags/feature-flag.service";
import {
  type ListFlagsFilter,
  setFlagBodySchema,
} from "@/features/feature-flags/feature-flag.model";

export class FeatureFlagController {
  constructor(private readonly featureFlagService: FeatureFlagService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    requireMinimumRole(auth, "admin");

    const filter: ListFlagsFilter = {};
    const enabledParam = getQuery(request).enabled;
    if (enabledParam === "true") filter.enabled = true;
    else if (enabledParam === "false") filter.enabled = false;

    const search = getQuery(request).search?.trim();
    if (search) filter.search = search;

    const group = getQuery(request).group?.trim();
    if (group) filter.group = group;

    const flags = await this.featureFlagService.listAll(filter);
    ok(response, flags);
  };

  set = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    requireMinimumRole(auth, "admin");

    const name = requireSafeRouteParam(request, "name");
    const body = await parseRequestBody(request, setFlagBodySchema);

    const result = await this.featureFlagService.setFlag({
      name,
      enabled: body.enabled,
      description: body.description,
      group: body.group,
      actorUserId: auth.sub,
    });

    ok(response, result);
  };

  delete = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    requireMinimumRole(auth, "admin");

    const name = requireSafeRouteParam(request, "name");
    const result = await this.featureFlagService.deleteFlag({
      name,
      actorUserId: auth.sub,
    });

    ok(response, result);
  };
}
