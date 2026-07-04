import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  created,
  noContent,
  ok,
} from "@/configuration/http/responses";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import { parseRequestBody } from "@/configuration/validation/request";
import {
  createSavedSearchRequestSchema,
  updateSavedSearchRequestSchema,
} from "@/features/saved-searches/saved-searches.model";
import type { SavedSearchesService } from "@/features/saved-searches/saved-searches.service";

export class SavedSearchesController {
  constructor(private readonly savedSearchesService: SavedSearchesService) {}

  create = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    const body = await parseRequestBody(
      context,
      createSavedSearchRequestSchema,
    );
    const result = await this.savedSearchesService.create(auth.sub, body);

    return created(context, result, {
      message: "Saved search created successfully.",
    });
  };

  list = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    const result = await this.savedSearchesService.list(auth.sub);

    return ok(context, result);
  };

  update = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    const id = requireSafeRouteParam(context, "id");
    const body = await parseRequestBody(
      context,
      updateSavedSearchRequestSchema,
    );
    const result = await this.savedSearchesService.update(auth.sub, id, body);

    return ok(context, result, {
      message: "Saved search updated successfully.",
    });
  };

  delete = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    const id = requireSafeRouteParam(context, "id");
    await this.savedSearchesService.delete(auth.sub, id);

    return noContent();
  };
}
