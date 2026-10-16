import { io, type ManagerOptions, type SocketOptions } from "socket.io-client";
import { resolveApiBaseUrl } from "@/lib/env";

/**
 * What the booking-message, blog-comment, and media-status socket clients
 * share. Each exchanges its session for a single-use ticket over REST, which
 * the server returns as an HttpOnly cookie scoped to the socket's path, then
 * opens the socket. How each mints its ticket, and what a successful connect
 * looks like, stay with the client.
 */

/** After this many consecutive failed connects a client stops trying. */
export const MAX_CONSECUTIVE_SOCKET_FAILURES = 5;

/** How long a client waits before its next attempt: longer after each failure. */
export function socketRetryDelayMs(failures: number): number {
  return 1_000 * failures;
}

/** `http(s)://host/api/v1` → `http(s)://host`. Socket.IO adds the path. */
export function resolveSocketOrigin(): string {
  return new URL(resolveApiBaseUrl(), window.location.origin).origin;
}

/** The options every ticketed socket opens with, on its own path. */
export function ticketedSocketOptions(
  path: string,
): Partial<ManagerOptions & SocketOptions> {
  return {
    path,
    // The ticket rides in a cookie, so the handshake has to carry credentials.
    withCredentials: true,
    // Each attempt needs a fresh single-use ticket, so reconnecting is driven
    // by the client rather than by Socket.IO.
    reconnection: false,
    // Load-bearing with several gateways on one origin: `socket.io-client`
    // caches Managers by origin, not by path, so without this a page with one
    // gateway's socket open could hand another the same Manager, and it would
    // silently connect to the wrong gateway.
    forceNew: true,
  };
}

/** Opens a socket on `path`, once its ticket cookie has been set. */
export function openTicketedSocket(path: string) {
  return io(resolveSocketOrigin(), ticketedSocketOptions(path));
}
