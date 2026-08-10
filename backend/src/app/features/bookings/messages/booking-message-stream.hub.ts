import { loggerFactory } from "@/configuration/logging";
import type { Logger } from "@/configuration/logging/types";
import {
  getRedisClient,
  type redisClient,
} from "@/configuration/resources/redis";
import type { BookingMessageStreamEvent } from "@/features/bookings/messages/booking-messages.model";

type RedisClient = NonNullable<typeof redisClient>;

export function bookingMessageChannel(bookingRequestId: string): string {
  return `booking-messages:${bookingRequestId}`;
}

export type BookingMessageStreamListener = (
  event: BookingMessageStreamEvent,
) => void;

// `duplicate()` returns a client configured identically to its source, so the
// subscriber shares the concrete client type rather than the wider generic one
// that the method signature resolves to.
type SubscriberClient = RedisClient;

/**
 * Fans Redis pub/sub booking-message events out to the SSE connections held by
 * this process.
 *
 * Registered as a singleton: it must outlive the per-request container scope,
 * which `containerScopeMiddleware` disposes as soon as the streaming handler
 * returns its Response.
 */
export class BookingMessageStreamHub {
  private readonly logger: Logger;
  private readonly listeners = new Map<
    string,
    Set<BookingMessageStreamListener>
  >();

  /** In-flight or settled SUBSCRIBE per channel, awaited by every subscriber. */
  private readonly channelSubscriptions = new Map<string, Promise<void>>();

  private subscriber: SubscriberClient | null = null;
  private connecting: Promise<SubscriberClient> | null = null;
  private readonly client?: RedisClient;

  constructor(client?: RedisClient) {
    this.client = client;
    this.logger = loggerFactory.forClass(BookingMessageStreamHub, "service");
  }

  /**
   * Subscribes to a thread's channel and returns a release function. The
   * caller must always invoke it — the SSE handler does so from its teardown
   * path.
   */
  async subscribe(
    bookingRequestId: string,
    listener: BookingMessageStreamListener,
  ): Promise<() => Promise<void>> {
    const channel = bookingMessageChannel(bookingRequestId);
    const client = await this.ensureSubscriber();

    let channelListeners = this.listeners.get(channel);

    if (!channelListeners) {
      channelListeners = new Set();
      this.listeners.set(channel, channelListeners);
    }

    channelListeners.add(listener);

    // Every caller awaits the same in-flight SUBSCRIBE, not just the one that
    // started it. Otherwise a second subscriber for a channel already being
    // subscribed returns immediately, its handler emits `ready`, and anything
    // published before Redis finishes subscribing is lost to both the stream
    // and the re-sync that `ready` triggers.
    let pending = this.channelSubscriptions.get(channel);

    if (!pending) {
      pending = client
        .subscribe(channel, (message: string) => {
          this.dispatch(channel, message);
        })
        .then(() => undefined);
      this.channelSubscriptions.set(channel, pending);
    }

    try {
      await pending;
    } catch (error) {
      channelListeners.delete(listener);

      if (channelListeners.size === 0) {
        this.listeners.delete(channel);
        this.channelSubscriptions.delete(channel);
      }

      throw error;
    }

    let released = false;

    return async () => {
      if (released) {
        return;
      }

      released = true;
      await this.release(channel, listener);
    };
  }

  /** Number of channels with at least one live listener. Used by tests. */
  activeChannelCount(): number {
    return this.listeners.size;
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    this.channelSubscriptions.clear();

    const client = this.subscriber;
    this.subscriber = null;
    this.connecting = null;

    if (!client) {
      return;
    }

    try {
      await client.quit();
    } catch (error) {
      this.logger.warn(
        "Failed to close the booking message subscriber connection.",
        undefined,
        error,
      );
    } finally {
      // `quit()` waits for a reply, so an unhealthy subscriber connection can
      // leave it pending. `destroy()` releases the socket unconditionally; it
      // throws once the client is already closed, so it is best-effort.
      try {
        client.destroy();
      } catch {
        // Already closed — nothing left to release.
      }
    }
  }

  private async release(
    channel: string,
    listener: BookingMessageStreamListener,
  ): Promise<void> {
    const channelListeners = this.listeners.get(channel);

    if (!channelListeners) {
      return;
    }

    channelListeners.delete(listener);

    if (channelListeners.size > 0) {
      return;
    }

    this.listeners.delete(channel);
    this.channelSubscriptions.delete(channel);

    try {
      await this.subscriber?.unsubscribe(channel);
    } catch (error) {
      this.logger.warn(
        "Failed to unsubscribe from a booking message channel.",
        { channel },
        error,
      );
    }
  }

  private dispatch(channel: string, message: string): void {
    const channelListeners = this.listeners.get(channel);

    if (!channelListeners || channelListeners.size === 0) {
      return;
    }

    let event: BookingMessageStreamEvent;

    try {
      event = JSON.parse(message) as BookingMessageStreamEvent;
    } catch (error) {
      // Never rethrow here: this runs inside the Redis client's message
      // handler, where a throw becomes an unhandled rejection.
      this.logger.warn(
        "Discarded a malformed booking message event.",
        { channel },
        error,
      );
      return;
    }

    for (const listener of channelListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn(
          "A booking message stream listener failed.",
          { channel },
          error,
        );
      }
    }
  }

  /**
   * `redis` puts a connection into subscriber mode exclusively, so the shared
   * client cannot be reused — it backs the cache, distributed locks, and rate
   * limiting for the whole process. The duplicate is created once and
   * single-flighted so concurrent first subscribes cannot open two.
   */
  private async ensureSubscriber(): Promise<SubscriberClient> {
    if (this.subscriber) {
      return this.subscriber;
    }

    if (this.connecting) {
      return this.connecting;
    }

    const connecting = (async () => {
      const client = (this.client ?? getRedisClient()).duplicate();

      client.on("error", (error: unknown) => {
        this.logger.error(
          "Booking message subscriber connection error.",
          undefined,
          error,
        );
      });

      await client.connect();
      this.subscriber = client;
      return client;
    })();

    this.connecting = connecting;

    try {
      return await connecting;
    } catch (error) {
      // Clear the single-flight guard so a later subscribe can retry.
      this.connecting = null;
      throw error;
    }
  }
}
