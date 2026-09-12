import { isPostingPubliclyVisible } from "@/features/postings/postings.model";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { CacheService } from "@/features/cache/cache.service";
import type { ProfileRepository } from "@/features/profile/profile.repository";
import type { RecentlyViewedPostingsRepository } from "@/features/postings/recently-viewed/recently-viewed.repository";
import {
  RECENTLY_VIEWED_CAP,
  RECENTLY_VIEWED_MAX_AGE_MS,
  type ListRecentlyViewedPostingsResult,
  type RecentlyViewedEntry,
  type SyncRecentlyViewedRequest,
} from "@/features/postings/recently-viewed/recently-viewed.model";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";

/**
 * How long a cached tracking-enabled read may survive a toggle. Unlike the
 * list itself (deliberately uncached -- see below), this flag is read on
 * every single view and sync but is written only when someone visits their
 * privacy settings, which is exactly the read-heavy/write-rare shape
 * SavedPostingsService caches its id set for. A minute of staleness after a
 * toggle is a reasonable trade for skipping a profile lookup on every view.
 */
const TRACKING_ENABLED_CACHE_TTL_SECONDS = 60;

function trackingEnabledCacheKey(userId: Uuid): string {
  return `profile:recently-viewed-tracking:${userId}`;
}

/**
 * Browsing history for a signed-in visitor.
 *
 * The list itself is deliberately uncached, unlike its sibling
 * SavedPostingsService. That one caches its identifier set for 60 seconds
 * because the set is read on nearly every authenticated marketplace page and
 * written rarely. This is the inverse: it is written on essentially every
 * posting view, so a cache entry would be stale more often than fresh and
 * every write would immediately invalidate it. The tracking-enabled flag
 * below does not share that problem -- see `isTrackingEnabled`.
 */
export class RecentlyViewedPostingsService {
  constructor(
    private readonly recentlyViewedPostingsRepository: RecentlyViewedPostingsRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
    private readonly profileRepository: ProfileRepository,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Records one view. Signed-out visitors keep their history in the browser
   * alone, so there is nothing to write and nothing to report -- the caller
   * still gets an accepted response either way, because whether a row was
   * written is not the client's business and saying so would leak whether a
   * posting exists.
   */
  async recordView(
    postingId: Uuid,
    userId: Uuid | undefined,
    options: { isBot: boolean },
  ): Promise<void> {
    if (!userId || options.isBot) {
      return;
    }

    if (!(await this.isTrackingEnabled(userId))) {
      return;
    }

    if (!(await this.isPubliclyVisible(postingId))) {
      return;
    }

    const outcome = await this.recentlyViewedPostingsRepository.recordView(
      userId,
      postingId,
      new Date(),
    );

    // Only an insert can push the account over the cap, so the count query
    // stays off the hot path for the common case of re-viewing something.
    if (outcome === "created") {
      await this.recentlyViewedPostingsRepository.prune(
        userId,
        RECENTLY_VIEWED_CAP,
      );
    }
  }

  /**
   * Merges the browser's mirror into the account's history.
   *
   * Entries whose posting is no longer publicly visible are dropped here rather
   * than written and filtered out on read, so a mirror cannot reintroduce rows
   * for postings that were archived while the tab was closed.
   */
  async sync(
    userId: Uuid,
    request: SyncRecentlyViewedRequest,
    limit: number,
  ): Promise<ListRecentlyViewedPostingsResult> {
    if (!(await this.isTrackingEnabled(userId))) {
      return this.list(userId, limit);
    }

    const entries = await this.resolveSyncEntries(request);

    if (entries.length > 0) {
      await this.recentlyViewedPostingsRepository.syncMany(userId, entries);
      await this.recentlyViewedPostingsRepository.prune(
        userId,
        RECENTLY_VIEWED_CAP,
      );
    }

    return this.list(userId, limit);
  }

  async list(
    userId: Uuid,
    limit: number,
  ): Promise<ListRecentlyViewedPostingsResult> {
    const [entries, trackingEnabled] = await Promise.all([
      this.recentlyViewedPostingsRepository.listRecent(userId, limit),
      this.isTrackingEnabled(userId),
    ]);

    if (entries.length === 0) {
      return { postings: [], trackingEnabled };
    }

    const viewedAtByPostingId = new Map(
      entries.map((entry) => [entry.postingId, entry.viewedAt.toISOString()]),
    );
    // `getPublicByIds` preserves the requested order, so newest-viewed-first
    // survives hydration.
    const batch = await this.postingsPublicCacheService.getPublicByIds(
      entries.map((entry) => entry.postingId),
    );

    // Unlike saved postings, entries whose posting has gone are dropped rather
    // than described. A bookmark the visitor deliberately kept deserves a
    // tombstone explaining where it went; a listing they merely glanced at does
    // not, and a row of "no longer available" tiles is worse than a shorter row.
    return {
      postings: batch.postings.map((posting) => ({
        ...posting,
        viewedAt:
          viewedAtByPostingId.get(posting.id) ?? new Date(0).toISOString(),
      })),
      trackingEnabled,
    };
  }

  async clear(userId: Uuid): Promise<void> {
    await this.recentlyViewedPostingsRepository.deleteAll(userId);
  }

  /**
   * Deliberately skips the public-visibility gate that `recordView` applies. A
   * posting can be archived after it was viewed, and the visitor must still be
   * able to clear it out of their own history.
   */
  async remove(userId: Uuid, postingId: Uuid): Promise<void> {
    await this.recentlyViewedPostingsRepository.deleteOne(userId, postingId);
  }

  /**
   * Deduplicates a batch, keeping the latest claim per posting, and drops
   * anything that is not publicly visible.
   */
  private async resolveSyncEntries(
    request: SyncRecentlyViewedRequest,
  ): Promise<RecentlyViewedEntry[]> {
    const now = new Date();
    const latestByPostingId = new Map<Uuid, Date>();

    for (const entry of request.entries) {
      const viewedAt = this.clampViewedAt(entry.viewedAt, now);
      const existing = latestByPostingId.get(entry.postingId);

      if (!existing || viewedAt > existing) {
        latestByPostingId.set(entry.postingId, viewedAt);
      }
    }

    const postingIds = Array.from(latestByPostingId.keys());
    const batch =
      await this.postingsPublicCacheService.getPublicByIds(postingIds);

    return batch.postings.map((posting) => ({
      postingId: asUuid(posting.id),
      viewedAt: latestByPostingId.get(asUuid(posting.id)) ?? now,
    }));
  }

  /**
   * Client clocks are untrusted, so a claimed timestamp is clamped into a sane
   * window rather than rejected. A skewed laptop is far more likely than a
   * forgery, and a forgery buys nothing: the best it can claim is "I viewed
   * this a moment ago", which the view endpoint would grant honestly anyway.
   */
  private clampViewedAt(raw: string, now: Date): Date {
    const parsed = new Date(raw);

    if (parsed.getTime() > now.getTime()) {
      return now;
    }

    const floor = now.getTime() - RECENTLY_VIEWED_MAX_AGE_MS;

    if (parsed.getTime() < floor) {
      return new Date(floor);
    }

    return parsed;
  }

  /**
   * Read-through cache over the profile flag. It changes only when someone
   * visits their privacy settings, so a minute of staleness after a toggle is
   * a reasonable trade for skipping a profile lookup on the hot path -- every
   * view, list, and sync call reaches this. Cache faults are never fatal: a
   * miss or a Redis outage just means the flag is read from the database,
   * which is the behaviour without a cache.
   */
  private async isTrackingEnabled(userId: Uuid): Promise<boolean> {
    const cacheKey = trackingEnabledCacheKey(userId);

    try {
      const cached = await this.cacheService.getJson<boolean>(cacheKey);

      if (cached !== null) {
        return cached;
      }
    } catch {
      // Fall through to the database.
    }

    const enabled =
      await this.profileRepository.findRecentlyViewedTrackingEnabledByUserId(
        userId,
      );

    try {
      await this.cacheService.setJson(
        cacheKey,
        enabled,
        TRACKING_ENABLED_CACHE_TTL_SECONDS,
      );
    } catch {
      // Losing the write only costs a database read next time.
    }

    return enabled;
  }

  private async isPubliclyVisible(postingId: Uuid): Promise<boolean> {
    // The metadata lookup is a four-column select; `findById` would join
    // photos, availability blocks and the organization just to read a status.
    const metadata =
      await this.postingsRepository.findPublicReadMetadataById(postingId);

    return Boolean(metadata && isPostingPubliclyVisible(metadata));
  }
}
