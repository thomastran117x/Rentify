import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type { RecentlyViewedEntry } from "@/features/postings/recently-viewed/recently-viewed.model";
import { asUuid, newUuid, type Uuid } from "@/configuration/validation/uuid";

/**
 * Whether {@link RecentlyViewedPostingsRepository.recordView} inserted a row.
 * Only an insert can push an account over the retention cap, so the caller
 * prunes on `created` and skips the count query entirely on `updated`.
 */
export type RecordViewOutcome = "created" | "updated";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export class RecentlyViewedPostingsRepository extends BaseRepository {
  /**
   * Deliberately not a single `upsert`. This runs on every posting view, and
   * the overwhelmingly common case is a re-view of something already in the
   * list -- which an update-first shape settles in one statement, with no
   * insert attempt to roll back and no prune to follow.
   */
  async recordView(
    userId: Uuid,
    postingId: Uuid,
    viewedAt: Date,
  ): Promise<RecordViewOutcome> {
    const updated = await this.touch(userId, postingId, viewedAt);

    if (updated) {
      return "updated";
    }

    try {
      await this.executeAsync(() =>
        this.prisma.recentlyViewedPosting.create({
          data: {
            id: newUuid(),
            userId,
            postingId,
            viewedAt,
            createdAt: viewedAt,
          },
          select: { id: true },
        }),
      );

      return "created";
    } catch (error) {
      // Two first views of the same posting can race between the update above
      // and this insert. The unique index settles it; the loser just applies
      // the update it originally missed.
      if (this.isUniqueConstraintViolation(error)) {
        await this.touch(userId, postingId, viewedAt);
        return "updated";
      }

      throw error;
    }
  }

  /**
   * Merges a browser mirror into the account's history in one statement.
   *
   * `GREATEST` is the whole point and is why this is raw SQL: Prisma cannot
   * express "keep whichever timestamp is later" in an upsert, and a mirror that
   * has been sitting in a closed tab must never demote a row that another
   * device refreshed more recently.
   */
  async syncMany(userId: Uuid, entries: RecentlyViewedEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const values = entries.map(
      (entry) =>
        Prisma.sql`(${newUuid()}, ${userId}, ${entry.postingId}, ${entry.viewedAt}, ${entry.viewedAt})`,
    );

    await this.executeAsync(() =>
      this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO recently_viewed_postings (id, user_id, posting_id, viewed_at, created_at)
        VALUES ${Prisma.join(values, ", ")}
        ON DUPLICATE KEY UPDATE
          viewed_at = GREATEST(recently_viewed_postings.viewed_at, VALUES(viewed_at))
      `),
    );
  }

  async listRecent(
    userId: Uuid,
    limit: number,
  ): Promise<RecentlyViewedEntry[]> {
    const rows = await this.executeAsync(() =>
      this.prisma.recentlyViewedPosting.findMany({
        where: { userId },
        take: limit,
        // The secondary sort keeps ordering stable: two views inside the same
        // DATETIME(6) tick would otherwise come back in an arbitrary order.
        orderBy: [{ viewedAt: "desc" }, { postingId: "asc" }],
        select: { postingId: true, viewedAt: true },
      }),
    );

    return rows.map((row) => ({
      postingId: asUuid(row.postingId),
      viewedAt: row.viewedAt,
    }));
  }

  /** Drops the oldest rows once an account is over the retention cap. */
  async prune(userId: Uuid, cap: number): Promise<number> {
    const total = await this.executeAsync(() =>
      this.prisma.recentlyViewedPosting.count({ where: { userId } }),
    );

    if (total <= cap) {
      return 0;
    }

    const stale = await this.executeAsync(() =>
      this.prisma.recentlyViewedPosting.findMany({
        where: { userId },
        take: total - cap,
        orderBy: [{ viewedAt: "asc" }, { id: "asc" }],
        select: { id: true },
      }),
    );

    if (stale.length === 0) {
      return 0;
    }

    const result = await this.executeAsync(() =>
      this.prisma.recentlyViewedPosting.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      }),
    );

    return result.count;
  }

  async deleteAll(userId: Uuid): Promise<number> {
    const result = await this.executeAsync(() =>
      this.prisma.recentlyViewedPosting.deleteMany({ where: { userId } }),
    );

    return result.count;
  }

  /** Returns true when a row was actually removed. */
  async deleteOne(userId: Uuid, postingId: Uuid): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.recentlyViewedPosting.deleteMany({
        where: { userId, postingId },
      }),
    );

    return result.count > 0;
  }

  private async touch(
    userId: Uuid,
    postingId: Uuid,
    viewedAt: Date,
  ): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.recentlyViewedPosting.updateMany({
        where: { userId, postingId },
        data: { viewedAt },
      }),
    );

    return result.count > 0;
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_CONSTRAINT_VIOLATION
    );
  }
}
