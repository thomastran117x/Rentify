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
import type { TokenService } from "@/features/auth/token/token.service";

/** Kept below the 30-60s idle window a reverse proxy typically enforces. */
const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * How often an open stream re-checks that its viewer is still a party to the
 * booking. One membership lookup per connection per minute is a deliberate
 * trade: cheap enough at this scale, and it bounds how long a removed member
 * can keep reading a thread.
 */
const STREAM_REAUTHORIZE_INTERVAL_MS = 60_000;

export class BookingMessagesController {
  private readonly logger: Logger;

  constructor(
    private readonly bookingMessagesService: BookingMessagesService,
    private readonly streamHub: BookingMessageStreamHub,
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
    const tokenService = this.tokenService;
    // Kept so the periodic check can re-run the same validation REST does:
    // signature, expiry, token version, and server-side session state.
    const accessToken = (context.req.header("authorization") ?? "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    // Captured, never resolved inside the callback. The instance stays valid
    // after the scope is disposed — disposal clears the scope's resolution map
    // and runs dispose hooks, of which this graph has none — but resolving
    // from a disposed scope would not.
    const service = this.bookingMessagesService;

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
          clearInterval(reauthorize);
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

        // Authorization is otherwise checked only at connect, so a member
        // removed from the organization would keep receiving message bodies
        // for as long as they held the connection open, while every REST
        // request they made was already being rejected.
        const reauthorize = setInterval(() => {
          if (closed || stream.aborted || stream.closed) {
            teardown();
            return;
          }

          // Booking membership alone is not enough: a logged-out or revoked
          // session still belongs to a booking participant, and every REST
          // call it made would already be rejected.
          void Promise.all([
            tokenService.verifyAccessToken(accessToken),
            service.authorizeStream(bookingRequestId, auth.sub),
          ]).catch((error: unknown) => {
            logger.info(
              "Closing a booking message stream after access was revoked.",
              {
                bookingRequestId,
                userId: auth.sub,
                reason: error instanceof Error ? error.message : "unknown",
              },
            );
            teardown();
          });
        }, STREAM_REAUTHORIZE_INTERVAL_MS);

        stream.onAbort(teardown);
        context.req.raw.signal.addEventListener("abort", teardown);

        try {
          const subscription = await hub.subscribe(
            bookingRequestId,
            (event) => {
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
            },
          );

          // The client can disconnect while subscribe() is still pending, in
          // which case teardown already ran with `release` still null. Release
          // here or the listener and its Redis channel are retained forever.
          if (closed) {
            await subscription();
            return;
          }

          release = subscription;
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
