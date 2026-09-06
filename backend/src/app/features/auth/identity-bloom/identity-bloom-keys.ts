/**
 * Redis key layout and wire types for the identity bloom filters.
 *
 * Every key carries the subject's prefix and the parameter fingerprint, so two
 * subjects never share a keyspace and changing capacity or the target false
 * positive rate moves a filter to a fresh namespace rather than reinterpreting
 * a bitmap built with different sizing.
 */

export interface IdentityBloomKeys {
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
  /** Values claimed while a rebuild is in flight, replayed before it lands. */
  replayList: (generation: number) => string;
}

export function buildIdentityBloomKeys(
  cachePrefix: string,
  fingerprint: string,
): IdentityBloomKeys {
  const base = `${cachePrefix}:${fingerprint}`;

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

export interface IdentityBloomMeta {
  /**
   * Incremented by each completed rebuild. Readers compare it against their
   * loaded copy to notice that the bitmap underneath them was replaced.
   */
  generation: number;
  builtAt: string;
  valueCount: number;
  estimatedFalsePositiveRate: number;
}

export type IdentityBloomEvent =
  | { type: "add"; values: string[] }
  | { type: "rebuilt"; generation: number };

/**
 * Accepts the pre-rename `usernames` spelling as well as `values`.
 *
 * During a rolling deploy an old instance still publishes the old field name,
 * and dropping those events would leave new instances briefly unaware of names
 * claimed elsewhere. The cost is bounded — write-through already set the bit on
 * the instance that made the claim, and siblings heal on the next reload — but
 * the branch is cheap enough that it is not worth the window.
 *
 * Removable once no instance publishing `usernames` is still running.
 */
export function readIdentityBloomEventValues(value: unknown): string[] | null {
  const candidate = value as {
    values?: unknown;
    usernames?: unknown;
  };
  const raw = candidate.values ?? candidate.usernames;

  if (!Array.isArray(raw) || !raw.every((entry) => typeof entry === "string")) {
    return null;
  }

  return raw as string[];
}

export function parseIdentityBloomEvent(
  value: unknown,
): IdentityBloomEvent | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<IdentityBloomEvent>;

  if (candidate.type === "add") {
    const values = readIdentityBloomEventValues(value);

    return values === null ? null : { type: "add", values };
  }

  if (
    candidate.type === "rebuilt" &&
    typeof (candidate as { generation?: unknown }).generation === "number"
  ) {
    return {
      type: "rebuilt",
      generation: (candidate as { generation: number }).generation,
    };
  }

  return null;
}
