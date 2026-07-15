import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import {
  DEFAULT_MAX_BOOKING_DURATION_DAYS,
  isPostingSearchIndexable,
  parsePostingDetailsForVariant,
  toPublicPostingRecord,
  toPostingAttributes,
} from "@/features/postings/postings.model";
import type {
  PostingAutocompleteInput,
  BatchPublicPostingsInput,
  BatchPostingsResult,
  BatchOwnerPostingsInput,
  ListOwnerPostingsInput,
  ListOwnerPostingsResult,
  ManagedPostingPhotoInput,
  OwnerPostingsStatusSummary,
  PublicPostingRecord,
  PostingAttributeValue,
  PostingAvailabilityBlockInput,
  PostingAvailabilityBlockRecord,
  PostingAvailabilityStatus,
  PostingDetails,
  PostingCancellationPolicy,
  PostingPhotoRecord,
  PostingPricing,
  PostingRecord,
  PostingSearchDocument,
  PostingSearchOutboxRecord,
  PostingVariant,
  PostingSort,
  PostingStatus,
  PostingSubtype,
  SearchPostingsInput,
  UpsertPostingInput,
} from "@/features/postings/postings.model";
import type {
  SearchOutboxLagMetrics,
  SearchReindexRunRecord,
  SearchReindexStatus,
} from "@/features/search/search.model";
import { getPostingSearchableAttributeDefinitions } from "@/features/postings/postings.variants";

type SearchReindexCatchUpState =
  | {
      state: "waiting";
    }
  | {
      state: "caught_up";
    }
  | {
      state: "failed";
      errorMessage: string;
    };

type PostingPersistence = Prisma.PostingGetPayload<{
  include: {
    organization: true;
    photos: {
      orderBy: {
        position: "asc";
      };
    };
    availabilityBlocks: {
      orderBy: {
        startAt: "asc";
      };
      include: {
        bookingRequestHold: {
          select: {
            id: true;
            status: true;
            holdExpiresAt: true;
            convertedAt: true;
          };
        };
      };
    };
    bookingRequests: {
      select: {
        id: true;
        status: true;
        startAt: true;
        endAt: true;
        holdExpiresAt: true;
        convertedAt: true;
        conversionReservationExpiresAt: true;
      };
    };
    rentings: {
      select: {
        id: true;
        startAt: true;
        endAt: true;
      };
    };
  };
}>;

interface SearchCountRow {
  total: bigint | number;
}

interface SearchIdRow {
  id: string;
}

interface PostingAutocompleteRow {
  id: string;
  name: string;
  tags: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  publishedAt: Date | string | null;
  createdAt: Date | string;
}

interface PendingSearchOutboxMetrics {
  count: number;
  oldestAgeMs?: number;
}

interface SearchOutboxIdRow {
  id: string;
}

interface SearchOutboxLagRow {
  unpublishedCount?: bigint | number | null;
  unpublishedOldestCreatedAt?: Date | null;
  publishedNotIndexedCount?: bigint | number | null;
  publishedNotIndexedOldestProcessedAt?: Date | null;
  upsertDeadLetteredCount?: bigint | number | null;
  deleteDeadLetteredCount?: bigint | number | null;
  barrierDeadLetteredCount?: bigint | number | null;
}

interface LockRow {
  acquired?: bigint | number | boolean | null;
  released?: bigint | number | boolean | null;
}

const SEARCH_REINDEX_START_LOCK_NAME = "rentify:search-reindex:start";
const postingInclude = {
  organization: true,
  photos: {
    orderBy: {
      position: "asc",
    },
  },
  availabilityBlocks: {
    orderBy: {
      startAt: "asc",
    },
    include: {
      bookingRequestHold: {
        select: {
          id: true,
          status: true,
          holdExpiresAt: true,
          convertedAt: true,
        },
      },
    },
  },
  bookingRequests: {
    select: {
      id: true,
      status: true,
      startAt: true,
      endAt: true,
      holdExpiresAt: true,
      convertedAt: true,
      conversionReservationExpiresAt: true,
    },
  },
  rentings: {
    select: {
      id: true,
      startAt: true,
      endAt: true,
    },
  },
} satisfies Prisma.PostingInclude;

export class PostingsRepository extends BaseRepository {
  async create(input: UpsertPostingInput): Promise<PostingRecord> {
    return this.executeAsync(async () => {
      const posting = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.posting.create({
          data: this.toCreateData(input),
          include: postingInclude,
        });

        await this.enqueueOutbox(
          transaction,
          created.id,
          isPostingSearchIndexable(created.status as PostingStatus)
            ? "upsert"
            : "delete",
        );
        return created;
      });

      return this.mapPosting(posting);
    });
  }

  async update(
    id: string,
    input: UpsertPostingInput,
  ): Promise<PostingRecord | null> {
    return this.executeAsync(async () => {
      try {
        const posting = await this.prisma.$transaction(async (transaction) => {
          const existing = await transaction.posting.findUnique({
            where: {
              id,
            },
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          });

          if (!existing) {
            throw new Prisma.PrismaClientKnownRequestError("No Posting found", {
              code: "P2025",
              clientVersion: "unknown",
            });
          }

          const updated = await transaction.posting.update({
            where: {
              id,
            },
            data: this.toUpdateData(
              input,
              this.mergePhotosWithExisting(existing.photos, input.photos),
            ),
            include: postingInclude,
          });

          await this.enqueueOutbox(
            transaction,
            updated.id,
            isPostingSearchIndexable(updated.status as PostingStatus)
              ? "upsert"
              : "delete",
          );
          return updated;
        });

        return this.mapPosting(posting);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return null;
        }

        throw error;
      }
    });
  }

  async listOwnerAvailabilityBlocks(
    postingId: string,
  ): Promise<PostingAvailabilityBlockRecord[]> {
    const blocks = await this.executeAsync(() =>
      this.prisma.postingAvailabilityBlock.findMany({
        where: {
          postingId,
          source: "owner",
        },
        orderBy: {
          startAt: "asc",
        },
      }),
    );

    return blocks.map((block) => this.mapAvailabilityBlock(block));
  }

  async findOwnerAvailabilityBlock(
    postingId: string,
    blockId: string,
  ): Promise<PostingAvailabilityBlockRecord | null> {
    const block = await this.executeAsync(() =>
      this.prisma.postingAvailabilityBlock.findFirst({
        where: {
          id: blockId,
          postingId,
          source: "owner",
        },
      }),
    );

    return block ? this.mapAvailabilityBlock(block) : null;
  }

  async createOwnerAvailabilityBlock(
    postingId: string,
    input: PostingAvailabilityBlockInput,
  ): Promise<PostingAvailabilityBlockRecord> {
    const block = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const created = await transaction.postingAvailabilityBlock.create({
          data: {
            id: randomUUID(),
            postingId,
            startAt: new Date(input.startAt),
            endAt: new Date(input.endAt),
            note: input.note ?? null,
            source: "owner",
          },
        });

        await this.enqueueOutbox(transaction, postingId, "upsert");

        return created;
      }),
    );

    return this.mapAvailabilityBlock(block);
  }

  async updateOwnerAvailabilityBlock(
    postingId: string,
    blockId: string,
    input: PostingAvailabilityBlockInput,
  ): Promise<PostingAvailabilityBlockRecord | null> {
    return this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const result = await transaction.postingAvailabilityBlock.updateMany({
          where: {
            id: blockId,
            postingId,
            source: "owner",
          },
          data: {
            startAt: new Date(input.startAt),
            endAt: new Date(input.endAt),
            note: input.note ?? null,
          },
        });

        if (result.count !== 1) {
          return null;
        }

        const updated =
          await transaction.postingAvailabilityBlock.findUniqueOrThrow({
            where: {
              id: blockId,
            },
          });

        await this.enqueueOutbox(transaction, postingId, "upsert");

        return this.mapAvailabilityBlock(updated);
      }),
    );
  }

  async deleteOwnerAvailabilityBlock(
    postingId: string,
    blockId: string,
  ): Promise<boolean> {
    return this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const result = await transaction.postingAvailabilityBlock.deleteMany({
          where: {
            id: blockId,
            postingId,
            source: "owner",
          },
        });

        if (result.count !== 1) {
          return false;
        }

        await this.enqueueOutbox(transaction, postingId, "upsert");

        return true;
      }),
    );
  }

  async hasOwnerAvailabilityBlockOverlap(input: {
    postingId: string;
    startAt: Date;
    endAt: Date;
    excludeBlockId?: string;
  }): Promise<boolean> {
    const block = await this.executeAsync(() =>
      this.prisma.postingAvailabilityBlock.findFirst({
        where: {
          postingId: input.postingId,
          source: "owner",
          ...(input.excludeBlockId
            ? {
                id: {
                  not: input.excludeBlockId,
                },
              }
            : {}),
          startAt: {
            lt: input.endAt,
          },
          endAt: {
            gt: input.startAt,
          },
        },
        select: {
          id: true,
        },
      }),
    );

    return Boolean(block);
  }

  async hasActiveBookingAvailabilityConflict(input: {
    postingId: string;
    startAt: Date;
    endAt: Date;
  }): Promise<boolean> {
    const now = new Date();
    const bookingRequest = await this.executeAsync(() =>
      this.prisma.bookingRequest.findFirst({
        where: {
          postingId: input.postingId,
          status: {
            in: ["pending", "awaiting_payment", "payment_processing", "paid"],
          },
          convertedAt: null,
          holdExpiresAt: {
            gt: now,
          },
          OR: [
            {
              conversionReservationExpiresAt: null,
            },
            {
              conversionReservationExpiresAt: {
                lte: now,
              },
            },
          ],
          startAt: {
            lt: input.endAt,
          },
          endAt: {
            gt: input.startAt,
          },
        },
        select: {
          id: true,
        },
      }),
    );

    return Boolean(bookingRequest);
  }

  async hasRentingAvailabilityConflict(input: {
    postingId: string;
    startAt: Date;
    endAt: Date;
  }): Promise<boolean> {
    const renting = await this.executeAsync(() =>
      this.prisma.renting.findFirst({
        where: {
          postingId: input.postingId,
          startAt: {
            lt: input.endAt,
          },
          endAt: {
            gt: input.startAt,
          },
        },
        select: {
          id: true,
        },
      }),
    );

    return Boolean(renting);
  }

  async publish(id: string): Promise<PostingRecord | null> {
    return this.executeAsync(async () => {
      try {
        const posting = await this.prisma.$transaction(async (transaction) => {
          const updated = await transaction.posting.update({
            where: {
              id,
            },
            data: {
              status: "published",
              publishedAt: new Date(),
              pausedAt: null,
              archivedAt: null,
            },
            include: postingInclude,
          });

          await this.enqueueOutbox(transaction, updated.id, "upsert");
          return updated;
        });

        return this.mapPosting(posting);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return null;
        }

        throw error;
      }
    });
  }

  async archive(id: string): Promise<PostingRecord | null> {
    return this.executeAsync(async () => {
      try {
        const posting = await this.prisma.$transaction(async (transaction) => {
          const updated = await transaction.posting.update({
            where: {
              id,
            },
            data: {
              status: "archived",
              pausedAt: null,
              archivedAt: new Date(),
            },
            include: postingInclude,
          });

          await this.enqueueOutbox(transaction, updated.id, "delete");
          return updated;
        });

        return this.mapPosting(posting);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return null;
        }

        throw error;
      }
    });
  }

  async pause(id: string): Promise<PostingRecord | null> {
    return this.executeAsync(async () => {
      try {
        const posting = await this.prisma.$transaction(async (transaction) => {
          const updated = await transaction.posting.update({
            where: {
              id,
            },
            data: {
              status: "paused",
              pausedAt: new Date(),
              archivedAt: null,
            },
            include: postingInclude,
          });

          await this.enqueueOutbox(transaction, updated.id, "delete");
          return updated;
        });

        return this.mapPosting(posting);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return null;
        }

        throw error;
      }
    });
  }

  async unpause(id: string): Promise<PostingRecord | null> {
    return this.executeAsync(async () => {
      try {
        const posting = await this.prisma.$transaction(async (transaction) => {
          const updated = await transaction.posting.update({
            where: {
              id,
            },
            data: {
              status: "published",
              pausedAt: null,
              archivedAt: null,
            },
            include: postingInclude,
          });

          await this.enqueueOutbox(transaction, updated.id, "upsert");
          return updated;
        });

        return this.mapPosting(posting);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return null;
        }

        throw error;
      }
    });
  }

  async restoreFromSnapshot(snapshot: unknown): Promise<PostingRecord | null> {
    const posting = snapshot as PostingRecord | null | undefined;

    if (
      !posting?.id ||
      !posting.organizationId ||
      !Array.isArray(posting.photos) ||
      !Array.isArray(posting.availabilityBlocks)
    ) {
      return null;
    }

    type RestorableAvailabilityBlock = PostingAvailabilityBlockRecord & {
      source?: "owner" | "booking_hold" | "renting";
      bookingRequestHold?: unknown;
    };
    const ownerAvailabilityBlocks = (
      posting.availabilityBlocks as RestorableAvailabilityBlock[]
    ).filter(
      (block) =>
        (block.source === undefined || block.source === "owner") &&
        !block.bookingRequestHold,
    );
    return this.executeAsync(async () => {
      try {
        const restored = await this.prisma.$transaction(async (transaction) => {
          const existing = await transaction.posting.findUnique({
            where: { id: posting.id },
            include: {
              photos: {
                orderBy: {
                  position: "asc",
                },
              },
            },
          });

          if (!existing) {
            throw new Prisma.PrismaClientKnownRequestError("No Posting found", {
              code: "P2025",
              clientVersion: "unknown",
            });
          }

          const updated = await transaction.posting.update({
            where: { id: posting.id },
            data: {
              ...this.toUpdateData(
                {
                  organizationId: posting.organizationId,
                  variant: posting.variant,
                  name: posting.name,
                  description: posting.description,
                  pricing: posting.pricing,
                  photos: posting.photos,
                  tags: posting.tags,
                  details: posting.details,
                  availabilityStatus: posting.availabilityStatus,
                  availabilityNotes: posting.availabilityNotes ?? null,
                  maxBookingDurationDays:
                    posting.maxBookingDurationDays ?? null,
                  minBookingDurationDays:
                    posting.minBookingDurationDays ?? null,
                  advanceNoticeDays: posting.advanceNoticeDays ?? null,
                  cancellationPolicy: posting.cancellationPolicy ?? null,
                  cancellationPolicyNotes:
                    posting.cancellationPolicyNotes ?? null,
                  instantBooking: posting.instantBooking,
                  availabilityBlocks: [],
                  location: posting.location,
                },
                posting.photos,
              ),
              status: posting.status,
              publishedAt: posting.publishedAt
                ? new Date(posting.publishedAt)
                : null,
              pausedAt: posting.pausedAt ? new Date(posting.pausedAt) : null,
              archivedAt: posting.archivedAt
                ? new Date(posting.archivedAt)
                : null,
            },
            include: postingInclude,
          });

          await transaction.postingAvailabilityBlock.deleteMany({
            where: {
              postingId: posting.id,
              source: "owner",
            },
          });

          if (ownerAvailabilityBlocks.length > 0) {
            await transaction.postingAvailabilityBlock.createMany({
              data: ownerAvailabilityBlocks.map((block) => ({
                id: block.id,
                postingId: posting.id,
                startAt: new Date(block.startAt),
                endAt: new Date(block.endAt),
                note: block.note ?? null,
                source: "owner",
              })),
            });
          }

          await this.enqueueOutbox(
            transaction,
            updated.id,
            isPostingSearchIndexable(updated.status as PostingStatus)
              ? "upsert"
              : "delete",
          );

          return transaction.posting.findUniqueOrThrow({
            where: { id: updated.id },
            include: postingInclude,
          });
        });

        return this.mapPosting(restored);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025"
        ) {
          return null;
        }

        throw error;
      }
    });
  }

  async restoreOwnerAvailabilityBlock(
    snapshot: unknown,
  ): Promise<PostingAvailabilityBlockRecord | null> {
    const block = snapshot as
      | (PostingAvailabilityBlockRecord & { postingId?: string })
      | null
      | undefined;

    if (!block?.id || !block.postingId) {
      return null;
    }

    return this.executeAsync(async () => {
      const restored = await this.prisma.$transaction(async (transaction) => {
        const row = await transaction.postingAvailabilityBlock.upsert({
          where: { id: block.id },
          update: {
            startAt: new Date(block.startAt),
            endAt: new Date(block.endAt),
            note: block.note ?? null,
            source: "owner",
          },
          create: {
            id: block.id,
            postingId: block.postingId!,
            startAt: new Date(block.startAt),
            endAt: new Date(block.endAt),
            note: block.note ?? null,
            source: "owner",
          },
        });

        await this.enqueueOutbox(transaction, block.postingId!, "upsert");
        return row;
      });

      return this.mapAvailabilityBlock(restored);
    });
  }
  async findById(id: string): Promise<PostingRecord | null> {
    const posting = await this.executeAsync(() =>
      this.prisma.posting.findUnique({
        where: {
          id,
        },
        include: postingInclude,
      }),
    );

    return posting ? this.mapPosting(posting) : null;
  }

  async findPublicReadMetadataById(id: string): Promise<{
    id: string;
    organizationId: string;
    status: PostingStatus;
    archivedAt?: string;
  } | null> {
    const posting = await this.executeAsync(() =>
      this.prisma.posting.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          organizationId: true,
          status: true,
          archivedAt: true,
        },
      }),
    );

    return posting
      ? {
          id: posting.id,
          organizationId: posting.organizationId,
          status: posting.status as PostingStatus,
          archivedAt: posting.archivedAt?.toISOString(),
        }
      : null;
  }

  async listByOwner(
    input: ListOwnerPostingsInput,
  ): Promise<ListOwnerPostingsResult> {
    const where: Prisma.PostingWhereInput = {
      organizationId: input.organizationId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.q
        ? {
            OR: [
              { name: { contains: input.q } },
              { description: { contains: input.q } },
            ],
          }
        : {}),
    };
    const skip = (input.page - 1) * input.pageSize;

    const [postings, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.posting.findMany({
          where,
          skip,
          take: input.pageSize,
          orderBy: [
            {
              updatedAt: "desc",
            },
            {
              createdAt: "desc",
            },
          ],
          include: postingInclude,
        }),
        this.prisma.posting.count({
          where,
        }),
      ]),
    );

    return {
      postings: postings.map((posting) => this.mapPosting(posting)),
      pagination: this.createPagination(input.page, input.pageSize, total),
      ...(input.status ? { status: input.status } : {}),
    };
  }

  async countByOwnerStatus(
    organizationId: string,
  ): Promise<OwnerPostingsStatusSummary> {
    const grouped = await this.executeAsync(() =>
      this.prisma.posting.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),
    );

    const byStatus: OwnerPostingsStatusSummary["byStatus"] = {
      draft: 0,
      published: 0,
      paused: 0,
      archived: 0,
    };
    let total = 0;

    for (const row of grouped) {
      const status = row.status as PostingStatus;
      const count = row._count._all;
      total += count;
      if (status in byStatus) {
        byStatus[status] = count;
      }
    }

    return { total, byStatus };
  }

  async batchFindByOwner(
    input: BatchOwnerPostingsInput,
  ): Promise<BatchPostingsResult<PostingRecord>> {
    const postings = await this.executeAsync(() =>
      this.prisma.posting.findMany({
        where: {
          organizationId: input.organizationId,
          id: {
            in: input.ids,
          },
        },
        include: postingInclude,
      }),
    );

    const mapped = postings.map((posting) => this.mapPosting(posting));
    return this.orderBatchResult(input.ids, mapped);
  }

  async batchFindPublic(
    input: BatchPublicPostingsInput,
  ): Promise<BatchPostingsResult<PublicPostingRecord>> {
    const postings = await this.executeAsync(() =>
      this.prisma.posting.findMany({
        where: {
          id: {
            in: input.ids,
          },
          status: "published",
          archivedAt: null,
        },
        include: postingInclude,
      }),
    );

    const mapped = postings.map((posting) => this.mapPublicPosting(posting));
    return this.orderBatchResult(input.ids, mapped);
  }

  async searchPublicFallback(input: SearchPostingsInput): Promise<{
    ids: string[];
    total: number;
  }> {
    const skip = (input.page - 1) * input.pageSize;
    const whereClauses: Prisma.Sql[] = [
      Prisma.sql`status = 'published'`,
      Prisma.sql`archived_at IS NULL`,
    ];

    if (input.query) {
      const likeValue = this.createFallbackLikePattern(input.query);
      whereClauses.push(
        Prisma.sql`(
          name LIKE ${likeValue} ESCAPE '\\'
          OR description LIKE ${likeValue} ESCAPE '\\'
          OR city LIKE ${likeValue} ESCAPE '\\'
          OR region LIKE ${likeValue} ESCAPE '\\'
          OR country LIKE ${likeValue} ESCAPE '\\'
          OR CAST(tags AS CHAR) LIKE ${likeValue} ESCAPE '\\'
        )`,
      );
    }

    if (input.family) {
      whereClauses.push(Prisma.sql`family = ${input.family}`);
    }

    if (input.subtype) {
      whereClauses.push(Prisma.sql`subtype = ${input.subtype}`);
    }

    for (const tag of input.tags ?? []) {
      whereClauses.push(
        Prisma.sql`JSON_SEARCH(tags, 'one', ${tag}) IS NOT NULL`,
      );
    }

    if (input.availabilityStatus) {
      whereClauses.push(
        Prisma.sql`availability_status = ${input.availabilityStatus}`,
      );
    }

    if (input.minDailyPrice !== undefined) {
      whereClauses.push(
        Prisma.sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(pricing, '$.daily.amount')) AS DECIMAL(18, 2)) >= ${input.minDailyPrice}`,
      );
    }

    if (input.maxDailyPrice !== undefined) {
      whereClauses.push(
        Prisma.sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(pricing, '$.daily.amount')) AS DECIMAL(18, 2)) <= ${input.maxDailyPrice}`,
      );
    }

    const detailsColumn = input.family
      ? Prisma.raw(this.resolveDetailsColumnName(input.family))
      : null;

    for (const filter of input.attributeFilters ?? []) {
      if (!detailsColumn) {
        continue;
      }

      const attributePath = `$.${filter.key}`;

      if (typeof filter.value === "string") {
        whereClauses.push(
          Prisma.sql`LOWER(JSON_UNQUOTE(JSON_EXTRACT(${detailsColumn}, ${attributePath}))) = ${filter.value}`,
        );
      } else if (typeof filter.value === "boolean") {
        whereClauses.push(
          Prisma.sql`JSON_EXTRACT(${detailsColumn}, ${attributePath}) = ${filter.value}`,
        );
      } else if (typeof filter.value === "number") {
        whereClauses.push(
          Prisma.sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${detailsColumn}, ${attributePath})) AS DECIMAL(18, 6)) = ${filter.value}`,
        );
      } else if (Array.isArray(filter.value)) {
        for (const value of filter.value) {
          whereClauses.push(
            Prisma.sql`EXISTS (
              SELECT 1
              FROM JSON_TABLE(
                CASE
                  WHEN JSON_TYPE(JSON_EXTRACT(${detailsColumn}, ${attributePath})) = 'ARRAY'
                    THEN JSON_EXTRACT(${detailsColumn}, ${attributePath})
                  ELSE JSON_ARRAY()
                END,
                '$[*]' COLUMNS (value VARCHAR(255) PATH '$')
              ) AS attribute_values
              WHERE LOWER(attribute_values.value) = ${value}
            )`,
          );
        }
      }

      if (filter.min !== undefined) {
        whereClauses.push(
          Prisma.sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${detailsColumn}, ${attributePath})) AS DECIMAL(18, 6)) >= ${filter.min}`,
        );
      }

      if (filter.max !== undefined) {
        whereClauses.push(
          Prisma.sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${detailsColumn}, ${attributePath})) AS DECIMAL(18, 6)) <= ${filter.max}`,
        );
      }
    }

    if (input.availabilityWindow) {
      const requestedStartAt = new Date(input.availabilityWindow.startAt);
      const requestedEndAt = new Date(input.availabilityWindow.endAt);
      const now = new Date();

      whereClauses.push(
        Prisma.sql`NOT EXISTS (
          SELECT 1
          FROM posting_availability_blocks pab
          LEFT JOIN booking_requests br
            ON br.hold_block_id = pab.id
          WHERE pab.posting_id = postings.id
            AND pab.start_at < ${requestedEndAt}
            AND pab.end_at > ${requestedStartAt}
            AND (
              br.id IS NULL
              OR (
                br.status IN ('awaiting_payment', 'payment_processing', 'paid')
                AND br.converted_at IS NULL
                AND br.hold_expires_at > ${now}
              )
            )
        )`,
      );

      whereClauses.push(
        Prisma.sql`NOT EXISTS (
          SELECT 1
          FROM booking_requests br
          WHERE br.posting_id = postings.id
            AND br.status IN ('pending', 'awaiting_payment', 'payment_processing', 'paid')
            AND br.converted_at IS NULL
            AND (
              br.conversion_reservation_expires_at IS NULL
              OR br.conversion_reservation_expires_at <= ${now}
            )
            AND br.hold_expires_at > ${now}
            AND br.start_at < ${requestedEndAt}
            AND br.end_at > ${requestedStartAt}
        )`,
      );

      whereClauses.push(
        Prisma.sql`NOT EXISTS (
          SELECT 1
          FROM rentings r
          WHERE r.posting_id = postings.id
            AND r.start_at < ${requestedEndAt}
            AND r.end_at > ${requestedStartAt}
        )`,
      );
    }

    const distanceExpression = input.geo
      ? Prisma.sql`(
          6371 * ACOS(
            LEAST(
              1,
              GREATEST(
                -1,
                COS(RADIANS(${input.geo.latitude})) * COS(RADIANS(latitude))
                * COS(RADIANS(longitude) - RADIANS(${input.geo.longitude}))
                + SIN(RADIANS(${input.geo.latitude})) * SIN(RADIANS(latitude))
              )
            )
          )
        )`
      : null;

    if (distanceExpression && input.geo?.radiusKm !== undefined) {
      whereClauses.push(
        Prisma.sql`${distanceExpression} <= ${input.geo.radiusKm}`,
      );
    }

    const orderBy = this.createFallbackOrderBy(input, distanceExpression);

    const whereSql = Prisma.join(whereClauses, " AND ");
    const [countRows, idRows] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.$queryRaw<SearchCountRow[]>(
          Prisma.sql`SELECT COUNT(*) AS total FROM postings WHERE ${whereSql}`,
        ),
        this.prisma.$queryRaw<SearchIdRow[]>(
          Prisma.sql`
            SELECT id
            FROM postings
            WHERE ${whereSql}
            ORDER BY ${orderBy}
            LIMIT ${input.pageSize}
            OFFSET ${skip}
          `,
        ),
      ]),
    );

    return {
      ids: idRows.map((row) => row.id),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async autocompletePublicFallback(input: PostingAutocompleteInput): Promise<
    Array<{
      name: string;
      tags: string[];
      location: {
        city?: string;
        region?: string;
        country?: string;
      };
      publishedAt?: string;
      createdAt: string;
    }>
  > {
    const normalizedQuery = input.query.trim().toLowerCase();
    const containsLikeValue = this.createFallbackLikePattern(normalizedQuery);
    const prefixLikeValue = this.createFallbackPrefixPattern(normalizedQuery);
    const whereClauses: Prisma.Sql[] = [
      Prisma.sql`status = 'published'`,
      Prisma.sql`archived_at IS NULL`,
      Prisma.sql`(
        LOWER(name) LIKE ${containsLikeValue} ESCAPE '\\'
        OR LOWER(city) LIKE ${containsLikeValue} ESCAPE '\\'
        OR LOWER(region) LIKE ${containsLikeValue} ESCAPE '\\'
        OR LOWER(country) LIKE ${containsLikeValue} ESCAPE '\\'
        OR LOWER(CAST(tags AS CHAR)) LIKE ${containsLikeValue} ESCAPE '\\'
      )`,
    ];

    if (input.family) {
      whereClauses.push(Prisma.sql`family = ${input.family}`);
    }

    if (input.subtype) {
      whereClauses.push(Prisma.sql`subtype = ${input.subtype}`);
    }

    const whereSql = Prisma.join(whereClauses, " AND ");
    const candidateLimit = Math.min(Math.max(input.limit * 5, 12), 40);
    const rows = await this.executeAsync(() =>
      this.prisma.$queryRaw<PostingAutocompleteRow[]>(
        Prisma.sql`
          SELECT
            id,
            name,
            CAST(tags AS CHAR) AS tags,
            city,
            region,
            country,
            published_at AS publishedAt,
            created_at AS createdAt
          FROM postings
          WHERE ${whereSql}
          ORDER BY (
            CASE WHEN LOWER(name) LIKE ${prefixLikeValue} ESCAPE '\\' THEN 14 ELSE 0 END
            + CASE WHEN LOWER(CAST(tags AS CHAR)) LIKE ${prefixLikeValue} ESCAPE '\\' THEN 10 ELSE 0 END
            + CASE WHEN LOWER(city) LIKE ${prefixLikeValue} ESCAPE '\\' THEN 8 ELSE 0 END
            + CASE WHEN LOWER(region) LIKE ${prefixLikeValue} ESCAPE '\\' THEN 6 ELSE 0 END
            + CASE WHEN LOWER(country) LIKE ${prefixLikeValue} ESCAPE '\\' THEN 4 ELSE 0 END
            + CASE WHEN LOWER(name) LIKE ${containsLikeValue} ESCAPE '\\' THEN 3 ELSE 0 END
            + CASE WHEN LOWER(CAST(tags AS CHAR)) LIKE ${containsLikeValue} ESCAPE '\\' THEN 2 ELSE 0 END
            + CASE WHEN LOWER(city) LIKE ${containsLikeValue} ESCAPE '\\' THEN 2 ELSE 0 END
            + CASE WHEN LOWER(region) LIKE ${containsLikeValue} ESCAPE '\\' THEN 1 ELSE 0 END
            + CASE WHEN LOWER(country) LIKE ${containsLikeValue} ESCAPE '\\' THEN 1 ELSE 0 END
          ) DESC,
          published_at DESC,
          created_at DESC,
          id ASC
          LIMIT ${candidateLimit}
        `,
      ),
    );

    return rows.map((row) => ({
      name: row.name,
      tags: this.parseAutocompleteTags(row.tags),
      location: {
        city: row.city ?? undefined,
        region: row.region ?? undefined,
        country: row.country ?? undefined,
      },
      publishedAt: row.publishedAt
        ? new Date(row.publishedAt).toISOString()
        : undefined,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  }

  async findByIdsForIndexing(ids: string[]): Promise<PostingSearchDocument[]> {
    if (ids.length === 0) {
      return [];
    }

    const postings = await this.executeAsync(() =>
      this.prisma.posting.findMany({
        where: {
          id: {
            in: ids,
          },
        },
        include: postingInclude,
      }),
    );

    return postings.map((posting) => this.mapSearchDocument(posting));
  }

  async listRecentForIndexReconciliation(
    limit: number,
  ): Promise<PostingSearchDocument[]> {
    const postings = await this.executeAsync(() =>
      this.prisma.posting.findMany({
        orderBy: [
          {
            updatedAt: "desc",
          },
          {
            id: "asc",
          },
        ],
        take: limit,
        include: postingInclude,
      }),
    );

    return postings.map((posting) => this.mapSearchDocument(posting));
  }

  async claimSearchOutboxBatch(
    limit: number,
  ): Promise<PostingSearchOutboxRecord[]> {
    return this.executeAsync(async () => {
      const now = new Date();
      const staleProcessingThreshold = new Date(now.getTime() - 5 * 60 * 1000);
      const claimedRows = await this.prisma.$transaction(
        async (transaction) => {
          const idRows = await transaction.$queryRaw<SearchOutboxIdRow[]>(
            Prisma.sql`
            SELECT id
            FROM posting_search_outbox
            WHERE processed_at IS NULL
              AND dead_lettered_at IS NULL
              AND available_at <= ${now}
              AND (processing_at IS NULL OR processing_at < ${staleProcessingThreshold})
            ORDER BY available_at ASC, created_at ASC
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          `,
          );
          const ids = idRows.map((row) => row.id);

          if (ids.length === 0) {
            return [];
          }

          await transaction.postingSearchOutbox.updateMany({
            where: {
              id: {
                in: ids,
              },
            },
            data: {
              processingAt: now,
            },
          });

          const rows = await transaction.postingSearchOutbox.findMany({
            where: {
              id: {
                in: ids,
              },
            },
          });
          const byId = new Map(rows.map((row) => [row.id, row]));

          return ids
            .map((id) => byId.get(id))
            .filter((row): row is NonNullable<typeof row> => Boolean(row));
        },
      );

      return claimedRows.map((row) => this.mapOutbox(row, now));
    });
  }

  async markSearchOutboxPublished(
    id: string,
    brokerMessageId?: string,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.postingSearchOutbox.update({
        where: {
          id,
        },
        data: {
          processedAt: new Date(),
          processingAt: null,
          brokerMessageId: brokerMessageId ?? null,
          lastError: null,
        },
      }),
    );
  }

  async markSearchOutboxPublishRetry(
    id: string,
    attempts: number,
    errorMessage: string,
  ): Promise<void> {
    const backoffSeconds = Math.min(300, 2 ** Math.min(attempts, 8));
    await this.executeAsync(() =>
      this.prisma.postingSearchOutbox.update({
        where: {
          id,
        },
        data: {
          publishAttempts: {
            increment: 1,
          },
          processingAt: null,
          availableAt: new Date(Date.now() + backoffSeconds * 1000),
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );
  }

  async markSearchOutboxIndexed(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.postingSearchOutbox.update({
        where: {
          id,
        },
        data: {
          indexedAt: new Date(),
          lastError: null,
        },
      }),
    );
  }

  async incrementSearchOutboxAttempt(
    id: string,
    errorMessage: string,
  ): Promise<number> {
    const updated = await this.executeAsync(() =>
      this.prisma.postingSearchOutbox.update({
        where: {
          id,
        },
        data: {
          attempts: {
            increment: 1,
          },
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );

    return updated.attempts;
  }

  async markSearchOutboxDeadLettered(
    id: string,
    errorMessage: string,
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.postingSearchOutbox.update({
        where: {
          id,
        },
        data: {
          deadLetteredAt: new Date(),
          processingAt: null,
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );
  }

  async getSearchOutboxById(
    id: string,
  ): Promise<PostingSearchOutboxRecord | null> {
    const outbox = await this.executeAsync(() =>
      this.prisma.postingSearchOutbox.findUnique({
        where: {
          id,
        },
      }),
    );

    return outbox ? this.mapOutbox(outbox) : null;
  }

  async getSearchOutboxesByIds(
    ids: string[],
  ): Promise<PostingSearchOutboxRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.executeAsync(() =>
      this.prisma.postingSearchOutbox.findMany({
        where: {
          id: {
            in: ids,
          },
        },
      }),
    );
    const byId = new Map(rows.map((row) => [row.id, this.mapOutbox(row)]));

    return ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }

  async hasNewerSearchOutboxJob(
    job: Pick<
      PostingSearchOutboxRecord,
      "id" | "postingId" | "reindexRunId" | "targetIndexName" | "createdAt"
    >,
  ): Promise<boolean> {
    if (!job.postingId) {
      return false;
    }

    const count = await this.executeAsync(() =>
      this.prisma.postingSearchOutbox.count({
        where: {
          postingId: job.postingId,
          reindexRunId: job.reindexRunId ?? null,
          targetIndexName: job.targetIndexName ?? null,
          deadLetteredAt: null,
          id: {
            not: job.id,
          },
          createdAt: {
            gt: new Date(job.createdAt),
          },
        },
      }),
    );

    return count > 0;
  }

  async enqueueSearchSync(
    postingId: string,
    operation: "upsert" | "delete" = "upsert",
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        await this.enqueueOutbox(transaction, postingId, operation);
      }),
    );
  }

  async findPrimaryPhotoForThumbnailing(
    postingId: string,
  ): Promise<PostingPhotoRecord | null> {
    const photo = await this.executeAsync(() =>
      this.prisma.postingPhoto.findFirst({
        where: {
          postingId,
          position: 0,
        },
        orderBy: {
          createdAt: "asc",
        },
      }),
    );

    return photo
      ? {
          id: photo.id,
          blobUrl: photo.blobUrl,
          blobName: photo.blobName,
          thumbnailBlobUrl: photo.thumbnailBlobUrl ?? undefined,
          thumbnailBlobName: photo.thumbnailBlobName ?? undefined,
          position: photo.position,
          createdAt: photo.createdAt.toISOString(),
          updatedAt: photo.updatedAt.toISOString(),
        }
      : null;
  }

  async updatePostingPhotoThumbnail(
    photoId: string,
    input: {
      thumbnailBlobName: string;
      thumbnailBlobUrl: string;
    },
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.postingPhoto.update({
        where: {
          id: photoId,
        },
        data: {
          thumbnailBlobName: input.thumbnailBlobName,
          thumbnailBlobUrl: input.thumbnailBlobUrl,
        },
      }),
    );
  }

  async createSearchReindexRun(
    targetIndexName: string,
  ): Promise<SearchReindexRunRecord> {
    const run = await this.executeAsync(() =>
      this.prisma.searchReindexRun.create({
        data: {
          id: randomUUID(),
          status: "pending",
          targetIndexName,
          sourceSnapshotAt: new Date(),
        },
      }),
    );

    return this.mapSearchReindexRun(run);
  }

  async findSearchReindexRunById(
    id: string,
  ): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.searchReindexRun.findUnique({
        where: {
          id,
        },
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async findActiveSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.searchReindexRun.findFirst({
        where: {
          status: {
            in: ["pending", "running", "waiting_for_catchup"],
          },
        },
        orderBy: [
          {
            createdAt: "desc",
          },
        ],
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async findLatestSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.searchReindexRun.findFirst({
        orderBy: [
          {
            createdAt: "desc",
          },
        ],
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async findLatestCompletedSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.searchReindexRun.findFirst({
        where: {
          status: "completed",
        },
        orderBy: [
          {
            completedAt: "desc",
          },
          {
            createdAt: "desc",
          },
        ],
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async listCompletedSearchReindexRunsWithRetainedIndices(): Promise<
    SearchReindexRunRecord[]
  > {
    const runs = await this.executeAsync(() =>
      this.prisma.searchReindexRun.findMany({
        where: {
          status: "completed",
          retainedIndexName: {
            not: null,
          },
        },
        orderBy: [
          {
            completedAt: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
      }),
    );

    return runs.map((run) => this.mapSearchReindexRun(run));
  }

  async claimNextSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    return this.executeAsync(async () => {
      const now = new Date();
      const staleProcessingThreshold = new Date(now.getTime() - 5 * 60 * 1000);
      const candidate = await this.prisma.searchReindexRun.findFirst({
        where: {
          status: {
            in: ["pending", "running", "waiting_for_catchup"],
          },
          OR: [
            {
              processingAt: null,
            },
            {
              processingAt: {
                lt: staleProcessingThreshold,
              },
            },
          ],
        },
        orderBy: [
          {
            createdAt: "asc",
          },
        ],
      });

      if (!candidate) {
        return null;
      }

      const result = await this.prisma.searchReindexRun.updateMany({
        where: {
          id: candidate.id,
          OR: [
            {
              processingAt: null,
            },
            {
              processingAt: {
                lt: staleProcessingThreshold,
              },
            },
          ],
        },
        data: {
          processingAt: now,
        },
      });

      if (result.count !== 1) {
        return null;
      }

      return this.mapSearchReindexRun({
        ...candidate,
        processingAt: now,
      });
    });
  }

  async markSearchReindexRunRunning(
    id: string,
    totalPostings: number,
  ): Promise<SearchReindexRunRecord> {
    const run = await this.executeAsync(() =>
      this.prisma.searchReindexRun.update({
        where: {
          id,
        },
        data: {
          status: "running",
          totalPostings,
          startedAt: new Date(),
          processingAt: new Date(),
          lastError: null,
        },
      }),
    );

    return this.mapSearchReindexRun(run);
  }

  async updateSearchReindexRunProgress(
    id: string,
    input: {
      indexedPostings: number;
      failedPostings?: number;
    },
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.searchReindexRun.update({
        where: {
          id,
        },
        data: {
          indexedPostings: input.indexedPostings,
          ...(input.failedPostings !== undefined
            ? {
                failedPostings: input.failedPostings,
              }
            : {}),
        },
      }),
    );
  }

  async enqueueSearchReindexBarrier(
    reindexRunId: string,
    targetIndexName: string,
  ): Promise<PostingSearchOutboxRecord> {
    return this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const barrierId = randomUUID();

        const created = await transaction.postingSearchOutbox.create({
          data: {
            id: barrierId,
            reindexRunId,
            operation: "barrier",
            dedupeKey: barrierId,
            targetIndexName,
          },
        });

        await transaction.searchReindexRun.update({
          where: {
            id: reindexRunId,
          },
          data: {
            status: "waiting_for_catchup",
            barrierOutboxId: barrierId,
            processingAt: null,
          },
        });

        return this.mapOutbox(created);
      }),
    );
  }

  async getSearchReindexCatchUpState(
    id: string,
  ): Promise<SearchReindexCatchUpState> {
    return this.executeAsync(async () => {
      const run = await this.prisma.searchReindexRun.findUnique({
        where: {
          id,
        },
        select: {
          barrierOutboxId: true,
        },
      });

      if (!run?.barrierOutboxId) {
        return {
          state: "failed",
          errorMessage:
            "Search reindex run is missing its barrier outbox reference.",
        };
      }

      const barrier = await this.prisma.postingSearchOutbox.findUnique({
        where: {
          id: run.barrierOutboxId,
        },
        select: {
          createdAt: true,
          indexedAt: true,
          deadLetteredAt: true,
          lastError: true,
        },
      });

      if (!barrier) {
        return {
          state: "failed",
          errorMessage:
            "Search reindex barrier outbox entry could not be found.",
        };
      }

      if (barrier.deadLetteredAt) {
        return {
          state: "failed",
          errorMessage: barrier.lastError
            ? `Search reindex barrier could not complete: ${barrier.lastError}`
            : "Search reindex barrier could not complete because the barrier outbox entry was dead-lettered.",
        };
      }

      if (!barrier.indexedAt) {
        return {
          state: "waiting",
        };
      }

      const remaining = await this.prisma.postingSearchOutbox.count({
        where: {
          reindexRunId: id,
          deadLetteredAt: null,
          indexedAt: null,
          createdAt: {
            lte: barrier.createdAt,
          },
        },
      });

      return remaining === 0
        ? {
            state: "caught_up",
          }
        : {
            state: "waiting",
          };
    });
  }

  async markSearchReindexRunCompleted(
    id: string,
    retainedIndexName?: string,
  ): Promise<SearchReindexRunRecord> {
    const run = await this.executeAsync(() =>
      this.prisma.searchReindexRun.update({
        where: {
          id,
        },
        data: {
          status: "completed",
          retainedIndexName: retainedIndexName ?? null,
          completedAt: new Date(),
          processingAt: null,
          lastError: null,
        },
      }),
    );

    return this.mapSearchReindexRun(run);
  }

  async markSearchReindexRunFailed(
    id: string,
    errorMessage: string,
  ): Promise<SearchReindexRunRecord> {
    const run = await this.executeAsync(() =>
      this.prisma.searchReindexRun.update({
        where: {
          id,
        },
        data: {
          status: "failed",
          failedAt: new Date(),
          processingAt: null,
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );

    return this.mapSearchReindexRun(run);
  }

  async countPublishedPostingsForIndexing(
    sourceSnapshotAt?: string,
  ): Promise<number> {
    const snapshotAt = sourceSnapshotAt
      ? new Date(sourceSnapshotAt)
      : undefined;

    return this.executeAsync(() =>
      this.prisma.posting.count({
        where: {
          status: "published",
          archivedAt: null,
          ...(snapshotAt
            ? {
                updatedAt: {
                  lte: snapshotAt,
                },
              }
            : {}),
        },
      }),
    );
  }

  async listPublishedForIndexingBatch(
    limit: number,
    cursorId?: string,
    sourceSnapshotAt?: string,
  ): Promise<PostingSearchDocument[]> {
    const snapshotAt = sourceSnapshotAt
      ? new Date(sourceSnapshotAt)
      : undefined;

    const postings = await this.executeAsync(() =>
      this.prisma.posting.findMany({
        where: {
          status: "published",
          archivedAt: null,
          ...(snapshotAt
            ? {
                updatedAt: {
                  lte: snapshotAt,
                },
              }
            : {}),
        },
        orderBy: {
          id: "asc",
        },
        take: limit,
        ...(cursorId
          ? {
              cursor: {
                id: cursorId,
              },
              skip: 1,
            }
          : {}),
        include: postingInclude,
      }),
    );

    return postings.map((posting) => this.mapSearchDocument(posting));
  }

  async getPendingSearchOutboxCount(): Promise<number> {
    return this.executeAsync(() =>
      this.prisma.postingSearchOutbox.count({
        where: {
          indexedAt: null,
          deadLetteredAt: null,
        },
      }),
    );
  }

  async markSearchOutboxesIndexed(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.executeAsync(() =>
      this.prisma.postingSearchOutbox.updateMany({
        where: {
          id: {
            in: ids,
          },
        },
        data: {
          indexedAt: new Date(),
          lastError: null,
        },
      }),
    );
  }

  async touchSearchReindexRunProcessing(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.searchReindexRun.update({
        where: {
          id,
        },
        data: {
          processingAt: new Date(),
        },
      }),
    );
  }

  async clearSearchReindexRunProcessing(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.searchReindexRun.update({
        where: {
          id,
        },
        data: {
          processingAt: null,
        },
      }),
    );
  }

  async clearSearchReindexRunRetainedIndexName(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.searchReindexRun.update({
        where: {
          id,
        },
        data: {
          retainedIndexName: null,
        },
      }),
    );
  }

  async markSearchOutboxRelayed(
    id: string,
    supersededIds: string[],
    brokerMessageId?: string,
  ): Promise<void> {
    const now = new Date();

    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        await transaction.postingSearchOutbox.update({
          where: {
            id,
          },
          data: {
            processedAt: now,
            processingAt: null,
            brokerMessageId: brokerMessageId ?? null,
            lastError: null,
          },
        });

        if (supersededIds.length > 0) {
          await transaction.postingSearchOutbox.updateMany({
            where: {
              id: {
                in: supersededIds,
              },
            },
            data: {
              processedAt: now,
              indexedAt: now,
              processingAt: null,
              brokerMessageId: brokerMessageId ?? null,
              lastError: null,
            },
          });
        }
      }),
    );
  }

  async markSearchOutboxSuperseded(
    ids: string[],
    brokerMessageId?: string,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const now = new Date();
    await this.executeAsync(() =>
      this.prisma.postingSearchOutbox.updateMany({
        where: {
          id: {
            in: ids,
          },
        },
        data: {
          processedAt: now,
          indexedAt: now,
          processingAt: null,
          brokerMessageId: brokerMessageId ?? null,
          lastError: null,
        },
      }),
    );
  }

  async releaseSearchOutboxClaims(
    ids: string[],
    errorMessage?: string,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.executeAsync(() =>
      this.prisma.postingSearchOutbox.updateMany({
        where: {
          id: {
            in: ids,
          },
          indexedAt: null,
          deadLetteredAt: null,
        },
        data: {
          processingAt: null,
          ...(errorMessage !== undefined
            ? {
                lastError: errorMessage.slice(0, 2048),
              }
            : {}),
        },
      }),
    );
  }

  async reviveDeadLetteredSearchOutbox(limit: number): Promise<number> {
    if (limit <= 0) {
      return 0;
    }

    return this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.postingSearchOutbox.findMany({
          where: {
            deadLetteredAt: {
              not: null,
            },
            operation: {
              in: ["upsert", "delete"],
            },
          },
          orderBy: [
            {
              deadLetteredAt: "asc",
            },
            {
              createdAt: "asc",
            },
          ],
          take: limit,
          select: {
            id: true,
          },
        });
        const ids = rows.map((row) => row.id);

        if (ids.length === 0) {
          return 0;
        }

        await transaction.postingSearchOutbox.updateMany({
          where: {
            id: {
              in: ids,
            },
          },
          data: {
            deadLetteredAt: null,
            processedAt: null,
            indexedAt: null,
            processingAt: null,
            brokerMessageId: null,
            lastError: null,
            attempts: 0,
            publishAttempts: 0,
            availableAt: new Date(),
          },
        });

        return ids.length;
      }),
    );
  }

  async getPendingSearchOutboxMetrics(): Promise<PendingSearchOutboxMetrics> {
    const lag = await this.getSearchOutboxLagMetrics();

    return {
      count: lag.unpublishedCount,
      ...(lag.unpublishedOldestAgeMs !== undefined
        ? {
            oldestAgeMs: lag.unpublishedOldestAgeMs,
          }
        : {}),
    };
  }

  async getSearchOutboxLagMetrics(): Promise<SearchOutboxLagMetrics> {
    return this.executeAsync(async () => {
      const [row] = await this.prisma.$queryRaw<
        SearchOutboxLagRow[]
      >(Prisma.sql`
        SELECT
          SUM(CASE WHEN processed_at IS NULL AND dead_lettered_at IS NULL THEN 1 ELSE 0 END) AS unpublishedCount,
          MIN(CASE WHEN processed_at IS NULL AND dead_lettered_at IS NULL THEN created_at ELSE NULL END) AS unpublishedOldestCreatedAt,
          SUM(CASE WHEN processed_at IS NOT NULL AND indexed_at IS NULL AND dead_lettered_at IS NULL THEN 1 ELSE 0 END) AS publishedNotIndexedCount,
          MIN(CASE WHEN processed_at IS NOT NULL AND indexed_at IS NULL AND dead_lettered_at IS NULL THEN processed_at ELSE NULL END) AS publishedNotIndexedOldestProcessedAt,
          SUM(CASE WHEN dead_lettered_at IS NOT NULL AND operation = 'upsert' THEN 1 ELSE 0 END) AS upsertDeadLetteredCount,
          SUM(CASE WHEN dead_lettered_at IS NOT NULL AND operation = 'delete' THEN 1 ELSE 0 END) AS deleteDeadLetteredCount,
          SUM(CASE WHEN dead_lettered_at IS NOT NULL AND operation = 'barrier' THEN 1 ELSE 0 END) AS barrierDeadLetteredCount
        FROM posting_search_outbox
      `);

      return {
        unpublishedCount: this.readNumberLike(row?.unpublishedCount),
        ...(row?.unpublishedOldestCreatedAt
          ? {
              unpublishedOldestAgeMs: Math.max(
                0,
                Date.now() - row.unpublishedOldestCreatedAt.getTime(),
              ),
            }
          : {}),
        publishedNotIndexedCount: this.readNumberLike(
          row?.publishedNotIndexedCount,
        ),
        ...(row?.publishedNotIndexedOldestProcessedAt
          ? {
              publishedNotIndexedOldestAgeMs: Math.max(
                0,
                Date.now() - row.publishedNotIndexedOldestProcessedAt.getTime(),
              ),
            }
          : {}),
        deadLetteredByOperation: {
          upsert: this.readNumberLike(row?.upsertDeadLetteredCount),
          delete: this.readNumberLike(row?.deleteDeadLetteredCount),
          barrier: this.readNumberLike(row?.barrierDeadLetteredCount),
        },
      };
    });
  }

  async withSearchReindexStartLock<T>(
    operation: (helpers: {
      findActiveSearchReindexRun: () => Promise<SearchReindexRunRecord | null>;
      createSearchReindexRun: (
        targetIndexName: string,
      ) => Promise<SearchReindexRunRecord>;
    }) => Promise<T>,
  ): Promise<T | null> {
    return this.executeAsync(
      () =>
        this.prisma.$transaction(async (transaction) => {
          const lockRows = await transaction.$queryRaw<LockRow[]>(
            Prisma.sql`SELECT GET_LOCK(${SEARCH_REINDEX_START_LOCK_NAME}, 0) AS acquired`,
          );
          const acquired = this.readMysqlLockResult(lockRows[0]?.acquired);

          if (!acquired) {
            return null;
          }

          try {
            return await operation({
              findActiveSearchReindexRun: async () => {
                const run = await transaction.searchReindexRun.findFirst({
                  where: {
                    status: {
                      in: ["pending", "running", "waiting_for_catchup"],
                    },
                  },
                  orderBy: [
                    {
                      createdAt: "desc",
                    },
                  ],
                });

                return run ? this.mapSearchReindexRun(run) : null;
              },
              createSearchReindexRun: async (targetIndexName: string) => {
                const run = await transaction.searchReindexRun.create({
                  data: {
                    id: randomUUID(),
                    status: "pending",
                    targetIndexName,
                    sourceSnapshotAt: new Date(),
                  },
                });

                return this.mapSearchReindexRun(run);
              },
            });
          } finally {
            await transaction.$queryRaw<LockRow[]>(
              Prisma.sql`SELECT RELEASE_LOCK(${SEARCH_REINDEX_START_LOCK_NAME}) AS released`,
            );
          }
        }),
      {
        operationName: "withSearchReindexStartLock",
      },
    );
  }

  private createFallbackOrderBy(
    input: SearchPostingsInput,
    distanceExpression: Prisma.Sql | null,
  ): Prisma.Sql {
    switch (input.sort) {
      case "dailyPrice":
        return Prisma.sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(pricing, '$.daily.amount')) AS DECIMAL(18, 2)) ASC, published_at DESC, created_at DESC, id ASC`;
      case "oldest":
        return Prisma.sql`published_at ASC, created_at ASC, id ASC`;
      case "nameAsc":
        return Prisma.sql`LOWER(name) ASC, published_at DESC, created_at DESC, id ASC`;
      case "nameDesc":
        return Prisma.sql`LOWER(name) DESC, published_at DESC, created_at DESC, id ASC`;
      case "highestRated":
        return Prisma.sql`average_rating DESC, review_count DESC, published_at DESC, created_at DESC, id ASC`;
      case "nearest":
        if (distanceExpression) {
          return Prisma.sql`${distanceExpression} ASC, published_at DESC, created_at DESC, id ASC`;
        }

        return Prisma.sql`published_at DESC, created_at DESC, id ASC`;
      case "newest":
        return Prisma.sql`published_at DESC, created_at DESC, id ASC`;
      case "relevance":
      default:
        if (input.query) {
          const likeValue = this.createFallbackLikePattern(input.query);

          return Prisma.sql`(
            CASE WHEN name LIKE ${likeValue} ESCAPE '\\' THEN 6 ELSE 0 END
            + CASE WHEN CAST(tags AS CHAR) LIKE ${likeValue} ESCAPE '\\' THEN 3 ELSE 0 END
            + CASE WHEN description LIKE ${likeValue} ESCAPE '\\' THEN 2 ELSE 0 END
            + CASE WHEN city LIKE ${likeValue} ESCAPE '\\' THEN 2 ELSE 0 END
            + CASE WHEN region LIKE ${likeValue} ESCAPE '\\' THEN 1 ELSE 0 END
            + CASE WHEN country LIKE ${likeValue} ESCAPE '\\' THEN 1 ELSE 0 END
          ) DESC, published_at DESC, created_at DESC, id ASC`;
        }

        return Prisma.sql`published_at DESC, created_at DESC, id ASC`;
    }
  }

  private createFallbackLikePattern(query: string): string {
    return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  }

  private createFallbackPrefixPattern(query: string): string {
    return `${query.replace(/[\\%_]/g, "\\$&")}%`;
  }

  private parseAutocompleteTags(value: string | null): string[] {
    if (!value) {
      return [];
    }

    try {
      const parsed = JSON.parse(value) as unknown;

      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : [];
    } catch {
      return [];
    }
  }

  private async enqueueOutbox(
    transaction: Prisma.TransactionClient,
    postingId: string,
    operation: "upsert" | "delete",
  ): Promise<void> {
    const activeRun = await transaction.searchReindexRun.findFirst({
      where: {
        status: {
          in: ["pending", "running", "waiting_for_catchup"],
        },
      },
      orderBy: [
        {
          createdAt: "desc",
        },
      ],
      select: {
        id: true,
        targetIndexName: true,
      },
    });
    const primaryEventId = randomUUID();
    const entries: Prisma.PostingSearchOutboxCreateManyInput[] = [
      {
        id: primaryEventId,
        postingId,
        operation,
        dedupeKey: primaryEventId,
      },
    ];

    if (activeRun) {
      const secondaryEventId = randomUUID();
      entries.push({
        id: secondaryEventId,
        postingId,
        reindexRunId: activeRun.id,
        operation,
        dedupeKey: secondaryEventId,
        targetIndexName: activeRun.targetIndexName,
      });
    }

    await transaction.postingSearchOutbox.createMany({
      data: entries,
    });
  }

  private toCreateData(input: UpsertPostingInput): Prisma.PostingCreateInput {
    return {
      id: randomUUID(),
      organization: {
        connect: {
          id: input.organizationId,
        },
      },
      status: "draft",
      family: input.variant.family,
      subtype: input.variant.subtype,
      name: input.name,
      description: input.description,
      pricingCurrency: input.pricing.currency,
      pricing: input.pricing as Prisma.InputJsonValue,
      tags: input.tags as Prisma.InputJsonValue,
      ...this.toPostingDetailsColumns(input.variant, input.details),
      availabilityStatus: input.availabilityStatus,
      availabilityNotes: input.availabilityNotes ?? null,
      maxBookingDurationDays: input.maxBookingDurationDays ?? null,
      minBookingDurationDays: input.minBookingDurationDays ?? null,
      advanceNoticeDays: input.advanceNoticeDays ?? null,
      cancellationPolicy: input.cancellationPolicy ?? null,
      cancellationPolicyNotes: input.cancellationPolicyNotes ?? null,
      instantBooking: input.instantBooking ?? false,
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      city: input.location.city,
      region: input.location.region,
      country: input.location.country,
      postalCode: input.location.postalCode ?? null,
      photos: {
        create: input.photos.map((photo) => ({
          id: randomUUID(),
          blobUrl: photo.blobUrl,
          blobName: photo.blobName,
          thumbnailBlobUrl: photo.thumbnailBlobUrl ?? null,
          thumbnailBlobName: photo.thumbnailBlobName ?? null,
          position: photo.position,
        })),
      },
      availabilityBlocks: {
        create: input.availabilityBlocks.map((block) => ({
          id: randomUUID(),
          startAt: new Date(block.startAt),
          endAt: new Date(block.endAt),
          note: block.note ?? null,
          source: "owner",
        })),
      },
    };
  }

  private toUpdateData(
    input: UpsertPostingInput,
    photos: ManagedPostingPhotoInput[] = input.photos,
  ): Prisma.PostingUpdateInput {
    return {
      organization: {
        connect: {
          id: input.organizationId,
        },
      },
      family: input.variant.family,
      subtype: input.variant.subtype,
      name: input.name,
      description: input.description,
      pricingCurrency: input.pricing.currency,
      pricing: input.pricing as Prisma.InputJsonValue,
      tags: input.tags as Prisma.InputJsonValue,
      ...this.toPostingDetailsColumns(input.variant, input.details),
      availabilityStatus: input.availabilityStatus,
      availabilityNotes: input.availabilityNotes ?? null,
      maxBookingDurationDays: input.maxBookingDurationDays ?? null,
      minBookingDurationDays: input.minBookingDurationDays ?? null,
      advanceNoticeDays: input.advanceNoticeDays ?? null,
      cancellationPolicy: input.cancellationPolicy ?? null,
      cancellationPolicyNotes: input.cancellationPolicyNotes ?? null,
      instantBooking: input.instantBooking ?? false,
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      city: input.location.city,
      region: input.location.region,
      country: input.location.country,
      postalCode: input.location.postalCode ?? null,
      photos: {
        deleteMany: {},
        create: photos.map((photo) => ({
          id: randomUUID(),
          blobUrl: photo.blobUrl,
          blobName: photo.blobName,
          thumbnailBlobUrl: photo.thumbnailBlobUrl ?? null,
          thumbnailBlobName: photo.thumbnailBlobName ?? null,
          position: photo.position,
        })),
      },
    };
  }

  private mergePhotosWithExisting(
    existingPhotos: Array<{
      blobUrl: string;
      blobName: string;
      thumbnailBlobUrl: string | null;
      thumbnailBlobName: string | null;
    }>,
    nextPhotos: ManagedPostingPhotoInput[],
  ): ManagedPostingPhotoInput[] {
    const existingByBlobKey = new Map(
      existingPhotos.map((photo) => [
        this.createPhotoBlobKey(photo.blobUrl, photo.blobName),
        photo,
      ]),
    );

    return nextPhotos.map((photo) => {
      if (photo.thumbnailBlobName || photo.thumbnailBlobUrl) {
        return photo;
      }

      const existing = existingByBlobKey.get(
        this.createPhotoBlobKey(photo.blobUrl, photo.blobName),
      );

      if (!existing?.thumbnailBlobName || !existing.thumbnailBlobUrl) {
        return photo;
      }

      return {
        ...photo,
        thumbnailBlobName: existing.thumbnailBlobName,
        thumbnailBlobUrl: existing.thumbnailBlobUrl,
      };
    });
  }

  private createPhotoBlobKey(blobUrl: string, blobName: string): string {
    return `${blobUrl}::${blobName}`;
  }

  private mapAvailabilityBlock(block: {
    id: string;
    startAt: Date;
    endAt: Date;
    note: string | null;
    source?: "owner" | "booking_hold" | "renting";
    bookingRequestHold?: {
      id: string;
      status: string;
      holdExpiresAt: Date | null;
      convertedAt: Date | null;
    } | null;
    createdAt: Date;
    updatedAt: Date;
  }): PostingAvailabilityBlockRecord {
    return {
      id: block.id,
      startAt: block.startAt.toISOString(),
      endAt: block.endAt.toISOString(),
      note: block.note ?? undefined,
      ...(block.source && block.source !== "owner"
        ? { source: block.source }
        : {}),
      ...(block.bookingRequestHold
        ? {
            bookingRequestHold: {
              id: block.bookingRequestHold.id,
              status: block.bookingRequestHold.status,
              holdExpiresAt:
                block.bookingRequestHold.holdExpiresAt?.toISOString(),
              convertedAt: block.bookingRequestHold.convertedAt?.toISOString(),
            },
          }
        : {}),
      createdAt: block.createdAt.toISOString(),
      updatedAt: block.updatedAt.toISOString(),
    };
  }

  private mapPosting(posting: PostingPersistence): PostingRecord {
    const pricing = posting.pricing as PostingPricing;
    const tags = Array.isArray(posting.tags) ? (posting.tags as string[]) : [];
    const details = this.readPostingDetails(posting);
    const now = Date.now();
    const availabilityBlocks = posting.availabilityBlocks
      .filter((block) => {
        if (!block.bookingRequestHold) {
          return true;
        }

        return (
          ["awaiting_payment", "payment_processing", "paid"].includes(
            block.bookingRequestHold.status,
          ) &&
          !block.bookingRequestHold.convertedAt &&
          block.bookingRequestHold.holdExpiresAt.getTime() > now
        );
      })
      .map(
        (block): PostingAvailabilityBlockRecord =>
          this.mapAvailabilityBlock(block),
      );

    return {
      id: posting.id,
      organizationId: posting.organizationId,
      status: posting.status as PostingStatus,
      variant: {
        family: posting.family,
        subtype: posting.subtype as PostingSubtype,
      },
      name: posting.name,
      description: posting.description,
      pricing,
      pricingCurrency: posting.pricingCurrency,
      photos: posting.photos.map(
        (photo): PostingPhotoRecord => ({
          id: photo.id,
          blobUrl: photo.blobUrl,
          blobName: photo.blobName,
          thumbnailBlobUrl: photo.thumbnailBlobUrl ?? undefined,
          thumbnailBlobName: photo.thumbnailBlobName ?? undefined,
          position: photo.position,
          createdAt: photo.createdAt.toISOString(),
          updatedAt: photo.updatedAt.toISOString(),
        }),
      ),
      tags,
      details,
      availabilityStatus:
        posting.availabilityStatus as PostingAvailabilityStatus,
      availabilityNotes: posting.availabilityNotes ?? undefined,
      maxBookingDurationDays: posting.maxBookingDurationDays ?? undefined,
      minBookingDurationDays: posting.minBookingDurationDays ?? undefined,
      advanceNoticeDays: posting.advanceNoticeDays ?? undefined,
      cancellationPolicy:
        (posting.cancellationPolicy as PostingCancellationPolicy) ?? undefined,
      cancellationPolicyNotes: posting.cancellationPolicyNotes ?? undefined,
      instantBooking: posting.instantBooking ?? false,
      averageRating:
        posting.averageRating !== null && posting.averageRating !== undefined
          ? Number(posting.averageRating)
          : undefined,
      reviewCount: posting.reviewCount ?? 0,
      effectiveMaxBookingDurationDays:
        posting.maxBookingDurationDays ?? DEFAULT_MAX_BOOKING_DURATION_DAYS,
      availabilityBlocks,
      location: {
        latitude: posting.latitude,
        longitude: posting.longitude,
        city: posting.city,
        region: posting.region,
        country: posting.country,
        postalCode: posting.postalCode ?? undefined,
      },
      publishedAt: posting.publishedAt?.toISOString(),
      pausedAt: posting.pausedAt?.toISOString(),
      archivedAt: posting.archivedAt?.toISOString(),
      createdAt: posting.createdAt.toISOString(),
      updatedAt: posting.updatedAt.toISOString(),
    };
  }

  private mapPublicPosting(posting: PostingPersistence): PublicPostingRecord {
    const organization = posting.organization
      ? {
          id: posting.organization.id,
          name: posting.organization.name,
        }
      : undefined;

    return {
      ...toPublicPostingRecord(this.mapPosting(posting)),
      organization,
    };
  }

  private mapSearchDocument(
    posting: PostingPersistence,
  ): PostingSearchDocument {
    const details = this.readPostingDetails(posting);

    return {
      id: posting.id,
      organizationId: posting.organizationId,
      status: posting.status as PostingStatus,
      variant: {
        family: posting.family,
        subtype: posting.subtype as PostingSubtype,
      },
      name: posting.name,
      description: posting.description,
      tags: Array.isArray(posting.tags) ? (posting.tags as string[]) : [],
      availabilityStatus:
        posting.availabilityStatus as PostingAvailabilityStatus,
      minBookingDurationDays: posting.minBookingDurationDays ?? undefined,
      advanceNoticeDays: posting.advanceNoticeDays ?? undefined,
      cancellationPolicy:
        (posting.cancellationPolicy as PostingCancellationPolicy) ?? undefined,
      instantBooking: posting.instantBooking ?? false,
      averageRating:
        posting.averageRating !== null && posting.averageRating !== undefined
          ? Number(posting.averageRating)
          : undefined,
      reviewCount: posting.reviewCount ?? 0,
      searchableAttributes: this.extractSearchableAttributes(
        posting.family,
        posting.subtype as PostingSubtype,
        toPostingAttributes(details),
      ),
      pricing: posting.pricing as PostingPricing,
      pricingCurrency: posting.pricingCurrency,
      location: {
        latitude: posting.latitude,
        longitude: posting.longitude,
        city: posting.city,
        region: posting.region,
        country: posting.country,
        postalCode: posting.postalCode ?? undefined,
      },
      photos: posting.photos.map((photo) => ({
        blobUrl: photo.blobUrl,
        position: photo.position,
      })),
      blockedRanges: this.collectBlockedRanges(posting),
      createdAt: posting.createdAt.toISOString(),
      updatedAt: posting.updatedAt.toISOString(),
      publishedAt: posting.publishedAt?.toISOString(),
    };
  }

  private collectBlockedRanges(
    posting: PostingPersistence,
  ): PostingSearchDocument["blockedRanges"] {
    const now = Date.now();

    const availabilityBlockRanges = posting.availabilityBlocks
      .filter((block) => {
        if (!block.bookingRequestHold) {
          return true;
        }

        return (
          ["awaiting_payment", "payment_processing", "paid"].includes(
            block.bookingRequestHold.status,
          ) &&
          !block.bookingRequestHold.convertedAt &&
          block.bookingRequestHold.holdExpiresAt.getTime() > now
        );
      })
      .map((block) => ({
        startAt: block.startAt.toISOString(),
        endAt: block.endAt.toISOString(),
        source: "availability_block" as const,
      }));

    const bookingRequestRanges = posting.bookingRequests
      .filter((bookingRequest) => {
        if (
          ![
            "pending",
            "awaiting_payment",
            "payment_processing",
            "paid",
          ].includes(bookingRequest.status)
        ) {
          return false;
        }

        if (bookingRequest.convertedAt) {
          return false;
        }

        if (bookingRequest.holdExpiresAt.getTime() <= now) {
          return false;
        }

        return (
          !bookingRequest.conversionReservationExpiresAt ||
          bookingRequest.conversionReservationExpiresAt.getTime() <= now
        );
      })
      .map((bookingRequest) => ({
        startAt: bookingRequest.startAt.toISOString(),
        endAt: bookingRequest.endAt.toISOString(),
        source: "booking_request" as const,
      }));

    const rentingRanges = posting.rentings.map((renting) => ({
      startAt: renting.startAt.toISOString(),
      endAt: renting.endAt.toISOString(),
      source: "renting" as const,
    }));

    return [
      ...availabilityBlockRanges,
      ...bookingRequestRanges,
      ...rentingRanges,
    ];
  }

  private extractSearchableAttributes(
    family: PostingRecord["variant"]["family"],
    subtype: PostingRecord["variant"]["subtype"],
    attributes: Record<string, PostingAttributeValue>,
  ): Record<string, PostingAttributeValue> {
    const definitions = getPostingSearchableAttributeDefinitions(
      family,
      subtype,
    );

    if (!definitions) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(attributes).filter(
        ([key]) => definitions[key] !== undefined,
      ),
    );
  }

  private toPostingDetailsColumns(
    variant: PostingVariant,
    details: PostingDetails,
  ): {
    placeDetails: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
    equipmentDetails: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
    vehicleDetails: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  } {
    const normalized = details as Prisma.InputJsonValue;

    switch (variant.family) {
      case "place":
        return {
          placeDetails: normalized,
          equipmentDetails: Prisma.DbNull,
          vehicleDetails: Prisma.DbNull,
        };
      case "equipment":
        return {
          placeDetails: Prisma.DbNull,
          equipmentDetails: normalized,
          vehicleDetails: Prisma.DbNull,
        };
      case "vehicle":
        return {
          placeDetails: Prisma.DbNull,
          equipmentDetails: Prisma.DbNull,
          vehicleDetails: normalized,
        };
    }
  }

  private readPostingDetails(
    posting: Pick<PostingPersistence, "family" | "subtype"> & {
      placeDetails?: unknown;
      equipmentDetails?: unknown;
      vehicleDetails?: unknown;
    },
  ): PostingDetails {
    const variant = {
      family: posting.family,
      subtype: posting.subtype as PostingSubtype,
    } as PostingVariant;

    switch (posting.family) {
      case "place":
        return parsePostingDetailsForVariant(
          variant,
          posting.placeDetails ?? {},
        );
      case "equipment":
        return parsePostingDetailsForVariant(
          variant,
          posting.equipmentDetails ?? {},
        );
      case "vehicle":
        return parsePostingDetailsForVariant(
          variant,
          posting.vehicleDetails ?? {},
        );
    }
  }

  private resolveDetailsColumnName(
    family: SearchPostingsInput["family"],
  ): string {
    switch (family) {
      case "place":
        return "place_details";
      case "equipment":
        return "equipment_details";
      case "vehicle":
        return "vehicle_details";
      default:
        return "place_details";
    }
  }

  private mapOutbox(
    outbox: Prisma.PostingSearchOutboxGetPayload<object>,
    processingAt?: Date,
  ): PostingSearchOutboxRecord {
    return {
      id: outbox.id,
      postingId: outbox.postingId ?? undefined,
      reindexRunId: outbox.reindexRunId ?? undefined,
      operation: outbox.operation,
      dedupeKey: outbox.dedupeKey,
      targetIndexName: outbox.targetIndexName ?? undefined,
      attempts: outbox.attempts,
      publishAttempts: outbox.publishAttempts,
      availableAt: outbox.availableAt.toISOString(),
      processingAt: (
        processingAt ??
        outbox.processingAt ??
        undefined
      )?.toISOString(),
      publishedAt: outbox.processedAt?.toISOString(),
      indexedAt: outbox.indexedAt?.toISOString(),
      deadLetteredAt: outbox.deadLetteredAt?.toISOString(),
      brokerMessageId: outbox.brokerMessageId ?? undefined,
      lastError: outbox.lastError ?? undefined,
      createdAt: outbox.createdAt.toISOString(),
      updatedAt: outbox.updatedAt.toISOString(),
    };
  }

  private mapSearchReindexRun(
    run: Prisma.SearchReindexRunGetPayload<object>,
  ): SearchReindexRunRecord {
    return {
      id: run.id,
      status: run.status as SearchReindexStatus,
      targetIndexName: run.targetIndexName,
      retainedIndexName: run.retainedIndexName ?? undefined,
      sourceSnapshotAt: run.sourceSnapshotAt.toISOString(),
      barrierOutboxId: run.barrierOutboxId ?? undefined,
      totalPostings: run.totalPostings,
      indexedPostings: run.indexedPostings,
      failedPostings: run.failedPostings,
      startedAt: run.startedAt?.toISOString(),
      completedAt: run.completedAt?.toISOString(),
      failedAt: run.failedAt?.toISOString(),
      processingAt: run.processingAt?.toISOString(),
      lastError: run.lastError ?? undefined,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private createPagination(page: number, pageSize: number, total: number) {
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

  private orderBatchResult<TRecord extends { id: string }>(
    ids: string[],
    records: TRecord[],
  ): BatchPostingsResult<TRecord> {
    const byId = new Map(records.map((record) => [record.id, record]));
    const orderedRecords: TRecord[] = [];
    const missingIds: string[] = [];

    for (const id of ids) {
      const record = byId.get(id);

      if (!record) {
        missingIds.push(id);
        continue;
      }

      orderedRecords.push(record);
    }

    return {
      postings: orderedRecords,
      missingIds,
    };
  }

  private readMysqlLockResult(
    value: bigint | number | boolean | null | undefined,
  ): boolean {
    if (typeof value === "bigint") {
      return value === 1n;
    }

    if (typeof value === "number") {
      return value === 1;
    }

    return value === true;
  }

  private readNumberLike(value: bigint | number | null | undefined): number {
    if (typeof value === "bigint") {
      return Number(value);
    }

    if (typeof value === "number") {
      return value;
    }

    return 0;
  }
}
