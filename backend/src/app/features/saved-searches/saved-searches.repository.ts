import { randomUUID } from "node:crypto";
import type { SavedSearch } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  SavedSearchParams,
  SavedSearchRecord,
} from "@/features/saved-searches/saved-searches.model";

interface CreateSavedSearchData {
  name: string;
  searchParams: SavedSearchParams;
  alertEnabled: boolean;
}

interface UpdateSavedSearchData {
  name?: string;
  searchParams?: SavedSearchParams;
  alertEnabled?: boolean;
}

export interface PostingAlertCandidate {
  id: string;
  name: string;
  city: string;
  family: string;
  subtype: string;
  tags: unknown;
  pricing: unknown;
  publishedAt: Date | null;
}

export interface SavedSearchWithUser {
  id: string;
  userId: string;
  name: string;
  searchParams: unknown;
  alertEnabled: boolean;
  lastAlertSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    email: string;
    firstName: string | null;
  };
}

export class SavedSearchesRepository extends BaseRepository {
  async create(
    userId: string,
    data: CreateSavedSearchData,
  ): Promise<SavedSearchRecord> {
    const created = await this.executeAsync(() =>
      this.prisma.savedSearch.create({
        data: {
          id: randomUUID(),
          userId,
          name: data.name,
          searchParams: data.searchParams,
          alertEnabled: data.alertEnabled,
        },
      }),
    );

    return this.mapSavedSearch(created);
  }

  async findByUser(userId: string): Promise<SavedSearchRecord[]> {
    const rows = await this.executeAsync(() =>
      this.prisma.savedSearch.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),
    );

    return rows.map((r) => this.mapSavedSearch(r));
  }

  async findById(id: string): Promise<SavedSearchRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.savedSearch.findUnique({ where: { id } }),
    );

    return row ? this.mapSavedSearch(row) : null;
  }

  async update(
    id: string,
    data: UpdateSavedSearchData,
  ): Promise<SavedSearchRecord> {
    const updated = await this.executeAsync(() =>
      this.prisma.savedSearch.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.searchParams !== undefined && {
            searchParams: data.searchParams,
          }),
          ...(data.alertEnabled !== undefined && {
            alertEnabled: data.alertEnabled,
          }),
        },
      }),
    );

    return this.mapSavedSearch(updated);
  }

  async delete(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.savedSearch.delete({ where: { id } }),
    );
  }

  async countByUser(userId: string): Promise<number> {
    return this.executeAsync(() =>
      this.prisma.savedSearch.count({ where: { userId } }),
    );
  }

  async findAlertBatch(
    afterId: string | null,
    limit: number,
  ): Promise<SavedSearchWithUser[]> {
    return this.executeAsync(() =>
      this.prisma.savedSearch.findMany({
        where: {
          alertEnabled: true,
          ...(afterId !== null && { id: { gt: afterId } }),
        },
        take: limit,
        orderBy: { id: "asc" },
        include: {
          user: {
            select: { email: true, firstName: true },
          },
        },
      }),
    ) as Promise<SavedSearchWithUser[]>;
  }

  async markAlertSent(id: string, sentAt: Date): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.savedSearch.update({
        where: { id },
        data: { lastAlertSentAt: sentAt },
      }),
    );
  }

  async findNewMatchingPostings(
    params: SavedSearchParams,
    publishedSince: Date,
    limit: number,
  ): Promise<PostingAlertCandidate[]> {
    return this.executeAsync(() =>
      this.prisma.posting.findMany({
        where: {
          status: "published",
          publishedAt: { gt: publishedSince },
          ...(params.family && { family: params.family }),
          ...(params.subtype && { subtype: params.subtype }),
          ...(params.city && {
            city: { equals: params.city, mode: "insensitive" },
          }),
          ...(params.availabilityStatus && {
            availabilityStatus: params.availabilityStatus,
          }),
          ...(params.instantBooking !== undefined && {
            instantBooking: params.instantBooking,
          }),
          ...(params.cancellationPolicy && {
            cancellationPolicy: params.cancellationPolicy,
          }),
        },
        take: limit,
        orderBy: { publishedAt: "desc" },
        select: {
          id: true,
          name: true,
          city: true,
          family: true,
          subtype: true,
          tags: true,
          pricing: true,
          publishedAt: true,
        },
      }),
    ) as Promise<PostingAlertCandidate[]>;
  }

  private mapSavedSearch(row: SavedSearch): SavedSearchRecord {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      searchParams: row.searchParams as SavedSearchParams,
      alertEnabled: row.alertEnabled,
      lastAlertSentAt: row.lastAlertSentAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
