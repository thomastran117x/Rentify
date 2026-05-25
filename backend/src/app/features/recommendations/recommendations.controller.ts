import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import {
  mergeResponseMeta,
  ok,
  paginationMeta,
  pickMeta,
} from "@/configuration/http/responses";
import { getOptionalJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { RequestValidationError } from "@/configuration/validation/request";
import type { AuthPrincipal } from "@/features/auth/auth.principal";
import type { RecommendationQueryService } from "@/features/recommendations/recommendation-query.service";
import {
  recommendationQuerySchema,
  type RecommendationQuery,
  type RecommendationQueryInput,
} from "@/features/recommendations/recommendation-query.model";

export class RecommendationsController {
  constructor(
    private readonly recommendationQueryService: RecommendationQueryService,
  ) {}

  list = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.getOptionalAuth(context);
    const result = await this.recommendationQueryService.getRecommendations(
      this.parseRecommendationQueryInput(context),
      auth,
    );

    return ok(context, result, {
      meta: mergeResponseMeta(
        paginationMeta(result),
        pickMeta(result, ["mode", "fallback", "snapshotGeneratedAt"]),
      ),
    });
  };

  private parseRecommendationQueryInput(
    context: Context<AppBindings>,
  ): RecommendationQueryInput {
    const url = new URL(context.req.url);

    try {
      const query = recommendationQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        family: url.searchParams.get("family") ?? undefined,
        subtype: url.searchParams.get("subtype") ?? undefined,
        latitude: url.searchParams.get("latitude") ?? undefined,
        longitude: url.searchParams.get("longitude") ?? undefined,
        radiusKm: url.searchParams.get("radiusKm") ?? undefined,
        startAt: url.searchParams.get("startAt") ?? undefined,
        endAt: url.searchParams.get("endAt") ?? undefined,
      });

      return this.toRecommendationQueryInput(query);
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private toRecommendationQueryInput(
    query: RecommendationQuery,
  ): RecommendationQueryInput {
    if ((query.startAt === undefined) !== (query.endAt === undefined)) {
      throw new RequestValidationError("Request query validation failed.", [
        {
          path: "startAt",
          message: "startAt and endAt must be provided together.",
        },
      ]);
    }

    if ((query.latitude === undefined) !== (query.longitude === undefined)) {
      throw new RequestValidationError("Request query validation failed.", [
        {
          path: "latitude",
          message: "latitude and longitude must be provided together.",
        },
      ]);
    }

    return {
      page: query.page,
      pageSize: query.pageSize,
      family: query.family,
      subtype: query.subtype,
      geo:
        query.latitude !== undefined && query.longitude !== undefined
          ? {
              latitude: query.latitude,
              longitude: query.longitude,
              radiusKm: query.radiusKm,
            }
          : undefined,
      availabilityWindow:
        query.startAt !== undefined && query.endAt !== undefined
          ? {
              startAt: query.startAt,
              endAt: query.endAt,
            }
          : undefined,
    };
  }

  private async getOptionalAuth(
    context: Context<AppBindings>,
  ): Promise<AuthPrincipal | null> {
    return getOptionalJwtAuth(context);
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
