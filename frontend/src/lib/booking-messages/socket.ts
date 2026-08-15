import { io, type Socket } from "socket.io-client";
import { authenticatedJson } from "@/lib/api/client";
import { resolveApiBaseUrl } from "@/lib/env";
import type {
  BookingMessageStreamEvent,
  BookingMessageStreamStatus,
} from "@/lib/booking-messages/types";

/** Path the server mounts Socket.IO on, and the ticket cookie is scoped to. */
const SOCKET_PATH = "/ws/booking-messages";

/** After this many consecutive failed connects the caller should fall back. */
export const MAX_CONSECUTIVE_SOCKET_FAILURES = 5;

/** Client-side typing throttle. The server enforces its own as well. */
const TYPING_THROTTLE_MS = 2_500;

/** Server events the panel consumes, forwarded verbatim. */
const FORWARDED_EVENTS = [
  "message.created",
  "message.updated",
  "messages.read",
  "messages.delivered",
  "typing",
  "presence",
  "resync",
] as const;

export interface BookingMessageSocketHandle {
  /** Announces that the local user is composing. Throttled. */
  sendTyping(): void;
  /** Acknowledges receipt of messages authored by the other side. */
  sendDelivered(messageIds: string[]): void;
  close(): void;
}

/** `http(s)://host/api/v1` → `http(s)://host`. Socket.IO adds the path. */
function resolveSocketOrigin(): string {
  const api = new URL(resolveApiBaseUrl(), window.location.origin);

  return api.origin;
}

/**
 * Opens the booking message socket.
 *
 * Authentication is a two-step exchange: the bearer token is swapped over REST
 * for a single-use ticket that the server returns as an HttpOnly cookie scoped
 * to the socket path, and the browser attaches it to the handshake. The ticket
 * is never readable by this code and never appears in a URL.
 *
 * Reconnection, backoff and heartbeats are Socket.IO's, not ours — the ladder,
 * jitter and ping/pong this used to hand-roll are all built in. What remains
 * here is the part that is specific to this application: minting a fresh ticket
 * before every attempt, since a ticket is single-use and short-lived.
 */
export function openBookingMessageSocket(options: {
  bookingRequestId: string;
  onEvent: (event: BookingMessageStreamEvent) => void;
  onStatus: (status: BookingMessageStreamStatus) => void;
}): BookingMessageSocketHandle {
  const { bookingRequestId, onEvent, onStatus } = options;

  let closed = false;
  let failures = 0;
  let lastTypingAt = 0;
  let socket: Socket | null = null;

  async function mintTicket(): Promise<boolean> {
    try {
      // Sets the HttpOnly ticket cookie. Its body carries only the lifetime.
      await authenticatedJson<{ expiresInSeconds: number }>(
        "POST",
        `/booking-requests/${encodeURIComponent(bookingRequestId)}/messages/socket-ticket`,
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
    });

    socket = next;

    next.on("connect", () => {
      failures = 0;
      onStatus("open");
    });

    for (const name of FORWARDED_EVENTS) {
      next.on(name, (event: BookingMessageStreamEvent) => {
        // Two tabs on one origin share the ticket cookie, so a tab can end up
        // holding the other's ticket and joining the wrong thread's room. The
        // server stays consistent — it joined the room its ticket named — but
        // this tab would render someone else's conversation.
        if (event?.bookingRequestId !== bookingRequestId) {
          next.disconnect();
          void connect();
          return;
        }

        onEvent(event);
      });
    }

    // `ready` only confirms the subscription; the panel re-syncs off `open`.
    next.on("ready", () => undefined);

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
    sendDelivered(messageIds: string[]): void {
      if (messageIds.length === 0 || !socket?.connected) {
        return;
      }

      socket.emit("delivered", messageIds);
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
