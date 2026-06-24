import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { ok } from "@/configuration/http/responses";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import { requireMinimumRole } from "@/features/auth/authorization";
import type { FeatureFlagService } from "@/features/feature-flags/feature-flag.service";
import { setFlagBodySchema } from "@/features/feature-flags/feature-flag.model";

export class FeatureFlagController {
  constructor(private readonly featureFlagService: FeatureFlagService) {}

  list = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    requireMinimumRole(auth, "admin");

    const flags = await this.featureFlagService.listAll();
    return ok(context, flags);
  };

  set = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    requireMinimumRole(auth, "admin");

    const name = requireSafeRouteParam(context, "name");
    const body = await parseRequestBody(context, setFlagBodySchema);

    const result = await this.featureFlagService.setFlag({
      name,
      enabled: body.enabled,
      description: body.description,
      actorUserId: auth.sub,
    });

    return ok(context, result);
  };

  delete = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    requireMinimumRole(auth, "admin");

    const name = requireSafeRouteParam(context, "name");
    const result = await this.featureFlagService.deleteFlag({
      name,
      actorUserId: auth.sub,
    });

    return ok(context, result);
  };
}
