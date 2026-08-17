/**
 * Redis key layout and wire types for the username bloom filter.
 *
 * Every key carries the parameter fingerprint, so changing capacity or the
 * target false positive rate moves the whole filter to a fresh namespace rather
 * than reinterpreting a bitmap built with different sizing.
 */

export const USERNAME_BLOOM_CACHE_PREFIX = "auth:username-bloom";

export interface UsernameBloomKeys {
  bits: string;
  meta: string;
  channel: string;
  /**
   * Passed to `CacheService.acquireLock`, which applies its own `lock:` prefix.
   */
  rebuildLock: string;
  /** Points at the in-progress shadow bitmap while a rebuild is running. */
  shadowPointer: string;
  shadowBits: (generation: number) => string;
  /** Names claimed while a rebuild is in flight, replayed before it lands. */
  replayList: (generation: number) => string;
}

export function buildUsernameBloomKeys(fingerprint: string): UsernameBloomKeys {
  const base = `${USERNAME_BLOOM_CACHE_PREFIX}:${fingerprint}`;

  return {
    bits: `${base}:bits`,
    meta: `${base}:meta`,
    channel: `${base}:events`,
    rebuildLock: `${base}:rebuild`,
    shadowPointer: `${base}:shadow`,
    shadowBits: (generation) => `${base}:bits:building:${generation}`,
    replayList: (generation) => `${base}:replay:${generation}`,
  };
}

export interface UsernameBloomMeta {
  /**
   * Incremented by each completed rebuild. Readers compare it against their
   * loaded copy to notice that the bitmap underneath them was replaced.
   */
  generation: number;
  builtAt: string;
  usernameCount: number;
  estimatedFalsePositiveRate: number;
}

export type UsernameBloomEvent =
  | { type: "add"; usernames: string[] }
  | { type: "rebuilt"; generation: number };

export function isUsernameBloomEvent(
  value: unknown,
): value is UsernameBloomEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<UsernameBloomEvent>;

  if (candidate.type === "add") {
    return (
      Array.isArray((candidate as { usernames?: unknown }).usernames) &&
      (candidate as { usernames: unknown[] }).usernames.every(
        (entry) => typeof entry === "string",
      )
    );
  }

  return (
    candidate.type === "rebuilt" &&
    typeof (candidate as { generation?: unknown }).generation === "number"
  );
}
