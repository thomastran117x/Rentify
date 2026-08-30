import type { Request, Response } from "express";
import { getRequestUrl } from "@/configuration/http/request";
import { ok, paginationMeta } from "@/configuration/http/responses";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import { parseRequestBody } from "@/configuration/validation/request";
import type {
  ListProfilesInput,
  ListProfilesQuery,
  UpdateProfileInput,
  UpdateProfileRequestBody,
} from "@/features/profile/profile.model";
import {
  listProfilesQuerySchema,
  updateProfileRequestSchema,
} from "@/features/profile/profile.model";
import { ProfileService } from "@/features/profile/profile.service";
import { RequestValidationError } from "@/configuration/validation/request";
import { asUuid } from "@/configuration/validation/uuid";

export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const input = this.parseListProfilesInput(request);
    const result = await this.profileService.list(input);
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  getMe = async (request: Request, response: Response): Promise<void> => {
    await requireJwtAuth(request);
    const result = await this.profileService.getByUserId(request.auth.sub);
    ok(response, result);
  };

  updateMe = async (request: Request, response: Response): Promise<void> => {
    await requireJwtAuth(request);
    const input = await parseRequestBody(request, updateProfileRequestSchema);
    const result = await this.profileService.update(
      this.toUpdateProfileInput(request, input),
    );
    ok(response, result, {
      message: "Profile updated successfully.",
    });
  };

  private toUpdateProfileInput(
    request: Request,
    input: UpdateProfileRequestBody,
  ): UpdateProfileInput {
    return {
      userId: asUuid(request.auth.sub),
      username: input.username,
      phoneNumber: input.phoneNumber,
      isPrivate: input.isPrivate,
      recommendationPersonalizationEnabled:
        input.recommendationPersonalizationEnabled,
      avatarUrl: input.avatarUrl,
      avatarBlobName: input.avatarBlobName,
      trustworthinessScore: input.trustworthinessScore,
      rentPostingsCount: input.rentPostingsCount,
      availableRentPostingsCount: input.availableRentPostingsCount,
    };
  }

  private parseListProfilesInput(request: Request): ListProfilesInput {
    const url = getRequestUrl(request);

    try {
      const query = listProfilesQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
      });

      return this.toListProfilesInput(query);
    } catch (error) {
      if ("issues" in (error as object)) {
        const issues = (
          error as { issues?: Array<{ path: PropertyKey[]; message: string }> }
        ).issues;

        throw new RequestValidationError(
          "Request query validation failed.",
          (issues ?? []).map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }

      throw error;
    }
  }

  private toListProfilesInput(query: ListProfilesQuery): ListProfilesInput {
    return {
      page: query.page,
      pageSize: query.pageSize,
      query: query.q,
    };
  }
}
