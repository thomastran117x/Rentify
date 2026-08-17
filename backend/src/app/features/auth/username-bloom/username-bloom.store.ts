/**
 * The Redis (L2) half of the username bloom filter.
 *
 * A thin gateway rather than a general cache wrapper, because the filter needs
 * primitives `CacheService` deliberately does not expose: binary-safe reads,
 * bit writes, pub/sub on a dedicated connection, and an atomic key swap.
 *
 * The binary-safe read is the load-bearing part. `client.get` decodes the reply
 * as UTF-8, which rewrites any byte above 0x7F — a bitmap byte of 0x81 comes
 * back as 0xFD. Silently flipping bits that way would turn "definitely absent"
 * into a lie, so every bitmap read goes through a Buffer type mapping.
 */

import { RESP_TYPES } from "redis";
import {
  getRedisClient,
  type redisClient,
} from "@/configuration/resources/redis";
import {
  isUsernameBloomEvent,
  type UsernameBloomEvent,
  type UsernameBloomMeta,
} from "@/features/auth/username-bloom/username-bloom-keys";

type RedisClient = NonNullable<typeof redisClient>;

/** Keeps a single BITFIELD command well inside Redis' argument limits. */
const MAX_BIT_OPERATIONS_PER_COMMAND = 512;

export interface UsernameBloomSubscription {
  close: () => Promise<void>;
}

export class UsernameBloomStore {
  private binaryClient: ReturnType<RedisClient["withTypeMapping"]> | null =
    null;
  private binaryClientSource: RedisClient | null = null;

  constructor(
    private readonly resolveClient: () => RedisClient = getRedisClient,
  ) {}

  private getClient(): RedisClient {
    return this.resolveClient();
  }

  /**
   * Memoized per underlying connection: `withTypeMapping` builds a proxy, and
   * rebuilding it on every read would be wasteful. Reconnects hand back a new
   * client object, which the source check notices.
   */
  private getBinaryClient(): ReturnType<RedisClient["withTypeMapping"]> {
    const client = this.getClient();

    if (!this.binaryClient || this.binaryClientSource !== client) {
      this.binaryClient = client.withTypeMapping({
        [RESP_TYPES.BLOB_STRING]: Buffer,
      });
      this.binaryClientSource = client;
    }

    return this.binaryClient;
  }

  async readBitmap(key: string): Promise<Buffer | null> {
    const value = (await this.getBinaryClient().get(key)) as Buffer | null;

    return value === null ? null : value;
  }

  async writeBitmap(key: string, bitmap: Buffer): Promise<void> {
    await this.getClient().set(key, bitmap);
  }

  /**
   * Sets every listed bit to 1. Idempotent, which is what lets a rebuild replay
   * the same names twice without having to reason about ordering.
   */
  async setBits(key: string, indices: number[]): Promise<void> {
    const client = this.getClient();

    for (
      let start = 0;
      start < indices.length;
      start += MAX_BIT_OPERATIONS_PER_COMMAND
    ) {
      const chunk = indices.slice(
        start,
        start + MAX_BIT_OPERATIONS_PER_COMMAND,
      );

      await client.bitField(
        key,
        chunk.map((offset) => ({
          operation: "SET" as const,
          encoding: "u1" as const,
          offset,
          value: 1,
        })),
      );
    }
  }

  async readMeta(key: string): Promise<UsernameBloomMeta | null> {
    const raw = await this.getClient().get(key);

    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as UsernameBloomMeta;
    } catch {
      return null;
    }
  }

  async writeMeta(key: string, meta: UsernameBloomMeta): Promise<void> {
    await this.getClient().set(key, JSON.stringify(meta));
  }

  async publish(channel: string, event: UsernameBloomEvent): Promise<void> {
    await this.getClient().publish(channel, JSON.stringify(event));
  }

  /**
   * Subscribes on a duplicated connection. node-redis puts a subscribed client
   * into a mode where ordinary commands are rejected, so the filter cannot
   * share the connection it uses for reads and writes.
   */
  async subscribe(
    channel: string,
    onEvent: (event: UsernameBloomEvent) => void,
    onError?: (error: unknown) => void,
  ): Promise<UsernameBloomSubscription> {
    const subscriber = this.getClient().duplicate();

    subscriber.on("error", (error: unknown) => {
      onError?.(error);
    });

    await subscriber.connect();
    await subscriber.subscribe(channel, (message: string) => {
      try {
        const parsed: unknown = JSON.parse(message);

        if (isUsernameBloomEvent(parsed)) {
          onEvent(parsed);
        }
      } catch (error) {
        onError?.(error);
      }
    });

    return {
      close: async () => {
        try {
          if (subscriber.isOpen) {
            await subscriber.unsubscribe(channel);
            await subscriber.quit();
          }
        } catch (error) {
          onError?.(error);
        }
      },
    };
  }

  async pushReplayEntries(key: string, usernames: string[]): Promise<void> {
    if (usernames.length === 0) {
      return;
    }

    await this.getClient().rPush(key, usernames);
  }

  async readReplayEntries(key: string): Promise<string[]> {
    return this.getClient().lRange(key, 0, -1);
  }

  async readKey(key: string): Promise<string | null> {
    return this.getClient().get(key);
  }

  async writeKey(key: string, value: string): Promise<void> {
    await this.getClient().set(key, value);
  }

  /** Atomic swap used to publish a freshly rebuilt bitmap. */
  async rename(from: string, to: string): Promise<void> {
    await this.getClient().rename(from, to);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.getClient().exists(key)) === 1;
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    await this.getClient().del(keys);
  }
}
