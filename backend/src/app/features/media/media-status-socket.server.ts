import type { Server as HttpServer } from "node:http";
import {
  Server as SocketIoServer,
  type ServerOptions,
  type Socket,
} from "socket.io";
import { getContainer } from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import { readAllowedOrigins } from "@/configuration/middlewares/csrf.middleware";
import {
  createSocketRedisAdapter,
  readCookie,
  type SocketRedisClient,
} from "@/configuration/realtime/socket-handshake";
import {
  MEDIA_STATUS_SOCKET_ADAPTER_KEY,
  MEDIA_STATUS_SOCKET_COOKIE_NAME,
  MEDIA_STATUS_SOCKET_PATH,
  mediaStatusRoom,
  type MediaStatusSocketIdentity,
} from "@/features/media/media.model";

export { MEDIA_STATUS_SOCKET_PATH };

/** How often an open socket re-checks its session. */
const REAUTHORIZE_INTERVAL_MS = 60_000;

/**
 * Largest client payload accepted. The client sends nothing on this socket,
 * so anything beyond the handshake's own frames is refused.
 */
const MAX_CLIENT_FRAME_BYTES = 1_024;

type MediaStatusSocket = Socket & { identity?: MediaStatusSocketIdentity };

/**
 * The handshake error a client is refused with while no push can reach it,
 * so it stops trying and polls at its full rate instead.
 */
export const MEDIA_STATUS_UNAVAILABLE = "Unavailable";

/** Builds the adapter the worker's emitter publishes through. */
export type MediaStatusAdapterBuilder = (logger: Logger) => Promise<{
  adapter: ServerOptions["adapter"] | null;
  clients: SocketRedisClient[];
}>;

const buildRedisAdapter: MediaStatusAdapterBuilder = (logger) =>
  createSocketRedisAdapter(logger, { key: MEDIA_STATUS_SOCKET_ADAPTER_KEY });

/**
 * Media status realtime gateway: tells a signed-in user's open pages when one
 * of their uploads becomes `ready` or `rejected`.
 *
 * It only sends. Each socket joins its user's room, and the media processing
 * worker, which has no Socket.IO server of its own, publishes into that room
 * through a Redis emitter on this gateway's adapter channel. The event carries
 * just the id and status; the client reads the item itself over REST.
 *
 * Unlike the other gateways, it is no use without its Redis adapter: their
 * events come from the API that holds the sockets, but these come from the
 * worker, and only through the adapter. When the adapter cannot be built, the
 * gateway refuses every handshake as `Unavailable`, so a client polls at its
 * full rate rather than slowly, waiting for a push that cannot come.
 *
 * Like the other gateways, a replicated API needs sticky sessions at the load
 * balancer for Socket.IO's polling handshake.
 */
export class MediaStatusSocketServer {
  private readonly logger: Logger;
  private io: SocketIoServer | null = null;
  private reauthorize: ReturnType<typeof setInterval> | null = null;
  private adapterClients: SocketRedisClient[] = [];
  /** Whether the worker's pushes can reach this instance's sockets. */
  private canDeliver = false;
  /** Handshakes in flight, so shutdown can drain them before quitting Redis. */
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly buildAdapter: MediaStatusAdapterBuilder = buildRedisAdapter,
  ) {
    this.logger = loggerFactory.forClass(MediaStatusSocketServer, "service");
  }

  /**
   * Awaited by the caller: the adapter has to be in place before the server
   * accepts anything, or a socket that joined its room through the in-memory
   * adapter would never hear the worker's broadcasts.
   */
  async attach(server: HttpServer): Promise<void> {
    const { adapter, clients } = await this.buildAdapter(this.logger);
    this.adapterClients = clients;
    this.canDeliver = adapter !== null;

    this.io = new SocketIoServer(server, {
      path: MEDIA_STATUS_SOCKET_PATH,
      serveClient: false,
      maxHttpBufferSize: MAX_CLIENT_FRAME_BYTES,
      cors: {
        origin: readAllowedOrigins(),
        credentials: true,
      },
      ...(adapter ? { adapter } : {}),
    });

    this.io.use((socket, next) => {
      this.track(this.authenticate(socket as MediaStatusSocket, next));
    });

    this.io.on("connection", (socket) => {
      this.track(this.register(socket as MediaStatusSocket));
    });

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

    if (io) {
      // `local`: with the Redis adapter a bare `disconnectSockets()` would
      // disconnect every instance's clients, not just this one's.
      io.local.disconnectSockets(true);
      await Promise.allSettled([...this.pending]);
      // The engine rather than `io.close()`, which would close the HTTP server
      // the process shutdown has already closed, and wait forever on it.
      io.engine.close();
    }

    this.io = null;

    await Promise.allSettled(
      this.adapterClients.map((client) => client.quit()),
    );
    this.adapterClients = [];
  }

  /** Open sockets on this instance. Used by tests and diagnostics. */
  activeConnectionCount(): number {
    return this.io?.sockets.sockets.size ?? 0;
  }

  /** Keeps a handle on handshake work and logs, rather than throws, a failure. */
  private track(work: Promise<unknown>): void {
    const tracked = work.catch((error: unknown) => {
      this.logger.error("Media status socket work failed.", undefined, error);
    });

    this.pending.add(tracked);
    void tracked.finally(() => {
      this.pending.delete(tracked);
    });
  }

  private async authenticate(
    socket: MediaStatusSocket,
    next: (error?: Error) => void,
  ): Promise<void> {
    // Refused before the ticket is redeemed, so the client keeps nothing
    // waiting on a socket that would never be told anything.
    if (!this.canDeliver) {
      next(new Error(MEDIA_STATUS_UNAVAILABLE));
      return;
    }

    const scope = getContainer().createScope();

    try {
      // From the HttpOnly cookie the ticket endpoint set: a browser cannot set
      // headers on this handshake, and a query parameter would put the
      // credential into proxy and access logs.
      const identity = await scope
        .resolve(containerTokens.mediaStatusSocketService)
        .redeemSocketTicket(
          readCookie(
            socket.handshake.headers.cookie,
            MEDIA_STATUS_SOCKET_COOKIE_NAME,
          ),
        );

      if (!identity) {
        next(new Error("Unauthorized"));
        return;
      }

      socket.identity = identity;
      next();
    } catch (error) {
      this.logger.info("Rejected a media status handshake.", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      next(new Error("Unauthorized"));
    } finally {
      await scope.dispose();
    }
  }

  private async register(socket: MediaStatusSocket): Promise<void> {
    if (!socket.identity) {
      socket.disconnect(true);
      return;
    }

    await socket.join(mediaStatusRoom(socket.identity.userId));
    // Sent once the room is joined, so a client knows from here on a status
    // reaches it, and can stop polling at its fastest.
    socket.emit("ready", { type: "ready" });
  }

  /**
   * Closes every socket on this instance whose session has been signed out or
   * superseded since it connected.
   */
  private async reauthorizeAll(): Promise<void> {
    const sockets = [...(this.io?.sockets.sockets.values() ?? [])];

    for (const socket of sockets) {
      const typed = socket as MediaStatusSocket;
      const identity = typed.identity;

      if (!identity) {
        continue;
      }

      const scope = getContainer().createScope();

      try {
        await scope
          .resolve(containerTokens.mediaStatusSocketService)
          .assertSocketSessionValid(identity);
      } catch (error) {
        this.logger.info("Closing a media status socket after sign-out.", {
          userId: identity.userId,
          reason: error instanceof Error ? error.message : "unknown",
        });
        typed.disconnect(true);
      } finally {
        await scope.dispose();
      }
    }
  }
}
