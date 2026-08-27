import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  DueSavedSearch,
  SavedSearchesPagination,
  SavedSearchNotifyFrequency,
  SavedSearchQueryParams,
} from "@/features/postings/saved-searches/saved-searches.model";

/** Row shape shared by every read that feeds `toSavedSearchRecord`. */
const savedSearchSelect = {
  id: true,
  userId: true,
  name: true,
  queryParams: true,
  queryHash: true,
  notifyFrequency: true,
  nextCheckAt: true,
  lastCheckedAt: true,
  lastNotifiedAt: true,
  newMatchCount: true,
  invalidatedAt: true,
  createdAt: true,
} as const;

export type SavedSearchRow = Prisma.SavedSearchGetPayload<{
  select: typeof savedSearchSelect;
}>;

export interface CreateSavedSearchRow {
  userId: string;
  name: string;
  queryParams: SavedSearchQueryParams;
  queryHash: string;
  notifyFrequency: SavedSearchNotifyFrequency;
  nextCheckAt: Date | null;
}

export interface ListSavedSearchRowsResult {
  rows: SavedSearchRow[];
  pagination: SavedSearchesPagination;
}

export class SavedSearchesRepository extends BaseRepository {
  async create(input: CreateSavedSearchRow): Promise<SavedSearchRow> {
    return this.executeAsync(() =>
      this.prisma.savedSearch.create({
        data: {
          id: randomUUID(),
          userId: input.userId,
          name: input.name,
          queryParams: input.queryParams as Prisma.InputJsonValue,
          queryHash: input.queryHash,
          notifyFrequency: input.notifyFrequency,
          nextCheckAt: input.nextCheckAt,
        },
        select: savedSearchSelect,
      }),
    );
  }

  async findById(id: string): Promise<SavedSearchRow | null> {
    return this.executeAsync(() =>
      this.prisma.savedSearch.findUnique({
        where: { id },
        select: savedSearchSelect,
      }),
    );
  }

  async findByHash(
    userId: string,
    queryHash: string,
  ): Promise<SavedSearchRow | null> {
    return this.executeAsync(() =>
      this.prisma.savedSearch.findUnique({
        where: {
          userId_queryHash: {
            userId,
            queryHash,
          },
        },
        select: savedSearchSelect,
      }),
    );
  }

  async countForUser(userId: string): Promise<number> {
    return this.executeAsync(() =>
      this.prisma.savedSearch.count({ where: { userId } }),
    );
  }

  async listPage(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<ListSavedSearchRowsResult> {
    const skip = (page - 1) * pageSize;

    const [rows, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.savedSearch.findMany({
          where: { userId },
          skip,
          take: pageSize,
          // The secondary sort keeps page boundaries stable: two searches saved
          // within the same DATETIME(6) tick would otherwise order arbitrarily.
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          select: savedSearchSelect,
        }),
        this.prisma.savedSearch.count({ where: { userId } }),
      ]),
    );

    return {
      rows,
      pagination: this.createPagination(page, pageSize, total),
    };
  }

  /**
   * Scoped by `userId` rather than checking ownership in the service, so a
   * mismatched owner updates zero rows instead of someone else's search.
   */
  async update(
    id: string,
    userId: string,
    patch: {
      name?: string;
      notifyFrequency?: SavedSearchNotifyFrequency;
      nextCheckAt?: Date | null;
    },
  ): Promise<SavedSearchRow | null> {
    const updated = await this.executeAsync(() =>
      this.prisma.savedSearch.updateMany({
        where: { id, userId },
        data: patch,
      }),
    );

    if (updated.count === 0) {
      return null;
    }

    return this.findById(id);
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.savedSearch.deleteMany({ where: { id, userId } }),
    );

    return result.count > 0;
  }

  async resetNewMatchCount(id: string, userId: string): Promise<boolean> {
    const result = await this.executeAsync(() =>
      this.prisma.savedSearch.updateMany({
        where: { id, userId },
        data: { newMatchCount: 0 },
      }),
    );

    return result.count > 0;
  }

  /**
   * Atomically takes ownership of the searches that are due.
   *
   * Reading then updating would let two worker replicas claim the same search
   * and send the visitor the same alert twice, so the claim moves
   * `next_check_at` forward in the same statement that selects on it: the
   * `nextCheckAt <= claimedAt` predicate fails for whoever loses the race.
   * `updatedAt` is pinned to its current value because a claim is bookkeeping,
   * not an edit the visitor made.
   */
  async claimDueSearches(
    claimedAt: Date,
    nextCheckAt: Date,
    batchSize: number,
  ): Promise<DueSavedSearch[]> {
    return this.executeAsync(async () => {
      const candidates = await this.prisma.savedSearch.findMany({
        where: {
          notifyFrequency: { not: "off" },
          nextCheckAt: { lte: claimedAt },
          invalidatedAt: null,
        },
        take: batchSize,
        orderBy: [{ nextCheckAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          name: true,
          queryParams: true,
          notifyFrequency: true,
        },
      });

      if (candidates.length === 0) {
        return [];
      }

      const claimed: DueSavedSearch[] = [];

      for (const candidate of candidates) {
        const result = await this.prisma.savedSearch.updateMany({
          where: {
            id: candidate.id,
            nextCheckAt: { lte: claimedAt },
          },
          data: {
            nextCheckAt,
            lastCheckedAt: claimedAt,
          },
        });

        if (result.count > 0) {
          claimed.push(candidate);
        }
      }

      return claimed;
    });
  }

  /** Marks a search as no longer executable, which also takes it off the sweep. */
  async markInvalidated(id: string, invalidatedAt: Date): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.savedSearch.updateMany({
        where: { id },
        data: {
          invalidatedAt,
          nextCheckAt: null,
        },
      }),
    );
  }

  async recordAlert(
    id: string,
    notifiedAt: Date,
    newMatchCount: number,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.savedSearch.update({
        where: { id },
        data: {
          lastNotifiedAt: notifiedAt,
          newMatchCount: { increment: newMatchCount },
        },
      }),
    );
  }

  /**
   * Returns the subset of `postingIds` this search has never alerted on,
   * preserving the caller's order so the newest match still leads the email.
   */
  async filterUnseenPostingIds(
    savedSearchId: string,
    postingIds: string[],
  ): Promise<string[]> {
    if (postingIds.length === 0) {
      return [];
    }

    const seen = await this.executeAsync(() =>
      this.prisma.savedSearchSeenPosting.findMany({
        where: {
          savedSearchId,
          postingId: { in: postingIds },
        },
        select: { postingId: true },
      }),
    );

    const seenIds = new Set(seen.map((row) => row.postingId));

    return postingIds.filter((postingId) => !seenIds.has(postingId));
  }

  /**
   * `skipDuplicates` rather than an upsert loop: a concurrent sweep may have
   * recorded the same match already, and the original timestamp is the one
   * worth keeping for pruning.
   */
  async recordSeenPostings(
    savedSearchId: string,
    postingIds: string[],
  ): Promise<number> {
    if (postingIds.length === 0) {
      return 0;
    }

    const result = await this.executeAsync(() =>
      this.prisma.savedSearchSeenPosting.createMany({
        data: postingIds.map((postingId) => ({
          id: randomUUID(),
          savedSearchId,
          postingId,
        })),
        skipDuplicates: true,
      }),
    );

    return result.count;
  }

  /** Drops the oldest seen rows once a search is over the retention cap. */
  async pruneSeenPostings(savedSearchId: string, cap: number): Promise<number> {
    const total = await this.executeAsync(() =>
      this.prisma.savedSearchSeenPosting.count({ where: { savedSearchId } }),
    );

    if (total <= cap) {
      return 0;
    }

    const excess = await this.executeAsync(() =>
      this.prisma.savedSearchSeenPosting.findMany({
        where: { savedSearchId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: total - cap,
        select: { id: true },
      }),
    );

    const result = await this.executeAsync(() =>
      this.prisma.savedSearchSeenPosting.deleteMany({
        where: { id: { in: excess.map((row) => row.id) } },
      }),
    );

    return result.count;
  }

  private createPagination(
    page: number,
    pageSize: number,
    total: number,
  ): SavedSearchesPagination {
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
