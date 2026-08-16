import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server as SocketIoServer, type Socket } from "socket.io";
import { getContainer } from "@/configuration/bootstrap/container";
import { containerTokens } from "@/configuration/container/tokens";
import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import { readAllowedOrigins } from "@/configuration/middlewares/csrf.middleware";
import { getRedisClient } from "@/configuration/resources/redis";
import {
  BLOG_COMMENT_SOCKET_COOKIE_NAME,
  BLOG_COMMENT_SOCKET_PATH,
  BLOG_COMMENT_TYPING_TTL_SECONDS,
  type OrganizationBlogCommentSocketIdentity,
  type OrganizationBlogCommentStreamEvent,
} from "@/features/organizations/blog-comments/organization-blog-comments.model";

export { BLOG_COMMENT_SOCKET_PATH };

/** How often an open socket re-checks the post and its session. */
const REAUTHORIZE_INTERVAL_MS = 60_000;

/** A client may not push typing frames faster than this. */
const TYPING_THROTTLE_MS = 2_000;

/** Largest client payload accepted, to bound parse cost. */
const MAX_CLIENT_FRAME_BYTES = 4_096;

/**
 * Shortest gap between two presence broadcasts for the same post.
 *
 * Each one costs a cluster round trip, and a post shared somewhere busy can take
 * dozens of joins a second. The count is a display value, so trading immediacy
 * for a bounded fan-out rate is free.
 */
const PRESENCE_BROADCAST_INTERVAL_MS = 2_000;

/**
 * The room every reader of a post joins. One room, not two: a blog post has no
 * sides, and everyone in it sees the same public conversation.
 */
export function postRoom(blogPostId: string): string {
  return `blog-comments:${blogPostId}`;
}

/** Per-connection state, hung off the socket rather than a parallel map. */
interface SocketState {
  identity: OrganizationBlogCommentSocketIdentity;
  canWrite: boolean;
  canModerate: boolean;
  lastTypingAt: number;
}

type BlogCommentSocket = Socket & { state?: SocketState };

/**
 * Minimal cookie parse for the handshake. Express's cookie parser never sees
 * this request: the handshake arrives on the Socket.IO engine, not through the
 * app's middleware stack.
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

    if (part.slice(0, separator).trim() === BLOG_COMMENT_SOCKET_COOKIE_NAME) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return "";
}

/**
 * Blog comment realtime gateway.
 *
 * The second Socket.IO server in this process, alongside the booking message
 * one. Both attach to the same Node HTTP server, which is safe because Engine.IO
 * dispatches on `path` and the two paths are not in a prefix relationship — each
 * server only claims its own upgrades.
 *
 * Two things differ from the booking gateway, and both follow from this being a
 * public surface rather than a private thread:
 *
 * - Anonymous sockets are admitted, read-only. They still present a ticket, so
 *   the room a socket lands in is chosen server-side and never named by the
 *   client, and so the connection has a throttle point at all.
 * - Presence is a count, not a boolean. The transferable principle from the
 *   booking design is to ask the adapter rather than keep a tally; the shape of
 *   the question is different because a post has readers, not sides.
 *
 * Deployment note: transports keep Socket.IO's default polling-then-upgrade, so
 * a replicated API **requires sticky sessions** at the load balancer. That was
 * already true for booking messages; what is new is that a public marketing page
 * now depends on it, so a misconfigured balancer fails in front of visitors.
 */
export class OrganizationBlogCommentSocketServer {
  private readonly logger: Logger;
  private io: SocketIoServer | null = null;
  private reauthorize: ReturnType<typeof setInterval> | null = null;
  private adapterClients: Array<{ quit: () => Promise<unknown> }> = [];
  /** Background work in flight, so shutdown can drain it before quitting Redis. */
  private readonly pending = new Set<Promise<unknown>>();
  /** Posts with a presence broadcast already scheduled. See `schedulePresence`. */
  private readonly presenceTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor() {
    this.logger = loggerFactory.forClass(
      OrganizationBlogCommentSocketServer,
      "service",
    );
  }

  /**
   * Awaited by the caller, because the adapter has to be in place *before* the
   * server accepts anything. Replacing the adapter on a live server does not
   * migrate the room membership of sockets that already joined through the
   * in-memory one.
   */
  async attach(server: HttpServer): Promise<void> {
    const adapter = await this.createRedisAdapter();

    this.io = new SocketIoServer(server, {
      path: BLOG_COMMENT_SOCKET_PATH,
      serveClient: false,
      maxHttpBufferSize: MAX_CLIENT_FRAME_BYTES,
      cors: {
        origin: readAllowedOrigins(),
        credentials: true,
      },
      ...(adapter ? { adapter } : {}),
    });

    this.io.use((socket, next) => {
      this.track(this.authenticate(socket as BlogCommentSocket, next));
    });

    this.io.on("connection", (socket) => {
      this.track(this.register(socket as BlogCommentSocket));
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

    for (const timer of this.presenceTimers.values()) {
      clearTimeout(timer);
    }
    this.presenceTimers.clear();

    const io = this.io;

    if (io) {
      // `local` is load-bearing: with the Redis adapter a bare
      // `disconnectSockets()` is a cluster-wide broadcast, so shutting one
      // instance down would disconnect every client on every other one.
      io.local.disconnectSockets(true);

      // `this.io` stays set while the disconnect handlers run, because they
      // publish the final reader count and `publish` reads it.
      await Promise.allSettled([...this.pending]);

      // The engine, and deliberately *not* `io.close()`. That delegates to
      // `httpServer.close(cb)`, which the process shutdown has already called;
      // a second close registers its callback on a `close` event that never
      // fires again while any request is still in flight.
      io.engine.close();
    }

    this.io = null;

    await Promise.allSettled(
      this.adapterClients.map((client) => client.quit()),
    );
    this.adapterClients = [];
  }

  /**
   * Keeps a handle on background work and swallows its failure.
   *
   * Every one of these runs from an event handler, so nothing awaits it: a
   * `fetchSockets()` timing out during a rolling deploy would otherwise surface
   * as an unhandled rejection, and this process installs no handler for those.
   */
  private track(work: Promise<unknown>): void {
    const tracked = work.catch((error: unknown) => {
      this.logger.error("Blog comment socket work failed.", undefined, error);
    });

    this.pending.add(tracked);
    void tracked.finally(() => {
      this.pending.delete(tracked);
    });
  }

  /** Open sockets on this instance. Used by tests and diagnostics. */
  activeConnectionCount(): number {
    return this.io?.sockets.sockets.size ?? 0;
  }

  /**
   * Publishes a comment event to everyone reading the post, on any instance.
   * This is the seam the service publishes through.
   */
  publish(event: OrganizationBlogCommentStreamEvent): void {
    this.io?.to(postRoom(event.blogPostId)).emit(event.type, event);
  }

  /**
   * How many sockets are watching this post, across every instance.
   *
   * Asked of the adapter rather than tracked in a counter: a node dying with
   * sockets attached takes its share out of the cluster's view on its own,
   * where a hand-kept tally would strand it until a restart.
   */
  async countReaders(blogPostId: string): Promise<number> {
    if (!this.io) {
      return 0;
    }

    const sockets = await this.io.in(postRoom(blogPostId)).fetchSockets();

    return sockets.length;
  }

  /**
   * The adapter needs its own pair of connections: Redis puts a client into
   * subscriber mode exclusively, so the shared one backing cache, locks and
   * rate limiting cannot be reused. That is two more connections on top of the
   * booking gateway's two.
   */
  private async createRedisAdapter(): Promise<ReturnType<
    typeof createAdapter
  > | null> {
    try {
      const publisher = getRedisClient().duplicate();
      const subscriber = publisher.duplicate();

      // Recorded before connecting, not after: assigning only on success would
      // leak an already-connected publisher for the life of the process if the
      // subscriber failed.
      this.adapterClients = [publisher, subscriber];
      await Promise.all([publisher.connect(), subscriber.connect()]);

      return createAdapter(publisher, subscriber);
    } catch (error) {
      // A single-instance deployment still works without the adapter, so this
      // must not stop the server from serving. Logged loudly because a
      // replicated one silently loses cross-node delivery.
      this.logger.error(
        "Failed to build the Redis adapter; realtime delivery is limited to this instance.",
        undefined,
        error,
      );

      return null;
    }
  }

  private async authenticate(
    socket: BlogCommentSocket,
    next: (error?: Error) => void,
  ): Promise<void> {
    const scope = getContainer().createScope();

    try {
      const service = scope.resolve(
        containerTokens.organizationBlogCommentsService,
      );
      // Read from the HttpOnly cookie the ticket endpoint set: a browser cannot
      // set headers on this handshake, and a query parameter would put the
      // credential into proxy and access logs.
      const identity = await service.redeemSocketTicket(
        readTicketCookie(socket.handshake.headers.cookie),
      );

      if (!identity) {
        next(new Error("Unauthorized"));
        return;
      }

      // Resolved before the connection is accepted, so a post unpublished
      // between minting the ticket and connecting never gets a room.
      const authorization = await service.authorizeStream(
        identity.blogPostId,
        identity.userId,
      );

      socket.state = {
        identity,
        canWrite: authorization.canWrite,
        canModerate: authorization.canModerate,
        lastTypingAt: 0,
      };
      next();
    } catch (error) {
      this.logger.info("Rejected a blog comment handshake.", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      next(new Error("Unauthorized"));
    } finally {
      await scope.dispose();
    }
  }

  private async register(socket: BlogCommentSocket): Promise<void> {
    const state = socket.state;

    if (!state) {
      socket.disconnect(true);
      return;
    }

    const { blogPostId } = state.identity;

    await socket.join(postRoom(blogPostId));

    socket.on("typing", () => {
      this.track(this.handleTyping(socket));
    });
    socket.on("disconnect", () => {
      this.track(this.handleDisconnect(socket));
    });

    // Carries `canWrite` so a client knows immediately whether to offer a
    // composer, without waiting on the list response it raced with.
    socket.emit("ready", {
      type: "ready",
      blogPostId,
      canWrite: state.canWrite,
    });

    this.schedulePresence(blogPostId);
  }

  /**
   * Recounts the room and broadcasts, at most once per interval per post.
   *
   * Unlike the booking gateway's presence, no unconditional-announce trick is
   * needed here. There, two simultaneous joins could both observe a full room,
   * each conclude it was not first, and leave a counterpart stuck on `offline`
   * forever. A stale count is only a temporarily wrong *number*: every later
   * join or leave recounts, so the last broadcast always reflects settled
   * membership. The timer is trailing-edge for exactly that reason — the final
   * state has to go out even if it lands inside a quiet interval.
   */
  private schedulePresence(blogPostId: string): void {
    if (this.presenceTimers.has(blogPostId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.presenceTimers.delete(blogPostId);
      this.track(this.broadcastPresence(blogPostId));
    }, PRESENCE_BROADCAST_INTERVAL_MS);

    // Nothing should be held open on this timer during shutdown; `close()`
    // clears them, and this keeps a straggler from holding the event loop.
    timer.unref?.();

    this.presenceTimers.set(blogPostId, timer);
  }

  private async broadcastPresence(blogPostId: string): Promise<void> {
    const readerCount = await this.countReaders(blogPostId);

    this.publish({
      type: "presence",
      blogPostId,
      readerCount,
    });
  }

  private async handleTyping(socket: BlogCommentSocket): Promise<void> {
    const state = socket.state;

    if (!state || !state.canWrite || !state.identity.userId) {
      // Anonymous readers and readers of a closed thread hold sockets but have
      // no composer. Nothing stops them emitting this by hand, and everyone
      // else would see someone who cannot post appear to be writing.
      return;
    }

    const now = Date.now();

    // Throttled server-side as well: a client ignoring its own throttle must
    // not be able to flood the room.
    if (now - state.lastTypingAt < TYPING_THROTTLE_MS) {
      return;
    }

    state.lastTypingAt = now;
    const userId = state.identity.userId;

    await this.withScope(async (scope) => {
      const authRepository = scope.resolve(containerTokens.authRepository);
      const user = await authRepository.findUserById(userId);

      this.publish({
        type: "typing",
        blogPostId: state.identity.blogPostId,
        username: user?.profile?.username ?? "Someone",
        expiresAt: new Date(
          Date.now() + BLOG_COMMENT_TYPING_TTL_SECONDS * 1_000,
        ).toISOString(),
      });
    });
  }

  private async handleDisconnect(socket: BlogCommentSocket): Promise<void> {
    const state = socket.state;

    if (!state) {
      return;
    }

    // Socket.IO has already removed this socket from its rooms by the time the
    // disconnect handler runs, so the recount this schedules sees the room
    // without it.
    this.schedulePresence(state.identity.blogPostId);
  }

  /**
   * Re-checks that every socket on this instance may still be here.
   *
   * Two axes, as with booking messages, but the second one is conditional: an
   * anonymous socket has no session to invalidate, so only the post is checked
   * for it. Unpublishing closes every socket on the post; opening or closing
   * comments only flips `canWrite`, and those readers stay.
   */
  private async reauthorizeAll(): Promise<void> {
    const sockets = [...(this.io?.sockets.sockets.values() ?? [])];

    for (const socket of sockets) {
      const typed = socket as BlogCommentSocket;
      const state = typed.state;

      if (!state) {
        continue;
      }

      await this.withScope(async (scope) => {
        const service = scope.resolve(
          containerTokens.organizationBlogCommentsService,
        );

        try {
          const authorization = await service.authorizeStream(
            state.identity.blogPostId,
            state.identity.userId,
          );
          await service.assertSocketSessionValid(state.identity);

          const previousCanWrite = state.canWrite;
          state.canWrite = authorization.canWrite;
          state.canModerate = authorization.canModerate;

          if (previousCanWrite !== authorization.canWrite) {
            // The server rejecting their writes is not enough: the panel caches
            // capabilities from the list response, so a reader whose thread was
            // closed would keep a composer that can only produce 409s. Told to
            // resync rather than sent the new value, so one event covers every
            // capability the list response carries.
            typed.emit("resync", {
              type: "resync",
              blogPostId: state.identity.blogPostId,
            });
          }
        } catch (error) {
          this.logger.info(
            "Closing a blog comment socket after access was revoked.",
            {
              blogPostId: state.identity.blogPostId,
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
      this.logger.error("Blog comment socket work failed.", undefined, error);
    } finally {
      await scope.dispose();
    }
  }
}
