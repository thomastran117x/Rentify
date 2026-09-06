/**
 * Identity availability filters — the rebuild side.
 *
 * Write-through keeps a filter current but can never take anything *out* of it:
 * a bloom filter has no delete. Renamed-away usernames and expired signup
 * reservations therefore accumulate as permanent false positives, each one
 * costing a database query it should not have needed. A periodic rebuild from
 * the source of truth is what sheds them.
 *
 * The logic lives here rather than in the worker entrypoint so it stays inside
 * the unit-test coverage set — `jest.unit.config.cjs` excludes `workers/`.
 */

import type { Logger } from "@/configuration/logging/types";
import {
  deriveBloomParameters,
  estimateFalsePositiveRate,
} from "@/features/auth/identity-bloom/bloom-parameters";
import { buildIdentityBloomKeys } from "@/features/auth/identity-bloom/identity-bloom-keys";
import type { IdentityBloomSubject } from "@/features/auth/identity-bloom/identity-bloom-subject";
import type { IdentityBloomStore } from "@/features/auth/identity-bloom/identity-bloom.store";
import { LocalBloomFilter } from "@/features/auth/identity-bloom/local-bloom-filter";
import type { IdentityBloomSource } from "@/features/auth/identity-bloom/sources/identity-bloom.source";
import type { CacheService } from "@/features/cache/cache.service";

export interface IdentityBloomRebuildConfig {
  capacity: number;
  falsePositiveRate: number;
  /** Full rebuild cadence; rebuilds remove stale false-positive-only entries. */
  rebuildIntervalMs: number;
  /** The source table is scanned in keyset pages of this size. */
  batchSize: number;
  /** Extended after every page so only one rebuild can publish. */
  lockTtlMs: number;
}

export interface IdentityBloomRebuildDependencies {
  subject: IdentityBloomSubject;
  store: IdentityBloomStore;
  source: IdentityBloomSource;
  cacheService: Pick<CacheService, "acquireLock" | "scanKeys">;
  config: IdentityBloomRebuildConfig;
  logger: Logger;
  now?: () => number;
}

export type IdentityBloomRebuildStatus =
  | "rebuilt"
  | "skipped-fresh"
  | "skipped-locked";

export interface IdentityBloomRebuildResult {
  status: IdentityBloomRebuildStatus;
  generation?: number;
  valueCount?: number;
  estimatedFalsePositiveRate?: number;
}

export async function rebuildIdentityBloom(
  dependencies: IdentityBloomRebuildDependencies,
): Promise<IdentityBloomRebuildResult> {
  const { subject, store, source, cacheService, config, logger } = dependencies;
  const now = dependencies.now ?? Date.now;

  const parameters = deriveBloomParameters(
    config.capacity,
    config.falsePositiveRate,
  );
  const keys = buildIdentityBloomKeys(
    subject.cachePrefix,
    parameters.fingerprint,
  );

  const existingMeta = await store.readMeta(keys.meta);

  if (isFresh(existingMeta?.builtAt, config.rebuildIntervalMs, now)) {
    return { status: "skipped-fresh", generation: existingMeta?.generation };
  }

  const lock = await cacheService.acquireLock(
    keys.rebuildLock,
    config.lockTtlMs,
  );

  if (!lock) {
    return { status: "skipped-locked" };
  }

  try {
    // Re-read under the lock: a sibling may have finished a rebuild between the
    // freshness check above and the lock being granted.
    const metaUnderLock = await store.readMeta(keys.meta);

    if (isFresh(metaUnderLock?.builtAt, config.rebuildIntervalMs, now)) {
      return { status: "skipped-fresh", generation: metaUnderLock?.generation };
    }

    const generation = (metaUnderLock?.generation ?? 0) + 1;
    const shadowKey = keys.shadowBits(generation);
    const replayKey = keys.replayList(generation);

    // A previous attempt may have died holding these; the generation only
    // advances on success, so the same names are reused.
    await store.delete([shadowKey, replayKey]);

    // From here on, every concurrent `add` records itself for replay.
    await store.writeKey(keys.shadowPointer, String(generation));

    // Build in memory and publish with one SET plus an atomic RENAME. Updating
    // the live Redis bitmap row-by-row would expose readers to a partial build.
    const filter = new LocalBloomFilter(parameters, subject.normalize);
    const persistedCount = await loadPersistedValues(
      filter,
      source,
      config.batchSize,
      lock,
      config.lockTtlMs,
    );
    const reservationCount = await loadPendingReservations(
      filter,
      cacheService,
      subject,
    );

    await store.writeBitmap(shadowKey, filter.toBuffer());
    await store.rename(shadowKey, keys.bits);

    // Deleting the pointer before the final replay read is what bounds the
    // hand-off: once it is gone no writer can append, and any writer that
    // appends after this read necessarily sets its live bit after the rename.
    await store.delete([keys.shadowPointer]);
    const replayed = await replayPendingAdds(
      store,
      keys.bits,
      replayKey,
      parameters,
      subject,
    );

    const totalCount = persistedCount + reservationCount;
    const estimated = estimateFalsePositiveRate(parameters, totalCount);

    await store.writeMeta(keys.meta, {
      generation,
      builtAt: new Date(now()).toISOString(),
      valueCount: totalCount,
      estimatedFalsePositiveRate: estimated,
    });
    await store.publish(keys.channel, { type: "rebuilt", generation });
    await store.delete([replayKey]);

    logger.info(`Rebuilt the ${subject.id} bloom filter.`, {
      subject: subject.id,
      generation,
      persistedCount,
      reservationCount,
      replayed,
      estimatedFalsePositiveRate: estimated,
      capacity: config.capacity,
    });

    if (estimated > config.falsePositiveRate * 2) {
      logger.warn(
        `The ${subject.id} bloom filter is saturated beyond its target false positive rate; consider raising ${subject.id.toUpperCase()}_BLOOM_CAPACITY.`,
        {
          subject: subject.id,
          valueCount: totalCount,
          capacity: config.capacity,
          estimatedFalsePositiveRate: estimated,
          targetFalsePositiveRate: config.falsePositiveRate,
        },
      );
    }

    return {
      status: "rebuilt",
      generation,
      valueCount: totalCount,
      estimatedFalsePositiveRate: estimated,
    };
  } finally {
    await lock.release();
  }
}

function isFresh(
  builtAt: string | undefined,
  rebuildIntervalMs: number,
  now: () => number,
): boolean {
  if (!builtAt) {
    return false;
  }

  const builtAtMs = Date.parse(builtAt);

  if (Number.isNaN(builtAtMs)) {
    return false;
  }

  return now() - builtAtMs < rebuildIntervalMs;
}

async function loadPersistedValues(
  filter: LocalBloomFilter,
  source: IdentityBloomSource,
  batchSize: number,
  lock: { extend: (ttlInMs: number) => Promise<boolean> },
  lockTtlMs: number,
): Promise<number> {
  let cursorId: string | null = null;
  let total = 0;

  for (;;) {
    const page = await source.listValuesAfter(cursorId, batchSize);

    for (const value of page.values) {
      filter.add(value);
      total += 1;
    }

    if (!page.nextCursorId) {
      return total;
    }

    cursorId = page.nextCursorId;
    // A long walk must not let the lock lapse and admit a second rebuilder.
    await lock.extend(lockTtlMs);
  }
}

/**
 * Unverified signups hold a soft reservation in Redis rather than a row, and a
 * filter miss skips the reservation lookup as well as the database one. Leaving
 * them out would let an availability check report a reserved value as though
 * nothing had ever been submitted for it.
 */
async function loadPendingReservations(
  filter: LocalBloomFilter,
  cacheService: Pick<CacheService, "scanKeys">,
  subject: IdentityBloomSubject,
): Promise<number> {
  const keys = await cacheService.scanKeys(`${subject.reservationPrefix}:*`);
  let total = 0;

  for (const key of keys) {
    const value = key.slice(subject.reservationPrefix.length + 1);

    if (value) {
      filter.add(value);
      total += 1;
    }
  }

  return total;
}

async function replayPendingAdds(
  store: IdentityBloomStore,
  bitsKey: string,
  replayKey: string,
  parameters: ReturnType<typeof deriveBloomParameters>,
  subject: IdentityBloomSubject,
): Promise<number> {
  const values = await store.readReplayEntries(replayKey);

  if (values.length === 0) {
    return 0;
  }

  const scratch = new LocalBloomFilter(parameters, subject.normalize);
  const indices: number[] = [];

  for (const value of values) {
    indices.push(...scratch.getIndices(value));
  }

  await store.setBits(bitsKey, indices);

  return values.length;
}
