import { refreshStoredSession } from "@/lib/api/client";
import { readStoredSession } from "@/lib/auth/storage";
import { getDeviceId, getDevicePlatform } from "@/lib/auth/device";
import { resolveApiBaseUrl } from "@/lib/env";
import type {
  BookingMessageStreamEvent,
  BookingMessageStreamStatus,
} from "@/lib/booking-messages/types";

/**
 * Reconnect delays, then held at the final value. Jittered by ±20% so a fleet
 * of clients reconnecting after an outage does not synchronise.
 */
const BACKOFF_LADDER_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
const JITTER_RATIO = 0.2;

/** After this many consecutive failed connects the caller should fall back. */
export const MAX_CONSECUTIVE_STREAM_FAILURES = 5;

export interface BookingMessageStreamHandle {
  close(): void;
}

export interface ParsedSseFrame {
  event?: string;
  data: string;
  id?: string;
}

/**
 * Parses one SSE frame (the text between blank lines).
 *
 * Multiple `data:` lines are joined with a newline, per the SSE spec — a naive
 * "last line wins" parser silently truncates multi-line payloads.
 */
export function parseSseFrame(raw: string): ParsedSseFrame | null {
  const dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue =
      separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "data") {
      dataLines.push(value);
    } else if (field === "event") {
      event = value;
    } else if (field === "id") {
      id = value;
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    ...(event !== undefined ? { event } : {}),
    ...(id !== undefined ? { id } : {}),
    data: dataLines.join("\n"),
  };
}

function computeBackoffMs(attempt: number): number {
  const base =
    BACKOFF_LADDER_MS[Math.min(attempt, BACKOFF_LADDER_MS.length - 1)];
  const jitter = base * JITTER_RATIO * (Math.random() * 2 - 1);

  return Math.max(0, Math.round(base + jitter));
}

/**
 * Opens a live booking message stream.
 *
 * Uses `fetch` rather than `EventSource` because the API authenticates from the
 * `authorization` header, which `EventSource` cannot set.
 *
 * The stream is not a durable log. Callers must refetch the message history on
 * every `open` status and merge by message id; anything published while
 * disconnected is only recoverable that way (and via the notification email).
 */
export function openBookingMessageStream(options: {
  bookingRequestId: string;
  onEvent: (event: BookingMessageStreamEvent) => void;
  onStatus: (status: BookingMessageStreamStatus) => void;
}): BookingMessageStreamHandle {
  const { bookingRequestId, onEvent, onStatus } = options;
  const url = `${resolveApiBaseUrl()}/booking-requests/${encodeURIComponent(bookingRequestId)}/messages/stream`;

  let closed = false;
  let failures = 0;
  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let suspended = false;

  function buildHeaders(): Record<string, string> {
    const session = readStoredSession();
    const deviceId = getDeviceId();
    const devicePlatform = getDevicePlatform();

    return {
      accept: "text/event-stream",
      ...(session?.accessToken
        ? { authorization: `Bearer ${session.accessToken}` }
        : {}),
      ...(deviceId ? { "x-device-id": deviceId } : {}),
      ...(devicePlatform ? { "x-device-platform": devicePlatform } : {}),
    };
  }

  function clearRetryTimer(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleReconnect(delayMs?: number): void {
    // `suspended` matters as much as `closed`: aborting a live fetch because
    // the tab went hidden lands in the read-failure path, which would
    // otherwise schedule a reconnect that outlives the abort and race the
    // connection opened when the tab becomes visible again.
    if (closed || suspended) {
      return;
    }

    failures += 1;

    if (failures >= MAX_CONSECUTIVE_STREAM_FAILURES) {
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
      delayMs ?? computeBackoffMs(failures - 1),
    );
  }

  function dispatch(frame: ParsedSseFrame): void {
    if (frame.event === "heartbeat") {
      return;
    }

    if (frame.event === "ready") {
      // A successful handshake resets the ladder so a long-lived connection
      // that later drops retries quickly again.
      failures = 0;
      onStatus("open");
      return;
    }

    try {
      onEvent(JSON.parse(frame.data) as BookingMessageStreamEvent);
    } catch {
      // A malformed frame must not tear down an otherwise healthy stream.
    }
  }

  async function readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const chunk = await reader.read();

        if (chunk.done) {
          return;
        }

        // Chunk boundaries land mid-frame, so accumulate and only consume
        // whole frames.
        buffer += decoder.decode(chunk.value, { stream: true });

        let separatorIndex = buffer.indexOf("\n\n");
        while (separatorIndex !== -1) {
          const frame = parseSseFrame(buffer.slice(0, separatorIndex));
          buffer = buffer.slice(separatorIndex + 2);

          if (frame) {
            dispatch(frame);
          }

          separatorIndex = buffer.indexOf("\n\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Aborts the in-flight connection, if any, without ending the handle. */
  function abortCurrentConnection(): void {
    controller?.abort();
    controller = null;
  }

  async function connect(attemptedRefresh = false): Promise<void> {
    if (closed || suspended) {
      return;
    }

    // Never run two readers at once: a caller-initiated reconnect must replace
    // the current connection rather than sit alongside it.
    abortCurrentConnection();

    onStatus("connecting");
    controller = new AbortController();

    let response: Response;

    try {
      response = await fetch(url, {
        headers: buildHeaders(),
        credentials: "include",
        signal: controller.signal,
      });
    } catch {
      if (!closed) {
        scheduleReconnect();
      }
      return;
    }

    if (closed) {
      return;
    }

    if (response.status === 401 && !attemptedRefresh) {
      const refreshed = await refreshStoredSession();

      if (!refreshed) {
        onStatus("failed");
        return;
      }

      await connect(true);
      return;
    }

    if (response.status === 429) {
      // `Number(null)` is 0, not NaN, so a 429 without the header would
      // otherwise schedule an immediate reconnect and burn the whole failure
      // budget back to back.
      const header = response.headers.get("retry-after");
      const retryAfterSeconds = header === null ? Number.NaN : Number(header);
      const delayMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1_000
          : undefined;
      scheduleReconnect(delayMs);
      return;
    }

    if (!response.ok || !response.body) {
      scheduleReconnect();
      return;
    }

    try {
      await readStream(response.body);
    } catch {
      // Fall through: a read failure is treated as a disconnect.
    }

    // The server closed the stream (or the network dropped); reconnect unless
    // the caller closed us deliberately.
    if (!closed) {
      scheduleReconnect();
    }
  }

  function handleVisibilityChange(): void {
    if (closed) {
      return;
    }

    if (document.visibilityState === "hidden") {
      // Set `suspended` before aborting: the abort resolves the pending read
      // synchronously enough that scheduleReconnect would otherwise fire after
      // clearRetryTimer and leave a timer running in a hidden tab.
      suspended = true;
      abortCurrentConnection();
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
    close(): void {
      if (closed) {
        return;
      }

      closed = true;
      clearRetryTimer();
      abortCurrentConnection();

      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    },
  };
}
