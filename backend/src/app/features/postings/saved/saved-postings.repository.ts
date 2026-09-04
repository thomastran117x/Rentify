import { BaseRepository } from "@/features/base/base.repository";
import type {
  ListSavedPostingEntriesResult,
  SavedPostingsPagination,
} from "@/features/postings/saved/saved-postings.model";
import { asUuid, newUuid, type Uuid } from "@/configuration/validation/uuid";

export class SavedPostingsRepository extends BaseRepository {
  /**
   * Idempotent by way of the (user_id, posting_id) unique index. The no-op
   * update preserves the original `createdAt` so re-saving does not reorder
   * the wishlist.
   */
  async save(userId: Uuid, postingId: Uuid): Promise<{ createdAt: Date }> {
    return this.executeAsync(() =>
      this.prisma.savedPosting.upsert({
        where: {
          userId_postingId: {
            userId,
            postingId,
          },
        },
        create: {
          id: newUuid(),
          userId,
          postingId,
        },
        update: {},
        select: {
          createdAt: true,
        },
      }),
    );
  }

  /** Returns true when a row was actually removed. */
  async unsave(userId: Uuid, postingId: Uuid): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.savedPosting.deleteMany({
        where: {
          userId,
          postingId,
        },
      }),
    );

    return result.count > 0;
  }

  async findSavedAt(userId: Uuid, postingId: Uuid): Promise<Date | null> {
    const row = await this.executeAsync(() =>
      this.prisma.savedPosting.findUnique({
        where: {
          userId_postingId: {
            userId,
            postingId,
          },
        },
        select: {
          createdAt: true,
        },
      }),
    );

    return row?.createdAt ?? null;
  }

  async listPage(
    userId: Uuid,
    page: number,
    pageSize: number,
  ): Promise<ListSavedPostingEntriesResult> {
    const skip = (page - 1) * pageSize;

    const [entries, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.savedPosting.findMany({
          where: {
            userId,
          },
          skip,
          take: pageSize,
          // The secondary sort keeps page boundaries stable: two saves within
          // the same DATETIME(6) tick would otherwise order arbitrarily.
          orderBy: [
            {
              createdAt: "desc",
            },
            {
              postingId: "asc",
            },
          ],
          select: {
            postingId: true,
            createdAt: true,
          },
        }),
        this.prisma.savedPosting.count({
          where: {
            userId,
          },
        }),
      ]),
    );

    return {
      entries: entries.map((entry) => ({
        ...entry,
        postingId: asUuid(entry.postingId),
      })),
      pagination: this.createPagination(page, pageSize, total),
    };
  }

  async listIds(userId: Uuid, limit: number): Promise<Uuid[]> {
    const rows = await this.executeAsync(() =>
      this.prisma.savedPosting.findMany({
        where: {
          userId,
        },
        take: limit,
        orderBy: [
          {
            createdAt: "desc",
          },
          {
            postingId: "asc",
          },
        ],
        select: {
          postingId: true,
        },
      }),
    );

    return rows.map((row) => asUuid(row.postingId));
  }

  private createPagination(
    page: number,
    pageSize: number,
    total: number,
  ): SavedPostingsPagination {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }
}
