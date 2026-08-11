import crypto from "node:crypto";
import {
  getRedisClient,
  type redisClient,
} from "@/configuration/resources/redis";

type RedisClient = NonNullable<typeof redisClient>;

export interface RedisLock {
  key: string;
  token: string;
  release: () => Promise<boolean>;
  extend: (ttlInMs: number) => Promise<boolean>;
}

export class CacheService {
  private readonly client?: RedisClient;

  constructor(client?: RedisClient) {
    this.client = client;
  }

  private getClient(): RedisClient {
    return this.client ?? getRedisClient();
  }

  async get(key: string): Promise<string | null> {
    return this.getClient().get(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);

    if (value === null) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      await this.delete(key);
      return null;
    }
  }

  /**
   * Reads a key and removes it in one round trip, so exactly one caller can
   * ever observe the value. A `get` followed by a `delete` is not equivalent:
   * two callers can both complete the read before either deletes, and both then
   * act on it. That difference is the whole point for single-use tokens.
   */
  async getDeleteJson<T>(key: string): Promise<T | null> {
    const value = await this.getClient().getDel(key);

    if (value === null) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      // The key is already gone, so there is nothing to clean up here.
      return null;
    }
  }

  async set(key: string, value: string, ttlInSeconds?: number): Promise<void> {
    if (ttlInSeconds === undefined) {
      await this.getClient().set(key, value);
      return;
    }

    await this.getClient().set(key, value, {
      EX: ttlInSeconds,
    });
  }

  async setJson(
    key: string,
    value: unknown,
    ttlInSeconds?: number,
  ): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlInSeconds);
  }

  async setIfNotExists(
    key: string,
    value: string,
    ttlInSeconds?: number,
  ): Promise<boolean> {
    const result = await this.getClient().set(key, value, {
      NX: true,
      ...(ttlInSeconds !== undefined ? { EX: ttlInSeconds } : {}),
    });

    return result === "OK";
  }

  async getOrSetJson<T>(
    key: string,
    factory: () => Promise<T>,
    ttlInSeconds: number,
  ): Promise<T> {
    const cached = await this.getJson<T>(key);

    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.setJson(key, value, ttlInSeconds);

    return value;
  }

  async delete(key: string): Promise<boolean> {
    const deletedCount = await this.getClient().del(key);
    return deletedCount > 0;
  }

  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    return this.getClient().del(keys);
  }

  async exists(key: string): Promise<boolean> {
    const exists = await this.getClient().exists(key);
    return exists === 1;
  }

  async expire(key: string, ttlInSeconds: number): Promise<boolean> {
    const wasUpdated = await this.getClient().expire(key, ttlInSeconds);
    return wasUpdated === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.getClient().ttl(key);
  }

  /**
   * Publishes to a Redis pub/sub channel and returns the number of subscribers
   * that received the message.
   *
   * Fan-out only — pub/sub is fire-and-forget, so a message published while no
   * subscriber is connected is dropped. Callers must not rely on this for
   * durability.
   */
  async publish(channel: string, message: string): Promise<number> {
    return this.getClient().publish(channel, message);
  }

  /**
   * Adds or updates a member in a sorted set, scored by an expiry timestamp.
   *
   * The pattern this exists for is a lease register: many holders, each with an
   * independent expiry, where the set is live if any unexpired member remains.
   * A counter cannot express that — refreshing it renews every holder's share
   * at once, including shares belonging to processes that have since died.
   */
  async addToLeaseSet(
    key: string,
    member: string,
    expiresAtMs: number,
  ): Promise<void> {
    await this.getClient().zAdd(key, { score: expiresAtMs, value: member });
  }

  async removeFromLeaseSet(key: string, member: string): Promise<void> {
    await this.getClient().zRem(key, member);
  }

  /**
   * Drops expired members and returns how many remain. Pruning on read is what
   * makes a crashed holder's lease disappear on its own: nothing else is going
   * to come back and remove it.
   */
  async countLiveLeases(key: string, nowMs: number): Promise<number> {
    const client = this.getClient();
    await client.zRemRangeByScore(key, "-inf", nowMs);

    return client.zCard(key);
  }

  async increment(key: string, amount = 1): Promise<number> {
    return this.getClient().incrBy(key, amount);
  }

  async decrement(key: string, amount = 1): Promise<number> {
    return this.getClient().decrBy(key, amount);
  }

  async mget(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) {
      return [];
    }

    return this.getClient().mGet(keys);
  }

  async mset(values: Record<string, string>): Promise<void> {
    const entries = Object.entries(values);

    if (entries.length === 0) {
      return;
    }

    await this.getClient().mSet(values);
  }

  async scanKeys(pattern: string, count = 100): Promise<string[]> {
    const client = this.getClient();
    const keys: string[] = [];

    let cursor = "0";

    do {
      const result = await client.scan(cursor, {
        MATCH: pattern,
        COUNT: count,
      });

      cursor = result.cursor;
      keys.push(...result.keys);
    } while (cursor !== "0");

    return keys;
  }

  async deleteByPattern(pattern: string): Promise<number> {
    const keys = await this.scanKeys(pattern);

    if (keys.length === 0) {
      return 0;
    }

    return this.deleteMany(keys);
  }

  async eval<TResult>(
    script: string,
    keys: string[] = [],
    args: string[] = [],
  ): Promise<TResult> {
    return this.getClient().eval(script, {
      keys,
      arguments: args,
    }) as Promise<TResult>;
  }

  async acquireLock(
    key: string,
    ttlInMs: number,
    token = crypto.randomUUID(),
  ): Promise<RedisLock | null> {
    const lockKey = `lock:${key}`;

    const result = await this.getClient().set(lockKey, token, {
      NX: true,
      PX: ttlInMs,
    });

    if (result !== "OK") {
      return null;
    }

    return {
      key: lockKey,
      token,
      release: () => this.releaseLock(lockKey, token),
      extend: (ttlInMs: number) => this.extendLock(lockKey, token, ttlInMs),
    };
  }

  async releaseLock(lockKey: string, token: string): Promise<boolean> {
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end

      return 0
    `;

    const result = await this.eval<number>(script, [lockKey], [token]);
    return result === 1;
  }

  async extendLock(
    lockKey: string,
    token: string,
    ttlInMs: number,
  ): Promise<boolean> {
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
      end

      return 0
    `;

    const result = await this.eval<number>(
      script,
      [lockKey],
      [token, ttlInMs.toString()],
    );

    return result === 1;
  }

  async withLock<T>(
    key: string,
    ttlInMs: number,
    callback: () => Promise<T>,
  ): Promise<T> {
    const lock = await this.acquireLock(key, ttlInMs);

    if (!lock) {
      throw new Error(`Could not acquire Redis lock for key: ${key}`);
    }

    try {
      return await callback();
    } finally {
      await lock.release();
    }
  }
}
