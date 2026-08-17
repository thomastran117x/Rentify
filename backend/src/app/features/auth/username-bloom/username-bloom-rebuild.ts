/**
 * Username availability filter — the rebuild side.
 *
 * Write-through keeps the filter current but can never take anything *out* of
 * it: a bloom filter has no delete. Renamed-away names and expired signup
 * reservations therefore accumulate as permanent false positives, each one
 * costing a database query it should not have needed. A periodic rebuild from
 * the source of truth is what sheds them.
 *
 * The logic lives here rather than in the worker entrypoint so it stays inside
 * the unit-test coverage set — `jest.unit.config.cjs` excludes `workers/`.
 */

import type { Logger } from "@/configuration/logging/types";
import { PENDING_LOCAL_SIGNUP_USERNAME_CACHE_PREFIX } from "@/features/auth/pending-signup-username";
import {
  deriveBloomParameters,
  estimateFalsePositiveRate,
} from "@/features/auth/username-bloom/bloom-parameters";
import { LocalBloomFilter } from "@/features/auth/username-bloom/local-bloom-filter";
import { buildUsernameBloomKeys } from "@/features/auth/username-bloom/username-bloom-keys";
import type { UsernameBloomRepository } from "@/features/auth/username-bloom/username-bloom.repository";
import type { UsernameBloomStore } from "@/features/auth/username-bloom/username-bloom.store";
import type { CacheService } from "@/features/cache/cache.service";

export interface UsernameBloomRebuildConfig {
  capacity: number;
  falsePositiveRate: number;
  rebuildIntervalMs: number;
  batchSize: number;
  lockTtlMs: number;
}

export interface UsernameBloomRebuildDependencies {
  store: UsernameBloomStore;
  repository: UsernameBloomRepository;
  cacheService: Pick<CacheService, "acquireLock" | "scanKeys">;
  config: UsernameBloomRebuildConfig;
  logger: Logger;
  now?: () => number;
}

export type UsernameBloomRebuildStatus =
  | "rebuilt"
  | "skipped-fresh"
  | "skipped-locked";

export interface UsernameBloomRebuildResult {
  status: UsernameBloomRebuildStatus;
  generation?: number;
  usernameCount?: number;
  estimatedFalsePositiveRate?: number;
}

export async function rebuildUsernameBloom(
  dependencies: UsernameBloomRebuildDependencies,
): Promise<UsernameBloomRebuildResult> {
  const { store, repository, cacheService, config, logger } = dependencies;
  const now = dependencies.now ?? Date.now;

  const parameters = deriveBloomParameters(
    config.capacity,
    config.falsePositiveRate,
  );
  const keys = buildUsernameBloomKeys(parameters.fingerprint);

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

    const filter = new LocalBloomFilter(parameters);
    const usernameCount = await loadUsernames(
      filter,
      repository,
      config.batchSize,
      lock,
      config.lockTtlMs,
    );
    const reservationCount = await loadPendingReservations(
      filter,
      cacheService,
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
    );

    const totalCount = usernameCount + reservationCount;
    const estimated = estimateFalsePositiveRate(parameters, totalCount);

    await store.writeMeta(keys.meta, {
      generation,
      builtAt: new Date(now()).toISOString(),
      usernameCount: totalCount,
      estimatedFalsePositiveRate: estimated,
    });
    await store.publish(keys.channel, { type: "rebuilt", generation });
    await store.delete([replayKey]);

    logger.info("Rebuilt the username bloom filter.", {
      generation,
      usernameCount,
      reservationCount,
      replayed,
      estimatedFalsePositiveRate: estimated,
      capacity: config.capacity,
    });

    if (estimated > config.falsePositiveRate * 2) {
      logger.warn(
        "Username bloom filter is saturated beyond its target false positive rate; consider raising USERNAME_BLOOM_CAPACITY.",
        {
          usernameCount: totalCount,
          capacity: config.capacity,
          estimatedFalsePositiveRate: estimated,
          targetFalsePositiveRate: config.falsePositiveRate,
        },
      );
    }

    return {
      status: "rebuilt",
      generation,
      usernameCount: totalCount,
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

async function loadUsernames(
  filter: LocalBloomFilter,
  repository: UsernameBloomRepository,
  batchSize: number,
  lock: { extend: (ttlInMs: number) => Promise<boolean> },
  lockTtlMs: number,
): Promise<number> {
  let cursorId: string | null = null;
  let total = 0;

  for (;;) {
    const page = await repository.listUsernamesAfter(cursorId, batchSize);

    for (const username of page.usernames) {
      filter.add(username);
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
 * them out would let the endpoint report a reserved name as free — exactly what
 * `pending-signup-username.ts` exists to prevent.
 */
async function loadPendingReservations(
  filter: LocalBloomFilter,
  cacheService: Pick<CacheService, "scanKeys">,
): Promise<number> {
  const keys = await cacheService.scanKeys(
    `${PENDING_LOCAL_SIGNUP_USERNAME_CACHE_PREFIX}:*`,
  );
  let total = 0;

  for (const key of keys) {
    const username = key.slice(
      PENDING_LOCAL_SIGNUP_USERNAME_CACHE_PREFIX.length + 1,
    );

    if (username) {
      filter.add(username);
      total += 1;
    }
  }

  return total;
}

async function replayPendingAdds(
  store: UsernameBloomStore,
  bitsKey: string,
  replayKey: string,
  parameters: ReturnType<typeof deriveBloomParameters>,
): Promise<number> {
  const usernames = await store.readReplayEntries(replayKey);

  if (usernames.length === 0) {
    return 0;
  }

  const scratch = new LocalBloomFilter(parameters);
  const indices: number[] = [];

  for (const username of usernames) {
    indices.push(...scratch.getIndices(username));
  }

  await store.setBits(bitsKey, indices);

  return usernames.length;
}
