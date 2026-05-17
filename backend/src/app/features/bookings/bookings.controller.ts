import type { Context } from "hono";
import type { AppBindings } from "@/configuration/http/bindings";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import { requireMinimumRole } from "@/features/auth/authorization";
import { requireJwtAuth } from "@/configuration/middlewares/jwt-middleware";
import {
  RequestValidationError,
  parseRequestBody,
} from "@/configuration/validation/request";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import type {
  BookingQuoteBody,
  BookingQuoteInput,
  CreateBookingRequestBody,
  CreateBookingRequestInput,
  DecideBookingRequestInput,
  ListBookingRequestsQuery,
  ListOwnerBookingRequestsInput,
  ListRenterBookingRequestsInput,
  UpdateBookingRequestInput,
} from "@/features/bookings/bookings.model";
import {
  bookingQuoteSchema,
  createBookingRequestSchema,
  decideBookingRequestSchema,
  listBookingRequestsQuerySchema,
  updateBookingRequestSchema,
} from "@/features/bookings/bookings.model";
import type { BookingsService } from "@/features/bookings/bookings.service";
import type { RecommendationActivityPublisher } from "@/features/recommendations/recommendation-activity.publisher";

export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly recommendationActivityPublisher: RecommendationActivityPublisher,
  ) {}

  createForPosting = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, createBookingRequestSchema);
    const result = await this.bookingsService.create(
      this.toCreateInput(this.requirePostingId(context), auth.sub, body),
    );
    await this.recommendationActivityPublisher.publishBookingRequestCreated({
      bookingRequest: result,
      client: context.get("client"),
      requestId: this.readRequestId(context),
    });
    return created(context, result, {
      message: "Booking request created successfully.",
    });
  };

  quoteForPosting = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, bookingQuoteSchema);
    const result = await this.bookingsService.quote(
      this.toQuoteInput(this.requirePostingId(context), auth.sub, body),
    );
    return ok(context, result);
  };

  listMine = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.bookingsService.listMine(
      this.toListMineInput(auth.sub, this.parseListQuery(context)),
    );
    return ok(context, result, {
      meta: paginationMeta(result),
    });
  };

  listForOwnerPosting = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    requireMinimumRole(auth, "owner");
    const result = await this.bookingsService.listForOwnerPosting(
      this.toListOwnerPostingInput(auth.sub, this.requirePostingId(context), this.parseListQuery(context)),
    );
    return ok(context, result, {
      meta: paginationMeta(result),
    });
  };

  getById = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const result = await this.bookingsService.getById(
      this.requireBookingRequestId(context),
      auth.sub,
    );
    return ok(context, result);
  };

  updateOwn = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    const body = await parseRequestBody(context, updateBookingRequestSchema);
    const result = await this.bookingsService.updateOwnPending(
      this.toUpdateInput(this.requireBookingRequestId(context), auth.sub, body),
    );
    return ok(context, result, {
      message: "Booking request updated successfully.",
    });
  };

  approve = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    requireMinimumRole(auth, "owner");
    const body = await parseRequestBody(context, decideBookingRequestSchema);
    const result = await this.bookingsService.approve(
      this.toDecisionInput(this.requireBookingRequestId(context), auth.sub, body),
    );
    return ok(context, result, {
      message: "Booking request approved successfully.",
    });
  };

  decline = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await this.requireAuth(context);
    requireMinimumRole(auth, "owner");
    const body = await parseRequestBody(context, decideBookingRequestSchema);
    const result = await this.bookingsService.decline(
      this.toDecisionInput(this.requireBookingRequestId(context), auth.sub, body),
    );
    return ok(context, result, {
      message: "Booking request declined successfully.",
    });
  };

  private parseListQuery(context: Context<AppBindings>): ListBookingRequestsQuery {
    const url = new URL(context.req.url);

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

  private toCreateInput(
    postingId: string,
    renterId: string,
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
    postingId: string,
    renterId: string,
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
    bookingRequestId: string,
    ownerId: string,
    body: {
      note?: string | null;
    },
  ): DecideBookingRequestInput {
    return {
      bookingRequestId,
      ownerId,
      note: body.note ?? null,
    };
  }

  private toUpdateInput(
    bookingRequestId: string,
    renterId: string,
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

  private toListMineInput(
    renterId: string,
    query: ListBookingRequestsQuery,
  ): ListRenterBookingRequestsInput {
    return {
      renterId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    };
  }

  private toListOwnerPostingInput(
    ownerId: string,
    postingId: string,
    query: ListBookingRequestsQuery,
  ): ListOwnerBookingRequestsInput {
    return {
      ownerId,
      postingId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    };
  }

  private requirePostingId(context: Context<AppBindings>): string {
    return requireSafeRouteParam(context, "id");
  }

  private requireBookingRequestId(context: Context<AppBindings>): string {
    return requireSafeRouteParam(context, "id");
  }

  private async requireAuth(context: Context<AppBindings>) {
    return requireJwtAuth(context);
  }

  private readRequestId(context: Context<AppBindings>): string | undefined {
    return context.get("requestId");
  }

  private toValidationError(error: unknown, message: string): RequestValidationError {
    if ("issues" in (error as object)) {
      const issues = (error as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues;

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
