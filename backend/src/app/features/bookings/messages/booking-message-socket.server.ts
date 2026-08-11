import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { getContainer } from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import { readAllowedOrigins } from "@/configuration/middlewares/csrf.middleware";
import type { BookingParticipantSide } from "@/features/bookings/booking-participants";
import {
  BOOKING_MESSAGE_SOCKET_COOKIE_NAME,
  BOOKING_MESSAGE_SOCKET_PATH,
  type BookingMessageClientFrame,
  type BookingMessageSocketIdentity,
  type BookingMessageStreamEvent,
} from "@/features/bookings/messages/booking-messages.model";

export { BOOKING_MESSAGE_SOCKET_PATH };

/** Ping cadence; a socket that misses two rounds is assumed dead. */
const HEARTBEAT_INTERVAL_MS = 20_000;

/** How often an open socket re-checks membership and session validity. */
const REAUTHORIZE_INTERVAL_MS = 60_000;

/**
 * How often presence keys are pushed out. Must stay comfortably under
 * `BOOKING_MESSAGE_PRESENCE_TTL_SECONDS`: refreshing on the slower
 * reauthorization interval let the key lapse for fifteen seconds out of every
 * sixty, and a disconnect inside that window left the counterpart's dot lit.
 */
const PRESENCE_REFRESH_INTERVAL_MS = 20_000;

/** A client may not push typing frames faster than this. */
const TYPING_THROTTLE_MS = 2_000;

/** Largest client frame accepted, to bound parse cost. */
const MAX_CLIENT_FRAME_BYTES = 4_096;

/**
 * Minimal cookie parse for the upgrade request. `hono/cookie` needs a Hono
 * context, and this runs on the raw Node request.
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

interface SocketState {
  /**
   * Identifies this connection's presence lease. Per socket, not per user: two
   * tabs hold two leases, and each expires on its own if its process dies.
   */
  socketId: string;
  bookingRequestId: string;
  userId: string;
  /** The redeemed ticket, kept so the session can be rechecked periodically. */
  session: BookingMessageSocketIdentity;
  /** Which half of the thread this connection sits on. */
  side: BookingParticipantSide | null;
  /** Whether this participant may write. Refreshed by the sweep. */
  canWrite: boolean;
  /** Resolves once `side` and `canWrite` have been looked up. */
  authorized: Promise<void> | null;
  /** Whether this socket incremented the side's presence count. */
  joined: boolean;
  alive: boolean;
  lastTypingAt: number;
  release: (() => Promise<void>) | null;
}

/**
 * Booking message WebSocket endpoint.
 *
 * Attached to the Node HTTP server rather than routed through Hono:
 * `@hono/node-ws` peers on `@hono/node-server@^1.19.11` and this backend runs
 * 2.x, so the adapter cannot be used. Everything the adapter would have
 * provided — upgrade handling, heartbeats, teardown — lives here.
 */
export class BookingMessageSocketServer {
  private readonly logger: Logger;
  private readonly wss: WebSocketServer;
  private readonly states = new Map<WebSocket, SocketState>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reauthorize: ReturnType<typeof setInterval> | null = null;
  private presenceRefresh: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.logger = loggerFactory.forClass(BookingMessageSocketServer, "service");
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_CLIENT_FRAME_BYTES,
    });
  }

  attach(server: Server): void {
    server.on("upgrade", (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    });

    this.heartbeat = setInterval(() => this.pingAll(), HEARTBEAT_INTERVAL_MS);
    this.reauthorize = setInterval(
      () => void this.reauthorizeAll(),
      REAUTHORIZE_INTERVAL_MS,
    );
    this.presenceRefresh = setInterval(
      () => void this.refreshPresenceAll(),
      PRESENCE_REFRESH_INTERVAL_MS,
    );
  }

  async close(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }

    if (this.reauthorize) {
      clearInterval(this.reauthorize);
      this.reauthorize = null;
    }

    if (this.presenceRefresh) {
      clearInterval(this.presenceRefresh);
      this.presenceRefresh = null;
    }

    const clients = [...this.states.keys()];
    await Promise.allSettled(
      clients.map((socket) => this.teardown(socket, 1001)),
    );

    // `wss.close()` waits for every client to finish closing, and a peer that
    // never completes the handshake would hang shutdown. Terminate whatever is
    // still open rather than waiting on it.
    for (const client of clients) {
      try {
        client.terminate();
      } catch {
        // Already gone.
      }
    }

    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  /** Open sockets. Used by tests and diagnostics. */
  activeConnectionCount(): number {
    return this.states.size;
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    let url: URL;

    try {
      url = new URL(
        request.url ?? "",
        `http://${request.headers.host ?? "localhost"}`,
      );
    } catch {
      this.rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    // Registering an `upgrade` listener stops Node destroying unmatched
    // upgrades on its own, so returning silently would leave the socket open
    // forever. This is the only upgrade handler on the server; a second one
    // would need to negotiate here rather than be added independently.
    if (url.pathname !== BOOKING_MESSAGE_SOCKET_PATH) {
      this.rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    // The upgrade never passes through the CORS or CSRF middleware, so the
    // origin check has to happen here or not at all. `SameSite=Lax` is scoped
    // to the *site*, not the origin, so a sibling origin under the same site
    // has the ticket cookie attached to any upgrade it attempts and could race
    // a freshly minted ticket into an authenticated socket.
    if (!this.isOriginAllowed(request.headers.origin)) {
      this.logger.warn("Rejected a booking message upgrade from an origin.", {
        origin: request.headers.origin,
      });
      this.rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    const scope = getContainer().createScope();

    try {
      const service = scope.resolve(containerTokens.bookingMessagesService);
      // Read from the HttpOnly cookie the ticket endpoint set: a browser
      // WebSocket cannot send an authorization header, and a query parameter
      // would put the credential into proxy and access logs.
      const identity = await service.redeemSocketTicket(
        readTicketCookie(request.headers.cookie),
      );

      if (!identity) {
        this.rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (client) => {
        void this.register(client, identity);
      });
    } catch (error) {
      this.logger.error(
        "Booking message socket upgrade failed.",
        undefined,
        error,
      );
      this.rejectUpgrade(socket, 500, "Internal Server Error");
    } finally {
      await scope.dispose();
    }
  }

  /**
   * Browsers always send `Origin` on a WebSocket handshake, and it is the one
   * header a page cannot forge. A missing header means a non-browser client —
   * a script, a mobile app, the integration suite — which carries no ambient
   * cookie and so is not the threat this guards against; requiring the header
   * would break those without making a browser attack any harder.
   */
  private isOriginAllowed(origin?: string): boolean {
    if (!origin) {
      return true;
    }

    let normalized: string;

    try {
      normalized = new URL(origin).origin;
    } catch {
      return false;
    }

    return readAllowedOrigins().some((allowed) => {
      try {
        return new URL(allowed).origin === normalized;
      } catch {
        return allowed === normalized;
      }
    });
  }

  private rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  private async register(
    client: WebSocket,
    identity: BookingMessageSocketIdentity,
  ): Promise<void> {
    const { bookingRequestId, userId } = identity;

    // Resolved per connection and held for its lifetime: the hub is a
    // singleton, so it outlives any request scope.
    const hub = getContainer().resolve(containerTokens.bookingMessageStreamHub);

    const state: SocketState = {
      socketId: randomUUID(),
      bookingRequestId,
      userId,
      session: identity,
      side: null,
      // Closed until proven open. If the capability lookup below fails, this
      // connection can still read — that is what its ticket bought — but it
      // cannot emit anything the other party will see.
      canWrite: false,
      authorized: null,
      joined: false,
      alive: true,
      lastTypingAt: 0,
      release: null,
    };
    this.states.set(client, state);

    // Listeners first, before anything is awaited. A client may send its first
    // frame the instant the handshake completes, and `ws` drops messages that
    // arrive with no listener attached — an await here silently loses them.
    client.on("pong", () => {
      state.alive = true;
    });
    client.on("close", () => void this.teardown(client));
    client.on("error", () => void this.teardown(client));
    client.on("message", (raw) => {
      void this.handleClientFrame(client, state, raw.toString());
    });

    // Started now, awaited by whoever needs it. Frames arriving before it
    // settles wait on the same promise rather than being judged against a
    // capability that has not been looked up yet.
    //
    // Deliberately not routed through `withScope`, which logs and swallows: a
    // rejection here means access was lost between redeeming the ticket and
    // registering, and swallowing it left the socket subscribed and streaming
    // message bodies to someone no longer entitled to them until the next
    // sweep noticed, a minute later.
    const scope = getContainer().createScope();

    state.authorized = (async () => {
      try {
        const service = scope.resolve(containerTokens.bookingMessagesService);
        const authorization = await service.authorizeStream(
          bookingRequestId,
          userId,
        );

        state.side = authorization.side;
        state.canWrite = authorization.canWrite;
      } finally {
        await scope.dispose();
      }
    })();

    try {
      await state.authorized;
    } catch (error) {
      this.logger.info(
        "Closing a booking message socket that lost access before registering.",
        {
          bookingRequestId,
          userId,
          reason: error instanceof Error ? error.message : "unknown",
        },
      );
      await this.teardown(client, 1008);
      return;
    }

    let release: () => Promise<void>;

    try {
      release = await hub.subscribe(bookingRequestId, (event) => {
        this.send(client, event);
      });
    } catch (error) {
      this.logger.error(
        "Failed to subscribe a booking message socket.",
        { bookingRequestId },
        error,
      );
      await this.teardown(client, 1011);
      return;
    }

    // The peer can disconnect while the lookup or the subscribe above is still
    // pending. If it did, the close handler has already run teardown and
    // dropped this socket from `states`, so a second teardown here would return
    // immediately and this release — assigned after that ran — would never be
    // called, retaining the listener and its Redis channel for good. Release it
    // directly rather than handing it to a teardown that has already happened.
    if (!this.states.has(client) || client.readyState !== client.OPEN) {
      await release();
      await this.teardown(client);
      return;
    }

    state.release = release;

    this.send(client, {
      type: "ready",
      bookingRequestId,
    } as unknown as BookingMessageStreamEvent);

    await this.withScope(async (scope) => {
      const presence = scope.resolve(
        containerTokens.bookingMessagePresenceService,
      );

      if (state.side) {
        await presence.join(bookingRequestId, state.side, state.socketId);
        state.joined = true;

        // The counterpart's own arrival was announced before this socket
        // existed, and a live key is never re-announced, so without asking for
        // the current state a newcomer would show an active party as offline
        // until they happened to reconnect.
        const counterpartSide = state.side === "renter" ? "owner" : "renter";
        const online = await presence.isSideOnline(
          bookingRequestId,
          counterpartSide,
        );

        this.send(client, {
          type: "presence",
          bookingRequestId,
          side: counterpartSide,
          state: online ? "online" : "offline",
        } as BookingMessageStreamEvent);
      }
    });
  }

  private async handleClientFrame(
    client: WebSocket,
    state: SocketState,
    raw: string,
  ): Promise<void> {
    let decoded: unknown;

    try {
      decoded = JSON.parse(raw);
    } catch {
      // A malformed frame is the client's problem, not grounds to drop a
      // healthy connection.
      return;
    }

    // Parsing succeeding does not mean the result is a frame. `JSON.parse`
    // accepts the bare literal `null`, and reading `.type` off it throws a
    // TypeError out here, outside the catch above — in an async handler whose
    // promise is discarded by the caller, which under Node's default
    // unhandled-rejection policy takes the process down. Any authenticated
    // client could send it.
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded)
    ) {
      return;
    }

    const frame = decoded as BookingMessageClientFrame;

    if (frame.type === "ping") {
      state.alive = true;
      return;
    }

    if (frame.type === "typing") {
      // A frame can arrive before the capability lookup settles, so wait for it
      // rather than judging against the not-yet-known default. Caught, not
      // propagated: this runs in a discarded promise, and an unhandled
      // rejection here takes the process down. A failed lookup leaves
      // `canWrite` false and the socket is being torn down anyway.
      try {
        await state.authorized;
      } catch {
        return;
      }

      // Connecting only needs read access, so an organization operator can hold
      // a socket while the UI deliberately withholds their composer. Nothing
      // stops them sending this frame by hand, and the renter would then watch
      // someone who cannot post appear to be composing a reply.
      if (!state.canWrite) {
        return;
      }

      const now = Date.now();

      // Throttled server-side: a client that ignores its own throttle must not
      // be able to flood the thread's channel.
      if (now - state.lastTypingAt < TYPING_THROTTLE_MS) {
        return;
      }

      state.lastTypingAt = now;
      await this.withScope(async (scope) => {
        const presence = scope.resolve(
          containerTokens.bookingMessagePresenceService,
        );
        await presence.publishTyping(state.bookingRequestId, state.userId);
      });
      return;
    }

    if (frame.type === "delivered") {
      const messageIds = Array.isArray(frame.messageIds)
        ? frame.messageIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          )
        : [];

      if (messageIds.length === 0) {
        return;
      }

      await this.withScope(async (scope) => {
        const service = scope.resolve(containerTokens.bookingMessagesService);
        await service.markDelivered(
          state.bookingRequestId,
          state.userId,
          messageIds,
        );
      });
    }
  }

  private pingAll(): void {
    for (const [client, state] of this.states) {
      if (!state.alive) {
        // Missed a full round: the peer is gone even though the socket has not
        // reported closed.
        void this.teardown(client, 1001);
        continue;
      }

      state.alive = false;

      try {
        client.ping();
      } catch {
        void this.teardown(client, 1001);
      }
    }
  }

  private async reauthorizeAll(): Promise<void> {
    for (const [client, state] of this.states) {
      await this.withScope(async (scope) => {
        const service = scope.resolve(containerTokens.bookingMessagesService);

        try {
          // Membership can be revoked while a socket is held open, and every
          // REST call that user made would already be rejected.
          const authorization = await service.authorizeStream(
            state.bookingRequestId,
            state.userId,
          );

          // A demotion from manager to operator does not close the socket —
          // they may still read — but it has to withdraw the ability to emit.
          state.side = authorization.side;
          state.canWrite = authorization.canWrite;
          // The session behind the ticket can be revoked too — a logout, a
          // password change, a token-version bump. Checking membership alone
          // let a signed-out user keep receiving message bodies indefinitely
          // while every REST call they made returned 401.
          await service.assertSocketSessionValid(state.session);
        } catch (error) {
          this.logger.info(
            "Closing a booking message socket after access was revoked.",
            {
              bookingRequestId: state.bookingRequestId,
              userId: state.userId,
              reason: error instanceof Error ? error.message : "unknown",
            },
          );
          await this.teardown(client, 1008);
        }
      });
    }
  }

  /**
   * Pushes out the presence TTL for every open socket. Separate from
   * reauthorization because it has to run more often than the key expires, and
   * it is pure Redis work — no database, no authorization.
   */
  private async refreshPresenceAll(): Promise<void> {
    if (this.states.size === 0) {
      return;
    }

    await this.withScope(async (scope) => {
      const presence = scope.resolve(
        containerTokens.bookingMessagePresenceService,
      );

      // One refresh per socket, deliberately not deduplicated per side. Each
      // socket holds its own lease, and renewing the side as a whole is exactly
      // the bug this shape exists to avoid: a survivor would keep a dead
      // replica's lease alive indefinitely, and the side would never be
      // announced offline again.
      for (const state of this.states.values()) {
        if (!state.side || !state.joined) {
          continue;
        }

        await presence.refresh(
          state.bookingRequestId,
          state.side,
          state.socketId,
        );
      }
    });
  }

  private send(client: WebSocket, event: BookingMessageStreamEvent): void {
    if (client.readyState !== client.OPEN) {
      return;
    }

    try {
      client.send(JSON.stringify(event));
    } catch (error) {
      this.logger.warn(
        "Failed to write to a booking message socket.",
        undefined,
        error,
      );
    }
  }

  private async teardown(client: WebSocket, code?: number): Promise<void> {
    const state = this.states.get(client);

    if (!state) {
      return;
    }

    this.states.delete(client);
    await state.release?.();

    // Only sockets that actually joined decrement. `side` is null when the
    // capability lookup never completed, and that connection was never counted.
    //
    // Whether the side is now empty is Redis's answer, not this map's: with the
    // API replicated, each process only sees its own sockets, so a local check
    // would announce the whole side offline whenever the last manager on *this*
    // replica left, while a colleague sat connected to another.
    if (state.side && state.joined) {
      const side = state.side;

      await this.withScope(async (scope) => {
        const presence = scope.resolve(
          containerTokens.bookingMessagePresenceService,
        );
        await presence.leave(state.bookingRequestId, side, state.socketId);
      });
    }

    try {
      client.close(code ?? 1000);
    } catch {
      // Already closing.
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
