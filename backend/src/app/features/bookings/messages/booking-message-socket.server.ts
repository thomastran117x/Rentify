import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { getContainer } from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import type {
  BookingMessageClientFrame,
  BookingMessageStreamEvent,
} from "@/features/bookings/messages/booking-messages.model";

/** Path the client upgrades on. Handled outside Hono, on the raw server. */
export const BOOKING_MESSAGE_SOCKET_PATH = "/ws/booking-messages";

/** Ping cadence; a socket that misses two rounds is assumed dead. */
const HEARTBEAT_INTERVAL_MS = 20_000;

/** How often an open socket re-checks membership and session validity. */
const REAUTHORIZE_INTERVAL_MS = 60_000;

/** A client may not push typing frames faster than this. */
const TYPING_THROTTLE_MS = 2_000;

/** Largest client frame accepted, to bound parse cost. */
const MAX_CLIENT_FRAME_BYTES = 4_096;

interface SocketState {
  bookingRequestId: string;
  userId: string;
  accessToken: string;
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

    const scope = getContainer().createScope();

    try {
      const service = scope.resolve(containerTokens.bookingMessagesService);
      const identity = await service.redeemSocketTicket(
        url.searchParams.get("ticket") ?? "",
      );

      if (!identity) {
        this.rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (client) => {
        void this.register(client, identity.bookingRequestId, identity.userId);
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

  private rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  private async register(
    client: WebSocket,
    bookingRequestId: string,
    userId: string,
  ): Promise<void> {
    // Resolved per connection and held for its lifetime: the hub is a
    // singleton, so it outlives any request scope.
    const hub = getContainer().resolve(containerTokens.bookingMessageStreamHub);

    const state: SocketState = {
      bookingRequestId,
      userId,
      accessToken: "",
      alive: true,
      lastTypingAt: 0,
      release: null,
    };
    this.states.set(client, state);

    client.on("pong", () => {
      state.alive = true;
    });
    client.on("close", () => void this.teardown(client));
    client.on("error", () => void this.teardown(client));
    client.on("message", (raw) => {
      void this.handleClientFrame(client, state, raw.toString());
    });

    try {
      state.release = await hub.subscribe(bookingRequestId, (event) => {
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

    // The client can disconnect while subscribe() is still pending; release
    // here or the listener and its Redis channel are retained forever.
    if (client.readyState !== client.OPEN) {
      await this.teardown(client);
      return;
    }

    this.send(client, {
      type: "ready",
      bookingRequestId,
    } as unknown as BookingMessageStreamEvent);

    await this.withScope(async (scope) => {
      const presence = scope.resolve(
        containerTokens.bookingMessagePresenceService,
      );
      await presence.markOnline(bookingRequestId, userId);
    });
  }

  private async handleClientFrame(
    client: WebSocket,
    state: SocketState,
    raw: string,
  ): Promise<void> {
    let frame: BookingMessageClientFrame;

    try {
      frame = JSON.parse(raw) as BookingMessageClientFrame;
    } catch {
      // A malformed frame is the client's problem, not grounds to drop a
      // healthy connection.
      return;
    }

    if (frame.type === "ping") {
      state.alive = true;
      return;
    }

    if (frame.type === "typing") {
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
        const presence = scope.resolve(
          containerTokens.bookingMessagePresenceService,
        );

        try {
          // Membership can be revoked while a socket is held open, and every
          // REST call that user made would already be rejected.
          await service.authorizeStream(state.bookingRequestId, state.userId);
          await presence.markOnline(state.bookingRequestId, state.userId);
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

    // Only the last socket for this user on this thread clears presence; a
    // second tab must not mark them offline.
    const stillConnected = [...this.states.values()].some(
      (other) =>
        other.userId === state.userId &&
        other.bookingRequestId === state.bookingRequestId,
    );

    if (!stillConnected) {
      await this.withScope(async (scope) => {
        const presence = scope.resolve(
          containerTokens.bookingMessagePresenceService,
        );
        await presence.markOffline(state.bookingRequestId, state.userId);
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
