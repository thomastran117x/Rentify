import type { Request, Response } from "express";
import { getRequestUrl } from "@/configuration/http/request";
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
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.rentingsService.convertApprovedBookingRequest({
      bookingRequestId: this.requireBookingRequestId(request),
      actorUserId: auth.sub,
    });
    await this.recommendationActivityPublisher.publishRentingConfirmed({
      renting: result,
      client: request.client,
      requestId: this.readRequestId(request),
    });
    created(response, result, {
      message: "Booking request converted to renting successfully.",
    });
  };

  getById = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.rentingsService.getById(
      this.requireRentingId(request),
      auth.sub,
      getAuthRole(auth),
    );
    ok(response, result);
  };

  listMine = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const query = this.parseListQuery(request);
    const result = await this.rentingsService.listMine(
      this.toListMineInput(auth.sub, query),
    );
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  updateInstructions = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(
      request,
      updateRentingInstructionsSchema,
    );
    const result = await this.rentingsService.updateInstructions(
      this.toUpdateInstructionsInput(
        this.requireRentingId(request),
        auth.sub,
        getAuthRole(auth),
        body,
      ),
    );
    ok(response, result, {
      message: "Renting instructions updated successfully.",
    });
  };

  markCheckInReady = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.rentingsService.markCheckInReady(
      this.toRentingActorInput(
        this.requireRentingId(request),
        auth.sub,
        getAuthRole(auth),
      ),
    );
    ok(response, result, {
      message: "Renting marked as check-in ready successfully.",
    });
  };

  markCheckInComplete = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.rentingsService.markCheckInComplete(
      this.toRentingActorInput(
        this.requireRentingId(request),
        auth.sub,
        getAuthRole(auth),
      ),
    );
    ok(response, result, {
      message: "Renting check-in completed successfully.",
    });
  };

  markCompleted = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.rentingsService.markCompleted(
      this.toRentingActorInput(
        this.requireRentingId(request),
        auth.sub,
        getAuthRole(auth),
      ),
    );
    ok(response, result, {
      message: "Renting return completed successfully.",
    });
  };

  createDispute = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, createRentingDisputeSchema);
    const result = await this.rentingsService.createDispute(
      this.toCreateDisputeInput(
        this.requireRentingId(request),
        auth.sub,
        getAuthRole(auth),
        body,
      ),
    );
    created(response, result, {
      message: "Renting dispute opened successfully.",
    });
  };

  private parseListQuery(request: Request): ListRentingsQuery {
    const url = getRequestUrl(request);

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

  private requireBookingRequestId(request: Request): string {
    return requireSafeRouteParam(request, "id");
  }

  private requireRentingId(request: Request): string {
    return requireSafeRouteParam(request, "id");
  }

  private async requireAuth(request: Request) {
    return requireJwtAuth(request);
  }

  private readRequestId(request: Request): string | undefined {
    return request.requestId;
  }
}
