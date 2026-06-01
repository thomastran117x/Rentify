import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import { getAuthRole } from "@/features/auth/authorization";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import {
  RequestValidationError,
  parseRequestBody,
} from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import type {
  CreateRentingDisputeBody,
  CreateRentingDisputeInput,
  ListMyRentingsInput,
  ListRentingsQuery,
  RentingActorInput,
  UpdateRentingInstructionsBody,
  UpdateRentingInstructionsInput,
} from "@/features/rentings/rentings.model";
import {
  createRentingDisputeSchema,
  listRentingsQuerySchema,
  updateRentingInstructionsSchema,
} from "@/features/rentings/rentings.model";
import type { RecommendationActivityPublisher } from "@/features/recommendations/recommendation-activity.publisher";
import type { RentingsService } from "@/features/rentings/rentings.service";

export class RentingsController {
  constructor(
    private readonly rentingsService: RentingsService,
    private readonly recommendationActivityPublisher: RecommendationActivityPublisher,
  ) {}

  convertBookingRequest = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.rentingsService.convertApprovedBookingRequest({
      bookingRequestId: this.requireBookingRequestId(context),
      actorUserId: auth.sub,
    });
    await this.recommendationActivityPublisher.publishRentingConfirmed({
      renting: result,
      client: context.get("client"),
      requestId: this.readRequestId(context),
    });
    return created(context, result, {
      message: "Booking request converted to renting successfully.",
    });
  };

  getById = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.rentingsService.getById(
      this.requireRentingId(context),
      auth.sub,
      getAuthRole(auth),
    );
    return ok(context, result);
  };

  listMine = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const query = this.parseListQuery(context);
    const result = await this.rentingsService.listMine(
      this.toListMineInput(auth.sub, query),
    );
    return ok(context, result, {
      meta: paginationMeta(result),
    });
  };

  updateInstructions = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(
      context,
      updateRentingInstructionsSchema,
    );
    const result = await this.rentingsService.updateInstructions(
      this.toUpdateInstructionsInput(
        this.requireRentingId(context),
        auth.sub,
        getAuthRole(auth),
        body,
      ),
    );
    return ok(context, result, {
      message: "Renting instructions updated successfully.",
    });
  };

  markCheckInReady = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.rentingsService.markCheckInReady(
      this.toRentingActorInput(
        this.requireRentingId(context),
        auth.sub,
        getAuthRole(auth),
      ),
    );
    return ok(context, result, {
      message: "Renting marked as check-in ready successfully.",
    });
  };

  markCheckInComplete = async (
    context: Context<AppBindings>,
  ): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.rentingsService.markCheckInComplete(
      this.toRentingActorInput(
        this.requireRentingId(context),
        auth.sub,
        getAuthRole(auth),
      ),
    );
    return ok(context, result, {
      message: "Renting check-in completed successfully.",
    });
  };

  markCompleted = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.rentingsService.markCompleted(
      this.toRentingActorInput(
        this.requireRentingId(context),
        auth.sub,
        getAuthRole(auth),
      ),
    );
    return ok(context, result, {
      message: "Renting return completed successfully.",
    });
  };

  createDispute = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, createRentingDisputeSchema);
    const result = await this.rentingsService.createDispute(
      this.toCreateDisputeInput(
        this.requireRentingId(context),
        auth.sub,
        getAuthRole(auth),
        body,
      ),
    );
    return created(context, result, {
      message: "Renting dispute opened successfully.",
    });
  };

  private parseListQuery(context: Context<AppBindings>): ListRentingsQuery {
    const url = new URL(context.req.url);

    try {
      return listRentingsQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      });
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

  private toListMineInput(
    userId: string,
    query: ListRentingsQuery,
  ): ListMyRentingsInput {
    return {
      userId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    };
  }

  private toRentingActorInput(
    rentingId: string,
    actorUserId: string,
    actorRole: ReturnType<typeof getAuthRole>,
  ): RentingActorInput {
    return {
      rentingId,
      actorUserId,
      actorRole,
    };
  }

  private toUpdateInstructionsInput(
    rentingId: string,
    actorUserId: string,
    actorRole: ReturnType<typeof getAuthRole>,
    body: UpdateRentingInstructionsBody,
  ): UpdateRentingInstructionsInput {
    return {
      rentingId,
      actorUserId,
      actorRole,
      pickupInstructions: body.pickupInstructions,
      returnInstructions: body.returnInstructions,
    };
  }

  private toCreateDisputeInput(
    rentingId: string,
    actorUserId: string,
    actorRole: ReturnType<typeof getAuthRole>,
    body: CreateRentingDisputeBody,
  ): CreateRentingDisputeInput {
    return {
      rentingId,
      actorUserId,
      actorRole,
      reason: body.reason,
      details: body.details ?? null,
    };
  }

  private requireBookingRequestId(context: Context<AppBindings>): string {
    return requireSafeRouteParam(context, "id");
  }

  private requireRentingId(context: Context<AppBindings>): string {
    return requireSafeRouteParam(context, "id");
  }

  private async requireAuth(context: Context<AppBindings>) {
    return requireJwtAuth(context);
  }

  private readRequestId(context: Context<AppBindings>): string | undefined {
    return context.get("requestId");
  }
}
