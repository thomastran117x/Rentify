import { createAdapter } from "@socket.io/redis-adapter";
import type { Logger } from "@/configuration/logging/types";
import { getRedisClient } from "@/configuration/resources/redis";

/**
 * Minimal cookie parse for a Socket.IO handshake. Express's cookie parser never
 * sees this request: the handshake arrives on the Socket.IO engine, not
 * through the app's middleware stack. Empty when the cookie is absent.
 */
export function readCookie(header: string | undefined, name: string): string {
  if (!header) {
    return "";
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return "";
}

export type SocketRedisAdapter = ReturnType<typeof createAdapter>;

/** A Redis connection the gateway must quit when it closes. */
export interface SocketRedisClient {
  quit: () => Promise<unknown>;
}

/**
 * Builds a gateway's Redis adapter, so an emit on one instance reaches sockets
 * held by every other.
 *
 * The adapter needs its own pair of connections: Redis puts a client into
 * subscriber mode exclusively, so the shared one backing cache, locks and rate
 * limiting cannot be reused. Every connection opened is returned, connected or
 * not, so the gateway quits it on close: recording them only on success would
 * leak an already-connected publisher for the life of the process if the
 * subscriber failed.
 *
 * `key` prefixes the adapter's channels. Gateways that share it receive each
 * other's broadcasts and discard them, since their rooms never match, so a
 * gateway with its own emitter gives itself a key of its own.
 *
 * A single-instance deployment still works without the adapter, so failing to
 * build it does not stop the gateway from serving: the adapter is null, and
 * the failure is logged loudly, because a replicated deployment silently loses
 * cross-node delivery.
 */
export async function createSocketRedisAdapter(
  logger: Pick<Logger, "error">,
  options: { key?: string } = {},
): Promise<{
  adapter: SocketRedisAdapter | null;
  clients: SocketRedisClient[];
}> {
  const clients: SocketRedisClient[] = [];

  try {
    const publisher = getRedisClient().duplicate();
    const subscriber = publisher.duplicate();
    clients.push(publisher, subscriber);
    await Promise.all([publisher.connect(), subscriber.connect()]);

    return {
      adapter: createAdapter(
        publisher,
        subscriber,
        options.key ? { key: options.key } : {},
      ),
      clients,
    };
  } catch (error) {
    logger.error(
      "Failed to build the Redis adapter; realtime delivery is limited to this instance.",
      undefined,
      error,
    );

    return { adapter: null, clients };
  }
}
