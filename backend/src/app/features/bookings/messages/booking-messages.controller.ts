import type { Request, Response } from "express";
import { environment } from "@/configuration/environment";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import { getQuery, writeCookie } from "@/configuration/http/request";
import { created, ok, paginationMeta } from "@/configuration/http/responses";
import {
  requireJwtAuth,
  requireSessionAuth,
} from "@/configuration/middlewares/jwt-middleware";
import { requireUuidRouteParam } from "@/configuration/validation/input-sanitization";
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
import { asUuid, type Uuid } from "@/configuration/validation/uuid";

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

  send = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const body = await parseRequestBody(request, sendBookingMessageSchema);
    const result = await this.bookingMessagesService.send({
      bookingRequestId: asUuid(this.requireBookingRequestId(request)),
      authorId: asUuid(auth.sub),
      body: body.body,
    });

    created(response, result, {
      message: "Message sent successfully.",
    });
  };

  list = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const query = this.parseListQuery(request);
    const result = await this.bookingMessagesService.list({
      bookingRequestId: asUuid(this.requireBookingRequestId(request)),
      actorUserId: asUuid(auth.sub),
      page: query.page,
      pageSize: query.pageSize,
    });

    ok(response, result, {
      meta: paginationMeta(result),
    });
  };

  edit = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const body = await parseRequestBody(request, editBookingMessageSchema);
    const result = await this.bookingMessagesService.edit({
      bookingRequestId: asUuid(this.requireBookingRequestId(request)),
      messageId: asUuid(this.requireMessageId(request)),
      actorUserId: asUuid(auth.sub),
      body: body.body,
    });

    ok(response, result, { message: "Message updated successfully." });
  };

  remove = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const result = await this.bookingMessagesService.remove({
      bookingRequestId: asUuid(this.requireBookingRequestId(request)),
      messageId: asUuid(this.requireMessageId(request)),
      actorUserId: asUuid(auth.sub),
    });

    ok(response, result, { message: "Message deleted successfully." });
  };

  socketTicket = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    // Session bearer only, like the socket it authorizes: a PAT must not be
    // exchangeable for a long-lived connection.
    const auth = await requireSessionAuth(request);
    const result = await this.bookingMessagesService.createSocketTicket(
      this.requireBookingRequestId(request),
      auth.sub,
      // Recorded so the socket can be re-checked against this session later.
      // The claim bag is loosely typed, so both fields are narrowed rather than
      // asserted.
      {
        sessionId: typeof auth.sessionId === "string" ? auth.sessionId : null,
        tokenVersion:
          typeof auth.tokenVersion === "number" ? auth.tokenVersion : null,
      },
    );

    // The ticket rides in an HttpOnly cookie rather than the response body or a
    // query parameter: a browser `WebSocket` cannot set headers, and the query
    // string is visible to proxies and access logs. Scoping the path keeps it
    // off every other request to this origin.
    writeCookie(response, BOOKING_MESSAGE_SOCKET_COOKIE_NAME, result.ticket, {
      path: BOOKING_MESSAGE_SOCKET_PATH,
      httpOnly: true,
      secure: environment.isProduction(),
      sameSite: "Lax",
      maxAge: result.expiresInSeconds,
    });

    created(
      response,
      { expiresInSeconds: result.expiresInSeconds },
      { message: "Socket ticket issued successfully." },
    );
  };

  markRead = async (request: Request, response: Response): Promise<void> => {
    const auth = await requireJwtAuth(request);
    const result = await this.bookingMessagesService.markRead(
      this.requireBookingRequestId(request),
      auth.sub,
    );

    ok(response, result, {
      message: "Messages marked as read.",
    });
  };

  private requireBookingRequestId(request: Request): Uuid {
    return requireUuidRouteParam(request, "id");
  }

  private requireMessageId(request: Request): Uuid {
    return requireUuidRouteParam(request, "messageId");
  }

  private parseListQuery(request: Request): ListBookingMessagesQuery {
    // `getQuery` flattens repeated keys to one value each. Express hands back
    // `string[]` where Hono gave a single string, and the schema coerces
    // numbers — an array would coerce to NaN rather than fail cleanly.
    const query = getQuery(request);

    try {
      return listBookingMessagesQuerySchema.parse({
        page: query.page,
        pageSize: query.pageSize,
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
