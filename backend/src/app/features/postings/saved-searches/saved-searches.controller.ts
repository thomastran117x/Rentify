import type { Request, Response } from "express";
import { getRequestUrl } from "@/configuration/http/request";
import {
  created,
  noContent,
  ok,
  paginationMeta,
} from "@/configuration/http/responses";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import {
  RequestValidationError,
  parseRequestBody,
} from "@/configuration/validation/request";
import { postingResourceIdSchema } from "@/features/postings/postings.model";
import {
  createSavedSearchSchema,
  listSavedSearchesQuerySchema,
  updateSavedSearchSchema,
  type CreateSavedSearchRequest,
  type ListSavedSearchesQuery,
  type UpdateSavedSearchRequest,
} from "@/features/postings/saved-searches/saved-searches.model";
import type { SavedSearchesService } from "@/features/postings/saved-searches/saved-searches.service";
import { type Uuid } from "@/configuration/validation/uuid";

export class SavedSearchesController {
  constructor(private readonly savedSearchesService: SavedSearchesService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const query = this.parseListQuery(request);
    const result = await this.savedSearchesService.list(
      auth.sub,
      query.page,
      query.pageSize,
    );

    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const body: CreateSavedSearchRequest = await parseRequestBody(
      request,
      createSavedSearchSchema,
    );
    const result = await this.savedSearchesService.create(auth.sub, body);

    created(response, result, {
      message: "Search saved successfully.",
    });
  };

  update = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const body: UpdateSavedSearchRequest = await parseRequestBody(
      request,
      updateSavedSearchSchema,
    );
    const result = await this.savedSearchesService.update(
      this.requireRouteId(request),
      auth.sub,
      body,
    );

    ok(response, result, {
      message: "Saved search updated successfully.",
    });
  };

  remove = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    await this.savedSearchesService.remove(
      this.requireRouteId(request),
      auth.sub,
    );

    noContent(response);
  };

  markSeen = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    await this.savedSearchesService.markSeen(
      this.requireRouteId(request),
      auth.sub,
    );

    noContent(response);
  };

  private parseListQuery(request: Request): ListSavedSearchesQuery {
    const url = getRequestUrl(request);

    try {
      return listSavedSearchesQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private requireRouteId(request: Request): Uuid {
    const value = requireSafeRouteParam(request, "id");

    try {
      return postingResourceIdSchema.parse(value);
    } catch (error) {
      throw this.toValidationError(error, "Route parameter validation failed.");
    }
  }

  private toValidationError(
    error: unknown,
    message: string,
  ): RequestValidationError {
    if ("issues" in (error as object)) {
      const issues = (
        error as { issues?: Array<{ path: PropertyKey[]; message: string }> }
      ).issues;

      return new RequestValidationError(
        message,
        (issues ?? []).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }

    throw error;
  }
}
