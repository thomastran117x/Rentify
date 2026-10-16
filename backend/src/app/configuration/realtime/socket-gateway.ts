import type { Server as SocketIoServer } from "socket.io";
import type { Logger } from "@/configuration/logging/types";
import type { SocketRedisClient } from "@/configuration/realtime/socket-handshake";

/** How often a gateway re-checks that its open sockets may stay. */
export const SOCKET_REAUTHORIZE_INTERVAL_MS = 60_000;

/**
 * The background work a gateway's handlers start, such as a handshake.
 *
 * Nothing awaits an event handler, so a failure is logged here rather than
 * thrown: an unhandled rejection would end the process, and one slow peer
 * could take down an otherwise healthy node. The work is kept until it
 * settles, so shutdown can wait for it before quitting Redis.
 */
export class GatewayWork {
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly logger: Pick<Logger, "error">,
    private readonly failureMessage: string,
  ) {}

  track(work: Promise<unknown>): void {
    const tracked = work.catch((error: unknown) => {
      this.logger.error(this.failureMessage, undefined, error);
    });

    this.pending.add(tracked);
    void tracked.finally(() => {
      this.pending.delete(tracked);
    });
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }
}

/**
 * Closes a gateway in the order that keeps a rolling deploy clean:
 *
 * 1. Disconnects this instance's sockets only. With the Redis adapter a bare
 *    `disconnectSockets()` is a cluster-wide broadcast, and would disconnect
 *    every client on every other instance too.
 * 2. Waits for the work those disconnects start, while Redis is still there.
 * 3. Closes the engine, and deliberately not `io.close()`: that closes the
 *    HTTP server, which the process shutdown has already closed, and the
 *    second close waits for a `close` event that never fires while a request
 *    is in flight.
 * 4. Quits the adapter's Redis connections.
 */
export async function closeGateway(
  io: SocketIoServer | null,
  work: GatewayWork,
  adapterClients: SocketRedisClient[],
): Promise<void> {
  if (io) {
    io.local.disconnectSockets(true);
    await work.drain();
    io.engine.close();
  }

  await Promise.allSettled(adapterClients.map((client) => client.quit()));
}
