/**
 * Username availability filter — the read side.
 *
 * Answers "could this username already be taken" from an in-process bit array,
 * so the common case (a name nobody has claimed) never reaches MySQL. Only a
 * negative answer is trusted; anything else defers to the authoritative lookup
 * in `UsernameService.isUsernameAvailable`.
 *
 * The in-process array is the zero-round-trip L1. Redis holds the shared bitmap
 * and generation metadata used as L2, while `username-bloom.worker.ts`
 * periodically rebuilds that shared copy from profiles and pending signup
 * reservations. Redis accelerates reads here; MySQL and reservation records
 * remain the sources of truth.
 *
 * Three mechanisms keep the local copy honest, each covering the previous one's
 * blind spot:
 *
 * - **write-through** makes the instance that claimed a name correct instantly
 * - **pub/sub** propagates that claim to sibling instances within a round trip
 * - **periodic reload** heals messages dropped while a subscriber was
 *   reconnecting, since Redis pub/sub delivers at most once
 *
 * On top of those sits a readiness-and-freshness gate, because the failure this
 * design cannot tolerate is answering "definitely absent" from a bit array that
 * merely *looks* empty. An unloaded or stale filter reports `unknown` and the
 * caller falls back to the database — the behaviour this feature replaced.
 */

import type { Logger } from "@/configuration/logging/types";
import { normalizeUsernameForBloom } from "@/features/auth/username-bloom/bloom-hash";
import {
  deriveBloomParameters,
  type BloomParameters,
} from "@/features/auth/username-bloom/bloom-parameters";
import { LocalBloomFilter } from "@/features/auth/username-bloom/local-bloom-filter";
import {
  buildUsernameBloomKeys,
  type UsernameBloomEvent,
  type UsernameBloomKeys,
} from "@/features/auth/username-bloom/username-bloom-keys";
import type {
  UsernameBloomStore,
  UsernameBloomSubscription,
} from "@/features/auth/username-bloom/username-bloom.store";

export type UsernameBloomVerdict =
  | "definitely-absent"
  | "possibly-present"
  | "unknown";

export interface UsernameBloomConfig {
  /** Kill switch. Disabled filters return `unknown`, restoring database reads. */
  enabled: boolean;
  /** Expected usernames; changing it selects a new Redis key namespace. */
  capacity: number;
  /** Performance target only: false positives fall through to the database. */
  falsePositiveRate: number;
  /** Repairs pub/sub events missed while an instance was disconnected. */
  reloadIntervalMs: number;
  /** Stale copies return `unknown`; this must exceed `reloadIntervalMs`. */
  maxStalenessMs: number;
}

export class UsernameBloomService {
  private readonly parameters: BloomParameters;
  private readonly keys: UsernameBloomKeys;
  private readonly filter: LocalBloomFilter;

  private loaded = false;
  private lastLoadedAt = 0;
  private generation: number | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private subscription: UsernameBloomSubscription | null = null;
  private initialization: Promise<void> | null = null;
  private disposed = false;

  /**
   * Names whose Redis write is still in flight. A reload adopts a bitmap that
   * was read before those writes landed, so it puts them back afterwards —
   * otherwise a reload could erase a bit it raced with and hand back a false
   * negative. Entries are dropped as soon as the write settles, which is what
   * lets a later rebuild shed a name the database no longer holds.
   */
  private readonly pendingAdds = new Set<string>();

  constructor(
    private readonly store: UsernameBloomStore,
    private readonly config: UsernameBloomConfig,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {
    this.parameters = deriveBloomParameters(
      config.capacity,
      config.falsePositiveRate,
    );
    this.keys = buildUsernameBloomKeys(this.parameters.fingerprint);
    this.filter = new LocalBloomFilter(this.parameters);
  }

  getParameters(): BloomParameters {
    return this.parameters;
  }

  isReady(): boolean {
    return this.loaded;
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info(
        "Username bloom filter is disabled; availability checks will query the database.",
      );
      return;
    }

    this.initialization ??= this.runInitialization();

    return this.initialization;
  }

  private async runInitialization(): Promise<void> {
    await this.subscribeToEvents();
    await this.reload();
    this.startReloadTimer();

    this.logger.info("Username bloom filter initialized.", {
      ready: this.loaded,
      bitCount: this.parameters.bitCount,
      hashCount: this.parameters.hashCount,
      fingerprint: this.parameters.fingerprint,
    });
  }

  /**
   * Pure local read — no I/O, no await. Returning `unknown` is always safe:
   * it just means the caller does what it did before this filter existed.
   */
  check(username: string): UsernameBloomVerdict {
    if (!this.config.enabled || !this.loaded) {
      return "unknown";
    }

    if (this.now() - this.lastLoadedAt > this.config.maxStalenessMs) {
      return "unknown";
    }

    const normalized = normalizeUsernameForBloom(username);

    if (!normalized) {
      return "unknown";
    }

    return this.filter.has(normalized)
      ? "possibly-present"
      : "definitely-absent";
  }

  /**
   * Records that a username is now claimed.
   *
   * Never throws: a Redis problem must not fail a signup. A dropped write costs
   * accuracy, not correctness, because the local bit is already set and the next
   * rebuild reconstructs the filter from the database anyway.
   *
   * The write order matters. Pushing onto a rebuild's replay list *before*
   * setting the live bit is what makes the hand-off airtight: if the push
   * arrives too late for the rebuild to replay it, then the live write is later
   * still, which puts it after the swap and onto the new bitmap.
   */
  async add(usernames: string | string[]): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const names = (Array.isArray(usernames) ? usernames : [usernames])
      .map(normalizeUsernameForBloom)
      .filter((name) => name.length > 0);

    if (names.length === 0) {
      return;
    }

    const indices: number[] = [];

    for (const name of names) {
      indices.push(...this.filter.add(name));
      this.pendingAdds.add(name);
    }

    try {
      await this.recordAgainstActiveRebuild(names);
      await this.store.setBits(this.keys.bits, indices);
      await this.store.publish(this.keys.channel, {
        type: "add",
        usernames: names,
      });
    } catch (error) {
      this.logger.warn(
        "Failed to publish username bloom additions; the next rebuild will recover them.",
        { usernameCount: names.length },
        error,
      );
    } finally {
      // Cleared on failure too. The local bit stays set either way, and a write
      // that never reached Redis is recovered by the next rebuild reading the
      // database — holding the name here forever would only leak memory.
      for (const name of names) {
        this.pendingAdds.delete(name);
      }
    }
  }

  private async recordAgainstActiveRebuild(names: string[]): Promise<void> {
    const pointer = await this.store.readKey(this.keys.shadowPointer);

    if (pointer === null) {
      return;
    }

    const generation = Number(pointer);

    if (!Number.isInteger(generation)) {
      return;
    }

    await this.store.pushReplayEntries(this.keys.replayList(generation), names);
  }

  private async subscribeToEvents(): Promise<void> {
    try {
      this.subscription = await this.store.subscribe(
        this.keys.channel,
        (event) => {
          this.applyEvent(event);
        },
        (error) => {
          this.logger.warn(
            "Username bloom subscription error; the periodic reload will recover.",
            undefined,
            error,
          );
        },
      );
    } catch (error) {
      // Losing the subscription only costs propagation latency, which the
      // reload timer bounds. Refusing to start would be worse.
      this.logger.warn(
        "Could not subscribe to username bloom events; relying on periodic reloads.",
        undefined,
        error,
      );
    }
  }

  private applyEvent(event: UsernameBloomEvent): void {
    if (event.type === "add") {
      for (const name of event.usernames) {
        const normalized = normalizeUsernameForBloom(name);

        if (normalized) {
          this.filter.add(normalized);
        }
      }

      return;
    }

    if (event.generation !== this.generation) {
      // A rebuild swapped the bitmap. Adopting it promptly is what sheds the
      // stale bits left by renames and expired reservations.
      void this.reload().catch((error: unknown) => {
        this.logger.warn(
          "Failed to reload the username bloom filter after a rebuild.",
          { generation: event.generation },
          error,
        );
      });
    }
  }

  private startReloadTimer(): void {
    if (this.reloadTimer || this.disposed) {
      return;
    }

    this.reloadTimer = setInterval(() => {
      void this.reload().catch((error: unknown) => {
        this.logger.warn(
          "Scheduled username bloom reload failed.",
          undefined,
          error,
        );
      });
    }, this.config.reloadIntervalMs);

    // Never hold the process open for a cache refresh.
    this.reloadTimer.unref?.();
  }

  /**
   * Pulls the authoritative bitmap from Redis.
   *
   * Metadata is read first on purpose. Reading it last would allow a rebuild
   * landing mid-reload to pair a *new* generation number with the *old* bitmap,
   * leaving the instance convinced it was current. In the order used here the
   * mismatch resolves the harmless way — one redundant reload on the next tick.
   */
  async reload(): Promise<void> {
    const meta = await this.store.readMeta(this.keys.meta);
    const bitmap = meta ? await this.store.readBitmap(this.keys.bits) : null;

    if (!meta || !bitmap) {
      // No completed build yet — or the bitmap was removed underneath us. Stay
      // unready so every check falls through to the database.
      this.loaded = false;
      this.generation = meta?.generation ?? null;
      return;
    }

    const generationChanged = meta.generation !== this.generation;

    try {
      if (generationChanged || !this.loaded) {
        this.filter.replaceFrom(bitmap);
      } else {
        // Same generation: merge rather than replace, so bits set locally since
        // the read began survive.
        this.filter.mergeFrom(bitmap);
      }

      // Re-apply anything whose Redis write has not been acknowledged yet. Those
      // names cannot be in the bitmap that was just read, so adopting it would
      // erase them and hand back a false negative. This runs synchronously with
      // the adoption above, so no other task can slip a write in between.
      //
      // Scoping this to *unacknowledged* writes rather than "everything added
      // recently" is what lets a rebuild shed a name: once the write lands, the
      // database is the only thing still vouching for it.
      for (const name of this.pendingAdds) {
        this.filter.add(name);
      }
    } catch (error) {
      // Size mismatch means the stored bitmap does not match these parameters.
      // Reading it would risk false negatives, so stay unready.
      this.loaded = false;
      this.logger.error(
        "Stored username bloom bitmap does not match the configured parameters.",
        { fingerprint: this.parameters.fingerprint },
        error,
      );
      return;
    }

    this.generation = meta.generation;
    this.lastLoadedAt = this.now();
    this.loaded = true;
  }

  async dispose(): Promise<void> {
    this.disposed = true;

    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }

    if (this.subscription) {
      await this.subscription.close();
      this.subscription = null;
    }
  }
}
