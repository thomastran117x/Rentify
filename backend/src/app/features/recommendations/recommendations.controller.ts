import type { Request, Response } from "express";
import { getRequestUrl } from "@/configuration/http/request";
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

  list = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.getOptionalAuth(request);
    const result = await this.recommendationQueryService.getRecommendations(
      this.parseRecommendationQueryInput(request),
      auth,
    );

    ok(response, result, {
      meta: mergeResponseMeta(
        paginationMeta(result),
        pickMeta(result, ["mode", "fallback", "snapshotGeneratedAt"]),
      ),
    });
  };

  private parseRecommendationQueryInput(
    request: Request,
  ): RecommendationQueryInput {
    const url = getRequestUrl(request);

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
    request: Request,
  ): Promise<AuthPrincipal | null> {
    return getOptionalJwtAuth(request);
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
