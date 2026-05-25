import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
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

export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  list = async (context: Context<AppBindings>): Promise<Response> => {
    const input = this.parseListProfilesInput(context);
    const result = await this.profileService.list(input);
    return ok(context, result, {
      meta: paginationMeta(result),
    });
  };

  getMe = async (context: Context<AppBindings>): Promise<Response> => {
    await requireJwtAuth(context);
    const result = await this.profileService.getByUserId(
      context.get("auth").sub,
    );
    return ok(context, result);
  };

  updateMe = async (context: Context<AppBindings>): Promise<Response> => {
    await requireJwtAuth(context);
    const input = await parseRequestBody(context, updateProfileRequestSchema);
    const result = await this.profileService.update(
      this.toUpdateProfileInput(context, input),
    );
    return ok(context, result, {
      message: "Profile updated successfully.",
    });
  };

  private toUpdateProfileInput(
    context: Context<AppBindings>,
    input: UpdateProfileRequestBody,
  ): UpdateProfileInput {
    return {
      userId: context.get("auth").sub,
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

  private parseListProfilesInput(
    context: Context<AppBindings>,
  ): ListProfilesInput {
    const url = new URL(context.req.url);

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
