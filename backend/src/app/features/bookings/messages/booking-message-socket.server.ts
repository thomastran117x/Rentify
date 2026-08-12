import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server as SocketIoServer, type Socket } from "socket.io";
import { getContainer } from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import { readAllowedOrigins } from "@/configuration/middlewares/csrf.middleware";
import { getRedisClient } from "@/configuration/resources/redis";
import type { BookingParticipantSide } from "@/features/bookings/booking-participants";
import {
  BOOKING_MESSAGE_TYPING_TTL_SECONDS,
  BOOKING_MESSAGE_SOCKET_COOKIE_NAME,
  BOOKING_MESSAGE_SOCKET_PATH,
  type BookingMessageSocketIdentity,
  type BookingMessageStreamEvent,
} from "@/features/bookings/messages/booking-messages.model";

export { BOOKING_MESSAGE_SOCKET_PATH };

/** How often an open socket re-checks membership and session validity. */
const REAUTHORIZE_INTERVAL_MS = 60_000;

/** A client may not push typing frames faster than this. */
const TYPING_THROTTLE_MS = 2_000;

/** Largest client payload accepted, to bound parse cost. */
const MAX_CLIENT_FRAME_BYTES = 4_096;

/** The room every participant of a thread joins. Carries the messages. */
export function threadRoom(bookingRequestId: string): string {
  return `booking-messages:${bookingRequestId}`;
}

/**
 * The room for one *side* of a thread. Presence is a question about a side —
 * "is anyone from the organization watching" — so the side is a room and its
 * membership is the answer, with no separate bookkeeping to drift.
 */
export function sideRoom(
  bookingRequestId: string,
  side: BookingParticipantSide,
): string {
  return `booking-messages:${bookingRequestId}:${side}`;
}

/** Per-connection state, hung off the socket rather than a parallel map. */
interface SocketState {
  identity: BookingMessageSocketIdentity;
  side: BookingParticipantSide;
  canWrite: boolean;
  lastTypingAt: number;
}

type BookingMessageSocket = Socket & { state?: SocketState };

/**
 * Minimal cookie parse for the handshake. `hono/cookie` is gone and Express's
 * cookie parser never sees this request: the handshake arrives on the Socket.IO
 * engine, not through the app's middleware stack.
 */
function readTicketCookie(header?: string): string {
  if (!header) {
    return "";
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    if (
      part.slice(0, separator).trim() === BOOKING_MESSAGE_SOCKET_COOKIE_NAME
    ) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return "";
}

/**
 * Booking message realtime gateway.
 *
 * Socket.IO rather than a raw WebSocket server, which removes three things that
 * were hand-written here and reviewed at length: the heartbeat and its
 * two-round death rule, the client's reconnect ladder, and the Redis pub/sub
 * fan-out. Rooms plus the Redis adapter replace the last of those, and the
 * adapter is also what makes presence correct across replicas — a dead node's
 * sockets leave the cluster's view on their own, where a hand-kept count could
 * not expire another process's share.
 *
 * Deployment note: transports keep Socket.IO's default polling-then-upgrade, so
 * a replicated API **requires sticky sessions** at the load balancer. The
 * polling handshake is several requests, and they must land on the same node.
 */
export class BookingMessageSocketServer {
  private readonly logger: Logger;
  private io: SocketIoServer | null = null;
  private reauthorize: ReturnType<typeof setInterval> | null = null;
  private adapterClients: Array<{ quit: () => Promise<unknown> }> = [];

  constructor() {
    this.logger = loggerFactory.forClass(BookingMessageSocketServer, "service");
  }

  attach(server: HttpServer): void {
    this.io = new SocketIoServer(server, {
      path: BOOKING_MESSAGE_SOCKET_PATH,
      // Same path the ticket cookie is scoped to, so the browser attaches it to
      // the handshake and to nothing else.
      serveClient: false,
      maxHttpBufferSize: MAX_CLIENT_FRAME_BYTES,
      cors: {
        origin: readAllowedOrigins(),
        credentials: true,
      },
    });

    this.io.use((socket, next) => {
      void this.authenticate(socket as BookingMessageSocket, next);
    });

    this.io.on("connection", (socket) => {
      void this.register(socket as BookingMessageSocket);
    });

    void this.attachRedisAdapter();

    this.reauthorize = setInterval(
      () => void this.reauthorizeAll(),
      REAUTHORIZE_INTERVAL_MS,
    );
  }

  async close(): Promise<void> {
    if (this.reauthorize) {
      clearInterval(this.reauthorize);
      this.reauthorize = null;
    }

    const io = this.io;
    this.io = null;

    if (io) {
      // Disconnects every client with a close frame, then stops the engine.
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    }

    await Promise.allSettled(
      this.adapterClients.map((client) => client.quit()),
    );
    this.adapterClients = [];
  }

  /** Open sockets on this instance. Used by tests and diagnostics. */
  activeConnectionCount(): number {
    return this.io?.sockets.sockets.size ?? 0;
  }

  /**
   * Publishes a thread event to everyone watching it, on any instance.
   *
   * This is the seam the service publishes through. With the Redis adapter an
   * emit from one node reaches sockets held by every other, so the REST
   * handlers can emit directly instead of going through a private channel.
   */
  publish(event: BookingMessageStreamEvent): void {
    this.io?.to(threadRoom(event.bookingRequestId)).emit(event.type, event);
  }

  /** Whether anyone on this side is watching, across every instance. */
  async isSideOnline(
    bookingRequestId: string,
    side: BookingParticipantSide,
  ): Promise<boolean> {
    if (!this.io) {
      return false;
    }

    const sockets = await this.io
      .in(sideRoom(bookingRequestId, side))
      .fetchSockets();

    return sockets.length > 0;
  }

  /**
   * The adapter needs its own pair of connections: Redis puts a client into
   * subscriber mode exclusively, so the shared one backing cache, locks and
   * rate limiting cannot be reused.
   */
  private async attachRedisAdapter(): Promise<void> {
    try {
      const publisher = getRedisClient().duplicate();
      const subscriber = publisher.duplicate();

      await Promise.all([publisher.connect(), subscriber.connect()]);
      this.adapterClients = [publisher, subscriber];
      this.io?.adapter(createAdapter(publisher, subscriber));
    } catch (error) {
      // A single-instance deployment still works without the adapter, so this
      // must not stop the server from serving. It is logged loudly because a
      // replicated one silently loses cross-node delivery.
      this.logger.error(
        "Failed to attach the Redis adapter; realtime delivery is limited to this instance.",
        undefined,
        error,
      );
    }
  }

  private async authenticate(
    socket: BookingMessageSocket,
    next: (error?: Error) => void,
  ): Promise<void> {
    const scope = getContainer().createScope();

    try {
      const service = scope.resolve(containerTokens.bookingMessagesService);
      // Read from the HttpOnly cookie the ticket endpoint set: a browser
      // cannot set headers on this handshake, and a query parameter would put
      // the credential into proxy and access logs.
      const identity = await service.redeemSocketTicket(
        readTicketCookie(socket.handshake.headers.cookie),
      );

      if (!identity) {
        next(new Error("Unauthorized"));
        return;
      }

      // Resolved here, before the connection is accepted, so a participant who
      // lost access between minting the ticket and connecting never reaches a
      // room. Rejecting in the handshake is also cheaper than admitting and
      // tearing down.
      const authorization = await service.authorizeStream(
        identity.bookingRequestId,
        identity.userId,
      );

      socket.state = {
        identity,
        side: authorization.side,
        canWrite: authorization.canWrite,
        lastTypingAt: 0,
      };
      next();
    } catch (error) {
      this.logger.info("Rejected a booking message handshake.", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      next(new Error("Unauthorized"));
    } finally {
      await scope.dispose();
    }
  }

  private async register(socket: BookingMessageSocket): Promise<void> {
    const state = socket.state;

    if (!state) {
      socket.disconnect(true);
      return;
    }

    const { bookingRequestId } = state.identity;
    const counterpartSide = state.side === "renter" ? "owner" : "renter";

    await socket.join([
      threadRoom(bookingRequestId),
      sideRoom(bookingRequestId, state.side),
    ]);

    socket.on("typing", () => {
      void this.handleTyping(socket);
    });
    socket.on("delivered", (payload: unknown) => {
      void this.handleDelivered(socket, payload);
    });
    socket.on("disconnect", () => {
      void this.handleDisconnect(socket);
    });

    socket.emit("ready", { type: "ready", bookingRequestId });

    // Announced only by the first arrival on a side. Membership is counted
    // after this socket joined, so "1" means it is the one that changed the
    // answer — the same test the old counter made, without the bookkeeping.
    const own = await this.io
      ?.in(sideRoom(bookingRequestId, state.side))
      .fetchSockets();

    if ((own?.length ?? 0) === 1) {
      this.publish({
        type: "presence",
        bookingRequestId,
        side: state.side,
        state: "online",
      });
    }

    // The counterpart's arrival was announced before this socket existed, and a
    // presence that has not changed is never re-announced, so a client joining
    // second has to be told the current state directly.
    const counterpartOnline = await this.isSideOnline(
      bookingRequestId,
      counterpartSide,
    );

    socket.emit("presence", {
      type: "presence",
      bookingRequestId,
      side: counterpartSide,
      state: counterpartOnline ? "online" : "offline",
    });
  }

  private async handleTyping(socket: BookingMessageSocket): Promise<void> {
    const state = socket.state;

    if (!state || !state.canWrite) {
      // Connecting needs only read access, so an organization operator can hold
      // a socket while the UI withholds their composer. Nothing stops them
      // emitting this by hand, and the renter would see someone who cannot
      // reply appear to be composing.
      return;
    }

    const now = Date.now();

    // Throttled server-side as well: a client ignoring its own throttle must
    // not be able to flood the thread.
    if (now - state.lastTypingAt < TYPING_THROTTLE_MS) {
      return;
    }

    state.lastTypingAt = now;

    await this.withScope(async (scope) => {
      const authRepository = scope.resolve(containerTokens.authRepository);
      const user = await authRepository.findUserById(state.identity.userId);

      // Typing names its actor, unlike presence: a thread can have several
      // managers on the owner side, and "someone is typing" is unhelpful when
      // the renter is waiting on a specific reply.
      this.publish({
        type: "typing",
        bookingRequestId: state.identity.bookingRequestId,
        side: state.side,
        username: user?.profile?.username ?? "Someone",
        expiresAt: new Date(
          Date.now() + BOOKING_MESSAGE_TYPING_TTL_SECONDS * 1_000,
        ).toISOString(),
      });
    });
  }

  private async handleDelivered(
    socket: BookingMessageSocket,
    payload: unknown,
  ): Promise<void> {
    const state = socket.state;

    if (!state) {
      return;
    }

    const messageIds = Array.isArray(payload)
      ? payload.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [];

    if (messageIds.length === 0) {
      return;
    }

    await this.withScope(async (scope) => {
      const service = scope.resolve(containerTokens.bookingMessagesService);
      await service.markDelivered(
        state.identity.bookingRequestId,
        state.identity.userId,
        messageIds,
      );
    });
  }

  private async handleDisconnect(socket: BookingMessageSocket): Promise<void> {
    const state = socket.state;

    if (!state) {
      return;
    }

    const { bookingRequestId } = state.identity;

    // Socket.IO has already removed this socket from its rooms by the time the
    // disconnect handler runs, so an empty side room means it was the last one
    // — anywhere in the cluster, since the adapter answers for every instance.
    const remaining = await this.isSideOnline(bookingRequestId, state.side);

    if (!remaining) {
      this.publish({
        type: "presence",
        bookingRequestId,
        side: state.side,
        state: "offline",
      });
    }
  }

  /**
   * Re-checks that every socket on this instance may still be here.
   *
   * Membership answers whether the user may still read the thread; the session
   * answers whether they are signed in at all. Checking only the first left a
   * signed-out user receiving message bodies over a connection that outlived
   * their session while every REST call they made returned 401.
   */
  private async reauthorizeAll(): Promise<void> {
    const sockets = [...(this.io?.sockets.sockets.values() ?? [])];

    for (const socket of sockets) {
      const typed = socket as BookingMessageSocket;
      const state = typed.state;

      if (!state) {
        continue;
      }

      await this.withScope(async (scope) => {
        const service = scope.resolve(containerTokens.bookingMessagesService);

        try {
          const authorization = await service.authorizeStream(
            state.identity.bookingRequestId,
            state.identity.userId,
          );
          await service.assertSocketSessionValid(state.identity);

          // A demotion from manager to operator does not close the socket —
          // they may still read — but it withdraws the ability to emit.
          state.side = authorization.side;
          state.canWrite = authorization.canWrite;
        } catch (error) {
          this.logger.info(
            "Closing a booking message socket after access was revoked.",
            {
              bookingRequestId: state.identity.bookingRequestId,
              userId: state.identity.userId,
              reason: error instanceof Error ? error.message : "unknown",
            },
          );
          typed.disconnect(true);
        }
      });
    }
  }

  /**
   * Every container touch gets its own scope and disposes it: a socket lives
   * far longer than a request, so holding one open would pin scoped services
   * for the connection's lifetime.
   */
  private async withScope(
    run: (
      scope: ReturnType<ReturnType<typeof getContainer>["createScope"]>,
    ) => Promise<void>,
  ): Promise<void> {
    const scope = getContainer().createScope();

    try {
      await run(scope);
    } catch (error) {
      this.logger.error(
        "Booking message socket work failed.",
        undefined,
        error,
      );
    } finally {
      await scope.dispose();
    }
  }
}
