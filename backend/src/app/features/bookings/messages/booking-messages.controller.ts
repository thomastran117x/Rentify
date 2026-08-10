import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
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
import type { BookingMessageStreamHub } from "@/features/bookings/messages/booking-message-stream.hub";
import type { ListBookingMessagesQuery } from "@/features/bookings/messages/booking-messages.model";
import {
  listBookingMessagesQuerySchema,
  sendBookingMessageSchema,
} from "@/features/bookings/messages/booking-messages.model";
import type { BookingMessagesService } from "@/features/bookings/messages/booking-messages.service";

/** Kept below the 30-60s idle window a reverse proxy typically enforces. */
const HEARTBEAT_INTERVAL_MS = 20_000;

export class BookingMessagesController {
  private readonly logger: Logger;

  constructor(
    private readonly bookingMessagesService: BookingMessagesService,
    private readonly streamHub: BookingMessageStreamHub,
  ) {
    this.logger = loggerFactory.forClass(BookingMessagesController, "controller");
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

  stream = async (context: Context<AppBindings>): Promise<Response> => {
    // Everything that needs the request-scoped container MUST be resolved here,
    // before streamSSE returns: containerScopeMiddleware disposes the scope in
    // its `finally` as soon as next() resolves, and streamSSE resolves it
    // synchronously. Never resolve a dependency inside the callback below.
    const auth = await requireSessionAuth(context);
    const bookingRequestId = this.requireBookingRequestId(context);
    await this.bookingMessagesService.authorizeStream(
      bookingRequestId,
      auth.sub,
    );

    const hub = this.streamHub;
    const logger = this.logger;

    return streamSSE(
      context,
      async (stream) => {
        let closed = false;
        let release: (() => Promise<void>) | null = null;
        let finish: () => void = () => {};
        const done = new Promise<void>((resolve) => {
          finish = resolve;
        });

        const teardown = (): void => {
          if (closed) {
            return;
          }

          closed = true;
          clearInterval(heartbeat);
          void release?.();
          finish();
        };

        const heartbeat = setInterval(() => {
          // StreamingApi.write swallows every error, so an unguarded loop would
          // spin forever writing into a dead socket with nothing surfacing.
          if (closed || stream.aborted || stream.closed) {
            teardown();
            return;
          }

          void stream.writeSSE({
            event: "heartbeat",
            data: String(Date.now()),
          });
        }, HEARTBEAT_INTERVAL_MS);

        stream.onAbort(teardown);
        context.req.raw.signal.addEventListener("abort", teardown);

        try {
          release = await hub.subscribe(bookingRequestId, (event) => {
            if (closed || stream.aborted) {
              return;
            }

            void stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
              ...(event.type === "message.created"
                ? { id: event.message.id }
                : {}),
            });
          });
        } catch (error) {
          logger.error(
            "Failed to subscribe to the booking message channel.",
            { bookingRequestId },
            error,
          );
          teardown();
          return;
        }

        await stream.writeSSE({
          event: "ready",
          data: JSON.stringify({ bookingRequestId }),
        });

        // Hono closes the stream as soon as this callback returns, so hold it
        // open until the client disconnects.
        await done;
      },
      async (error) => {
        logger.error(
          "Booking message stream failed.",
          { bookingRequestId },
          error,
        );
      },
    );
  };

  private requireBookingRequestId(context: Context<AppBindings>): string {
    return requireSafeRouteParam(context, "id");
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
