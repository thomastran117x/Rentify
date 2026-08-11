import { authenticatedJson } from "@/lib/api/client";
import { resolveApiBaseUrl } from "@/lib/env";
import type {
  BookingMessageStreamEvent,
  BookingMessageStreamStatus,
} from "@/lib/booking-messages/types";

/**
 * Reconnect delays, then held at the final value, jittered by ±20% so a fleet
 * reconnecting after an outage does not synchronise.
 */
const BACKOFF_LADDER_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
const JITTER_RATIO = 0.2;

/** After this many consecutive failed connects the caller should fall back. */
export const MAX_CONSECUTIVE_SOCKET_FAILURES = 5;

/** Client-side typing throttle. The server enforces its own as well. */
const TYPING_THROTTLE_MS = 2_500;

export interface BookingMessageSocketHandle {
  /** Announces that the local user is composing. Throttled. */
  sendTyping(): void;
  /** Acknowledges receipt of messages authored by the other side. */
  sendDelivered(messageIds: string[]): void;
  close(): void;
}

function computeBackoffMs(attempt: number): number {
  const base =
    BACKOFF_LADDER_MS[Math.min(attempt, BACKOFF_LADDER_MS.length - 1)];
  const jitter = base * JITTER_RATIO * (Math.random() * 2 - 1);

  return Math.max(0, Math.round(base + jitter));
}

/** `http(s)://host/api/v1` → `ws(s)://host/ws/booking-messages`. */
function resolveSocketUrl(): string {
  const api = new URL(resolveApiBaseUrl(), window.location.origin);
  api.protocol = api.protocol === "https:" ? "wss:" : "ws:";
  api.pathname = "/ws/booking-messages";
  api.search = "";

  return api.toString();
}

/**
 * Opens the booking message socket.
 *
 * Authentication is a two-step exchange: a browser `WebSocket` cannot send an
 * `authorization` header, so the bearer token is first exchanged over REST for
 * a single-use ticket that the server returns as an HttpOnly cookie scoped to
 * the socket path. The browser then attaches it to the upgrade automatically —
 * the ticket is never readable by this code, and never appears in a URL.
 */
export function openBookingMessageSocket(options: {
  bookingRequestId: string;
  onEvent: (event: BookingMessageStreamEvent) => void;
  onStatus: (status: BookingMessageStreamStatus) => void;
}): BookingMessageSocketHandle {
  const { bookingRequestId, onEvent, onStatus } = options;

  let closed = false;
  let failures = 0;
  let suspended = false;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTypingAt = 0;

  function clearRetryTimer(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function closeCurrentSocket(): void {
    if (!socket) {
      return;
    }

    // Detached before closing: the handlers must not treat a deliberate
    // teardown as a dropped connection and schedule a reconnect.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;

    try {
      socket.close();
    } catch {
      // Already closing.
    }

    socket = null;
  }

  function scheduleReconnect(): void {
    if (closed || suspended) {
      return;
    }

    failures += 1;

    if (failures >= MAX_CONSECUTIVE_SOCKET_FAILURES) {
      onStatus("failed");
      return;
    }

    onStatus("reconnecting");
    clearRetryTimer();
    retryTimer = setTimeout(
      () => {
        retryTimer = null;
        void connect();
      },
      computeBackoffMs(failures - 1),
    );
  }

  async function connect(): Promise<void> {
    if (closed || suspended) {
      return;
    }

    closeCurrentSocket();
    onStatus("connecting");

    try {
      // Sets the HttpOnly ticket cookie. Its body carries only the lifetime.
      await authenticatedJson<{ expiresInSeconds: number }>(
        "POST",
        `/booking-requests/${encodeURIComponent(bookingRequestId)}/messages/socket-ticket`,
      );
    } catch {
      // A rejected exchange is usually an expired session or lost access; the
      // backoff applies rather than hammering the endpoint.
      scheduleReconnect();
      return;
    }

    if (closed || suspended) {
      return;
    }

    let next: WebSocket;

    try {
      next = new WebSocket(resolveSocketUrl());
    } catch {
      scheduleReconnect();
      return;
    }

    socket = next;

    next.onopen = () => {
      failures = 0;
      onStatus("open");
    };

    next.onmessage = (message) => {
      try {
        const frame = JSON.parse(String(message.data)) as
          | BookingMessageStreamEvent
          | { type: "ready" };

        // `ready` only confirms the subscription; the panel re-syncs off the
        // `open` status instead.
        if (frame.type === "ready") {
          return;
        }

        onEvent(frame);
      } catch {
        // A malformed frame must not tear down a healthy socket.
      }
    };

    next.onerror = () => {
      // `onclose` always follows, and it owns the reconnect decision.
    };

    next.onclose = () => {
      if (socket === next) {
        socket = null;
      }

      if (!closed && !suspended) {
        scheduleReconnect();
      }
    };
  }

  /** Returns whether the frame actually went out. */
  function send(frame: Record<string, unknown>): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch {
      // Dropping an ephemeral frame is preferable to surfacing an error.
      return false;
    }
  }

  function handleVisibilityChange(): void {
    if (closed) {
      return;
    }

    if (document.visibilityState === "hidden") {
      // Set before closing so the close handler does not read a deliberate
      // teardown as a drop and schedule a reconnect behind our back.
      suspended = true;
      closeCurrentSocket();
      clearRetryTimer();
      return;
    }

    if (!suspended) {
      return;
    }

    suspended = false;
    failures = 0;
    void connect();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  void connect();

  return {
    sendTyping(): void {
      const now = Date.now();

      if (now - lastTypingAt < TYPING_THROTTLE_MS) {
        return;
      }

      // Recorded only when the frame goes out: an attempt made while the
      // socket is closed would otherwise spend the window and suppress the
      // first real indicator after connecting.
      if (send({ type: "typing" })) {
        lastTypingAt = now;
      }
    },
    sendDelivered(messageIds: string[]): void {
      if (messageIds.length === 0) {
        return;
      }

      send({ type: "delivered", messageIds });
    },
    close(): void {
      if (closed) {
        return;
      }

      closed = true;
      clearRetryTimer();
      closeCurrentSocket();

      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    },
  };
}
