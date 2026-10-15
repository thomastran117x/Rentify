import type { CacheService } from "@/features/cache/cache.service";

/**
 * `setIfNotExists` over an in-memory set, for code that claims a key once.
 * TTLs are ignored: a test runs well within any of them.
 */
export class InMemoryCacheClaims
  implements Pick<CacheService, "setIfNotExists">
{
  readonly keys = new Set<string>();

  async setIfNotExists(key: string): Promise<boolean> {
    if (this.keys.has(key)) {
      return false;
    }

    this.keys.add(key);
    return true;
  }
}
