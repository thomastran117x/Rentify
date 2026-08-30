import type { Request, Response } from "express";
import { getRequestUrl } from "@/configuration/http/request";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import {
  RequestValidationError,
  parseRequestBody,
} from "@/configuration/validation/request";
import { requireUuidRouteParam } from "@/configuration/validation/input-sanitization";
import type {
  BookingQuoteBody,
  BookingQuoteInput,
  CancelBookingRequestBody,
  CreateBookingRequestBody,
  CreateBookingRequestInput,
  DecideBookingRequestInput,
  ListBookingRequestsQuery,
  ListOwnedBookingRequestsInput,
  ListOwnerBookingRequestsInput,
  ListRenterBookingRequestsInput,
  OwnerBookingDashboardInput,
  OwnerBookingDashboardQuery,
  RenterBookingDashboardInput,
  RenterBookingDashboardQuery,
  UpdateBookingRequestInput,
} from "@/features/bookings/bookings.model";
import {
  bookingQuoteSchema,
  cancelBookingRequestSchema,
  createBookingRequestSchema,
  decideBookingRequestSchema,
  listBookingRequestsQuerySchema,
  ownerBookingDashboardQuerySchema,
  renterBookingDashboardQuerySchema,
  updateBookingRequestSchema,
} from "@/features/bookings/bookings.model";
import type { BookingsService } from "@/features/bookings/bookings.service";
import type { RecommendationActivityPublisher } from "@/features/recommendations/recommendation-activity.publisher";
import { asOptionalUuid, asUuid, type Uuid } from "@/configuration/validation/uuid";

export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly recommendationActivityPublisher: RecommendationActivityPublisher,
  ) {}

  createForPosting = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, createBookingRequestSchema);
    const result = await this.bookingsService.create(
      this.toCreateInput(this.requirePostingId(request), auth.sub, body),
    );
    await this.recommendationActivityPublisher.publishBookingRequestCreated({
      bookingRequest: result,
      client: request.client,
      requestId: this.readRequestId(request),
    });
    created(response, result, {
      message: "Booking request created successfully.",
    });
  };

  quoteForPosting = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, bookingQuoteSchema);
    const result = await this.bookingsService.quote(
      this.toQuoteInput(this.requirePostingId(request), auth.sub, body),
    );
    ok(response, result);
  };

  listMine = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.bookingsService.listMine(
      this.toListMineInput(auth.sub, this.parseListQuery(request)),
    );
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  listOwned = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.bookingsService.listOwned(
      this.toListOwnedInput(auth.sub, this.parseListQuery(request)),
    );
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  dashboardMine = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.bookingsService.dashboardMine(
      this.toDashboardMineInput(
        auth.sub,
        this.parseRenterDashboardQuery(request),
      ),
    );
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  dashboardOwned = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.bookingsService.dashboardOwned(
      this.toDashboardOwnedInput(
        auth.sub,
        this.parseOwnerDashboardQuery(request),
      ),
    );
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  listForOwnerPosting = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.bookingsService.listForOwnerPosting(
      this.toListOwnerPostingInput(
        auth.sub,
        this.requirePostingId(request),
        this.parseListQuery(request),
      ),
    );
    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  getById = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.bookingsService.getById(
      this.requireBookingRequestId(request),
      auth.sub,
    );
    ok(response, result);
  };

  getCancellationQuote = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const auth = await this.requireAuth(request);
    const result = await this.bookingsService.getCancellationQuote(
      this.requireBookingRequestId(request),
      auth.sub,
    );
    ok(response, result);
  };

  updateOwn = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, updateBookingRequestSchema);
    const result = await this.bookingsService.updateOwnPending(
      this.toUpdateInput(this.requireBookingRequestId(request), auth.sub, body),
    );
    ok(response, result, {
      message: "Booking request updated successfully.",
    });
  };

  approve = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, decideBookingRequestSchema);
    const result = await this.bookingsService.approve(
      this.toDecisionInput(
        this.requireBookingRequestId(request),
        auth.sub,
        body,
      ),
    );
    ok(response, result, {
      message: "Booking request approved successfully.",
    });
  };

  decline = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, decideBookingRequestSchema);
    const result = await this.bookingsService.decline(
      this.toDecisionInput(
        this.requireBookingRequestId(request),
        auth.sub,
        body,
      ),
    );
    ok(response, result, {
      message: "Booking request declined successfully.",
    });
  };

  cancel = async (request: Request, response: Response): Promise<void> => {
    const auth = await this.requireAuth(request);
    const body = await parseRequestBody(request, cancelBookingRequestSchema);
    const result = await this.bookingsService.cancel(
      this.toCancelInput(this.requireBookingRequestId(request), auth.sub, body),
    );
    ok(response, result, {
      message: "Booking request cancelled successfully.",
    });
  };

  private parseListQuery(request: Request): ListBookingRequestsQuery {
    const url = getRequestUrl(request);

    try {
      return listBookingRequestsQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseRenterDashboardQuery(
    request: Request,
  ): RenterBookingDashboardQuery {
    const url = getRequestUrl(request);

    try {
      return renterBookingDashboardQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        sort: url.searchParams.get("sort") ?? undefined,
        bucket: url.searchParams.get("bucket") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private parseOwnerDashboardQuery(
    request: Request,
  ): OwnerBookingDashboardQuery {
    const url = getRequestUrl(request);

    try {
      return ownerBookingDashboardQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
        sort: url.searchParams.get("sort") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        actionNeeded: url.searchParams.get("actionNeeded") ?? undefined,
        postingId: url.searchParams.get("postingId") ?? undefined,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
    }
  }

  private toCreateInput(
    postingId: Uuid,
    renterId: Uuid,
    body: CreateBookingRequestBody,
  ): CreateBookingRequestInput {
    return {
      postingId,
      renterId,
      startAt: body.startAt,
      endAt: body.endAt,
      guestCount: body.guestCount,
      note: body.note ?? null,
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      contactPhoneNumber: body.contactPhoneNumber ?? null,
    };
  }

  private toQuoteInput(
    postingId: Uuid,
    renterId: Uuid,
    body: BookingQuoteBody,
  ): BookingQuoteInput {
    return {
      postingId,
      renterId,
      startAt: body.startAt,
      endAt: body.endAt,
      guestCount: body.guestCount,
      note: body.note ?? null,
    };
  }

  private toDecisionInput(
    bookingRequestId: Uuid,
    actorUserId: Uuid,
    body: {
      note?: string | null;
    },
  ): DecideBookingRequestInput {
    return {
      bookingRequestId,
      actorUserId,
      note: body.note ?? null,
    };
  }

  private toUpdateInput(
    bookingRequestId: Uuid,
    renterId: Uuid,
    body: {
      startAt: string;
      endAt: string;
      guestCount?: number;
      note?: string | null;
      contactName: string;
      contactEmail: string;
      contactPhoneNumber?: string | null;
    },
  ): UpdateBookingRequestInput {
    return {
      bookingRequestId,
      renterId,
      startAt: body.startAt,
      endAt: body.endAt,
      guestCount: body.guestCount,
      note: body.note ?? null,
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      contactPhoneNumber: body.contactPhoneNumber ?? null,
    };
  }

  private toCancelInput(
    bookingRequestId: Uuid,
    actorUserId: Uuid,
    body: CancelBookingRequestBody,
  ) {
    return {
      bookingRequestId,
      actorUserId,
      reason: body.reason ?? null,
    };
  }

  private toListMineInput(
    renterId: Uuid,
    query: ListBookingRequestsQuery,
  ): ListRenterBookingRequestsInput {
    return {
      renterId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    };
  }

  private toListOwnedInput(
    actorUserId: Uuid,
    query: ListBookingRequestsQuery,
  ): ListOwnedBookingRequestsInput {
    return {
      actorUserId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    };
  }

  private toListOwnerPostingInput(
    actorUserId: Uuid,
    postingId: Uuid,
    query: ListBookingRequestsQuery,
  ): ListOwnerBookingRequestsInput {
    return {
      actorUserId,
      postingId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    };
  }

  private toDashboardMineInput(
    renterId: Uuid,
    query: RenterBookingDashboardQuery,
  ): RenterBookingDashboardInput {
    return {
      renterId,
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      bucket: query.bucket,
      status: query.status,
    };
  }

  private toDashboardOwnedInput(
    actorUserId: Uuid,
    query: OwnerBookingDashboardQuery,
  ): OwnerBookingDashboardInput {
    return {
      actorUserId,
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      status: query.status,
      actionNeeded: query.actionNeeded,
      postingId: query.postingId,
    };
  }

  private requirePostingId(request: Request): Uuid {
    return requireUuidRouteParam(request, "id");
  }

  private requireBookingRequestId(request: Request): Uuid {
    return requireUuidRouteParam(request, "id");
  }

  private async requireAuth(request: Request) {
    return requireJwtAuth(request);
  }

  private readRequestId(request: Request): string | undefined {
    return request.requestId;
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
