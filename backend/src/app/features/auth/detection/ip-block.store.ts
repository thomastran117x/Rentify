import type { CacheService } from "@/features/cache/cache.service";

const KEY_PREFIX = "auth:ip-block:";

export interface AuthIpBlock {
  ipAddress: string;
  expiresAt: string;
}

type IpBlockCache = Pick<
  CacheService,
  "set" | "ttl" | "delete" | "scanKeys" | "mget"
>;

/**
 * Temporary blocks that keep an IP address off the `auth-sensitive` rate-limit
 * policy, placed by credential-stuffing detection in enforce mode. Each is a
 * Redis key that expires with the block, holding its expiry time, so a block
 * lifts on its own and an admin can clear it early.
 */
export class AuthIpBlockStore {
  constructor(private readonly cache: IpBlockCache) {}

  async block(
    ipAddress: string,
    seconds: number,
    now: Date = new Date(),
  ): Promise<AuthIpBlock> {
    const expiresAt = new Date(now.getTime() + seconds * 1000).toISOString();

    await this.cache.set(this.key(ipAddress), expiresAt, seconds);

    return { ipAddress, expiresAt };
  }

  /** Seconds until the block lifts, or 0 when the address is not blocked. */
  async getRemainingSeconds(ipAddress: string): Promise<number> {
    const ttl = await this.cache.ttl(this.key(ipAddress));

    return ttl > 0 ? ttl : 0;
  }

  /** Every live block, soonest to lift first. */
  async list(): Promise<AuthIpBlock[]> {
    const keys = await this.cache.scanKeys(`${KEY_PREFIX}*`);

    if (keys.length === 0) {
      return [];
    }

    const values = await this.cache.mget(keys);
    const blocks: AuthIpBlock[] = [];

    keys.forEach((key, index) => {
      const expiresAt = values[index];

      // A key that expired between the scan and the read is already lifted.
      if (expiresAt) {
        blocks.push({ ipAddress: key.slice(KEY_PREFIX.length), expiresAt });
      }
    });

    return blocks.sort((left, right) =>
      left.expiresAt.localeCompare(right.expiresAt),
    );
  }

  /** Lifts a block; false when the address was not blocked. */
  async clear(ipAddress: string): Promise<boolean> {
    return this.cache.delete(this.key(ipAddress));
  }

  private key(ipAddress: string): string {
    return `${KEY_PREFIX}${ipAddress.toLowerCase()}`;
  }
}
