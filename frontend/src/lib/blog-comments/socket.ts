import { io, type Socket } from "socket.io-client";
import { optionalAuthJson } from "@/lib/api/client";
import { resolveApiBaseUrl } from "@/lib/env";
import type {
  BlogCommentStreamEvent,
  BlogCommentStreamStatus,
} from "@/lib/blog-comments/types";

/** Path the server mounts Socket.IO on, and the ticket cookie is scoped to. */
const SOCKET_PATH = "/ws/blog-comments";

/** After this many consecutive failed connects the caller should fall back. */
export const MAX_CONSECUTIVE_SOCKET_FAILURES = 5;

/** Client-side typing throttle. The server enforces its own as well. */
const TYPING_THROTTLE_MS = 2_500;

/** Server events the panel consumes, forwarded verbatim. */
const FORWARDED_EVENTS = [
  "comment.created",
  "comment.updated",
  "comment.deleted",
  "typing",
  "presence",
  "comments.closed",
  "resync",
] as const;

export interface BlogCommentSocketHandle {
  /** Announces that the local user is composing. Throttled. */
  sendTyping(): void;
  close(): void;
}

/** `http(s)://host/api/v1` → `http(s)://host`. Socket.IO adds the path. */
function resolveSocketOrigin(): string {
  const api = new URL(resolveApiBaseUrl(), window.location.origin);

  return api.origin;
}

/**
 * Opens the blog comment socket.
 *
 * Authentication is a two-step exchange: the session is swapped over REST for a
 * single-use ticket the server returns as an HttpOnly cookie scoped to the
 * socket path, and the browser attaches it to the handshake. The ticket is
 * never readable by this code and never appears in a URL.
 *
 * Anonymous readers take the same path. Their ticket carries no identity, but
 * it is still what binds the socket to a post server-side, so this client never
 * names the room it wants to join.
 */
export function openBlogCommentSocket(options: {
  organizationId: string;
  slug: string;
  blogPostId: string;
  onEvent: (event: BlogCommentStreamEvent) => void;
  onStatus: (status: BlogCommentStreamStatus) => void;
}): BlogCommentSocketHandle {
  const { organizationId, slug, blogPostId, onEvent, onStatus } = options;

  let closed = false;
  let failures = 0;
  let lastTypingAt = 0;
  let socket: Socket | null = null;

  async function mintTicket(): Promise<boolean> {
    try {
      // Optional auth, not authenticated: a signed-out visitor must still get a
      // ticket, because live delivery to anonymous readers is the point.
      await optionalAuthJson<{ expiresInSeconds: number }>(
        "POST",
        `/organizations/${encodeURIComponent(organizationId)}/blog/${encodeURIComponent(slug)}/comments/socket-ticket`,
      );

      return true;
    } catch {
      return false;
    }
  }

  function handleFailure(): void {
    failures += 1;

    if (failures >= MAX_CONSECUTIVE_SOCKET_FAILURES) {
      onStatus("failed");
      socket?.disconnect();
      return;
    }

    onStatus("reconnecting");
  }

  async function connect(): Promise<void> {
    if (closed) {
      return;
    }

    onStatus("connecting");

    if (!(await mintTicket())) {
      handleFailure();

      if (!closed && failures < MAX_CONSECUTIVE_SOCKET_FAILURES) {
        // No socket exists yet, so nothing else will retry for us.
        window.setTimeout(() => void connect(), 1_000 * failures);
      }

      return;
    }

    if (closed) {
      return;
    }

    const next = io(resolveSocketOrigin(), {
      path: SOCKET_PATH,
      // The ticket rides in a cookie, so the handshake has to carry credentials.
      withCredentials: true,
      // Reconnection is Socket.IO's, but each attempt needs a *fresh* ticket,
      // so the reconnect is driven from here instead.
      reconnection: false,
      // Load-bearing with two gateways on one origin: `socket.io-client` caches
      // Managers by origin, not by path, so without this a page that also has a
      // booking thread open could hand this call the Manager built for
      // `/ws/booking-messages` and silently connect to the wrong gateway.
      forceNew: true,
    });

    socket = next;

    next.on("connect", () => {
      failures = 0;
      onStatus("open");
    });

    for (const name of FORWARDED_EVENTS) {
      next.on(name, (event: BlogCommentStreamEvent) => {
        // Two tabs on one origin share the ticket cookie, so a tab can end up
        // holding the other's ticket and joining the wrong post's room. The
        // server stays consistent — it joined the room its ticket named — but
        // this tab would render another post's comments.
        if (event?.blogPostId !== blogPostId) {
          next.disconnect();
          void connect();
          return;
        }

        onEvent(event);
      });
    }

    // `ready` names the room the server actually put this socket in, and that
    // is the only prompt evidence of a ticket mix-up. Two tabs on one origin
    // share the ticket cookie, so a tab can redeem the other's ticket and land
    // on the wrong post. The per-event guard below catches it only once the
    // wrong room happens to publish something — until then the connection
    // looks healthy, the fallback poll never starts, and this tab quietly
    // misses everything for the post it is actually showing.
    next.on("ready", (event: { blogPostId?: string }) => {
      if (event?.blogPostId !== blogPostId) {
        next.disconnect();
        void connect();
      }
    });

    next.on("connect_error", () => {
      handleFailure();

      if (!closed && failures < MAX_CONSECUTIVE_SOCKET_FAILURES) {
        window.setTimeout(() => void connect(), 1_000 * failures);
      }
    });

    next.on("disconnect", (reason) => {
      if (closed || reason === "io client disconnect") {
        return;
      }

      onStatus("reconnecting");
      void connect();
    });
  }

  void connect();

  return {
    sendTyping(): void {
      const now = Date.now();

      if (now - lastTypingAt < TYPING_THROTTLE_MS) {
        return;
      }

      // Recorded only when the frame goes out: an attempt made while
      // disconnected would otherwise spend the window and suppress the first
      // real indicator after connecting.
      if (socket?.connected) {
        socket.emit("typing");
        lastTypingAt = now;
      }
    },
    close(): void {
      if (closed) {
        return;
      }

      closed = true;
      socket?.disconnect();
      socket = null;
    },
  };
}
