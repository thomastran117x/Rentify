import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { environment } from "@/configuration/environment";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import type { AppBindings } from "@/configuration/http/bindings";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import {
  requireJwtAuth,
  requireSessionAuth,
} from "@/configuration/middlewares/jwt-middleware";
import { requireSafeRouteParam } from "@/configuration/validation/input-sanitization";
import {
  RequestValidationError,
  parseRequestBody,
} from "@/configuration/validation/request";
import type { ListBookingMessagesQuery } from "@/features/bookings/messages/booking-messages.model";
import {
  BOOKING_MESSAGE_SOCKET_COOKIE_NAME,
  BOOKING_MESSAGE_SOCKET_PATH,
  editBookingMessageSchema,
  listBookingMessagesQuerySchema,
  sendBookingMessageSchema,
} from "@/features/bookings/messages/booking-messages.model";
import type { BookingMessagesService } from "@/features/bookings/messages/booking-messages.service";
import type { TokenService } from "@/features/auth/token/token.service";

export class BookingMessagesController {
  private readonly logger: Logger;

  constructor(
    private readonly bookingMessagesService: BookingMessagesService,
    private readonly tokenService: TokenService,
  ) {
    this.logger = loggerFactory.forClass(
      BookingMessagesController,
      "controller",
    );
  }

  send = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    const body = await parseRequestBody(context, sendBookingMessageSchema);
    const result = await this.bookingMessagesService.send({
      bookingRequestId: this.requireBookingRequestId(context),
      authorId: auth.sub,
      body: body.body,
    });

    return created(context, result, {
      message: "Message sent successfully.",
    });
  };

  list = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    const query = this.parseListQuery(context);
    const result = await this.bookingMessagesService.list({
      bookingRequestId: this.requireBookingRequestId(context),
      actorUserId: auth.sub,
      page: query.page,
      pageSize: query.pageSize,
    });

    return ok(context, result, {
      meta: paginationMeta(result),
    });
  };

  edit = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    const body = await parseRequestBody(context, editBookingMessageSchema);
    const result = await this.bookingMessagesService.edit({
      bookingRequestId: this.requireBookingRequestId(context),
      messageId: this.requireMessageId(context),
      actorUserId: auth.sub,
      body: body.body,
    });

    return ok(context, result, { message: "Message updated successfully." });
  };

  remove = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    const result = await this.bookingMessagesService.remove({
      bookingRequestId: this.requireBookingRequestId(context),
      messageId: this.requireMessageId(context),
      actorUserId: auth.sub,
    });

    return ok(context, result, { message: "Message deleted successfully." });
  };

  socketTicket = async (context: Context<AppBindings>): Promise<Response> => {
    // Session bearer only, like the socket it authorizes: a PAT must not be
    // exchangeable for a long-lived connection.
    const auth = await requireSessionAuth(context);
    const result = await this.bookingMessagesService.createSocketTicket(
      this.requireBookingRequestId(context),
      auth.sub,
    );

    // The ticket rides in an HttpOnly cookie rather than the response body or a
    // query parameter: a browser `WebSocket` cannot set headers, and the query
    // string is visible to proxies and access logs. Scoping the path keeps it
    // off every other request to this origin.
    setCookie(context, BOOKING_MESSAGE_SOCKET_COOKIE_NAME, result.ticket, {
      path: BOOKING_MESSAGE_SOCKET_PATH,
      httpOnly: true,
      secure: environment.isProduction(),
      sameSite: "Lax",
      maxAge: result.expiresInSeconds,
    });

    return created(
      context,
      { expiresInSeconds: result.expiresInSeconds },
      { message: "Socket ticket issued successfully." },
    );
  };

  markRead = async (context: Context<AppBindings>): Promise<Response> => {
    const auth = await requireJwtAuth(context);
    const result = await this.bookingMessagesService.markRead(
      this.requireBookingRequestId(context),
      auth.sub,
    );

    return ok(context, result, {
      message: "Messages marked as read.",
    });
  };

  private requireBookingRequestId(context: Context<AppBindings>): string {
    return requireSafeRouteParam(context, "id");
  }

  private requireMessageId(context: Context<AppBindings>): string {
    return requireSafeRouteParam(context, "messageId");
  }

  private parseListQuery(
    context: Context<AppBindings>,
  ): ListBookingMessagesQuery {
    const url = new URL(context.req.url);

    try {
      return listBookingMessagesQuerySchema.parse({
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
      });
    } catch (error) {
      throw this.toValidationError(error, "Request query validation failed.");
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
