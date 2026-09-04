import { Prisma } from "@/generated/prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  OrganizationSearchDocument,
  OrganizationSearchOutboxRecord,
} from "@/features/organizations/organizations.model";
import type {
  SearchOutboxLagMetrics,
  SearchReindexRunRecord,
  SearchReindexStatus,
} from "@/features/search/search.model";
import {
  asOptionalUuid,
  asUuid,
  newUuid,
  type Uuid,
} from "@/configuration/validation/uuid";

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

type OrganizationSearchDocumentRow = {
  id: string;
  name: string;
  description: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const ORGANIZATION_SEARCH_REINDEX_START_LOCK_NAME =
  "rentify:organization-search-reindex:start";

export class OrganizationsSearchRepository extends BaseRepository {
  async findByIdsForIndexing(
    ids: string[],
  ): Promise<OrganizationSearchDocument[]> {
    if (ids.length === 0) {
      return [];
    }

    const organizations = await this.executeAsync(() =>
      this.prisma.organization.findMany({
        where: {
          id: {
            in: ids,
          },
        },
      }),
    );

    return organizations.map((organization) =>
      this.mapSearchDocument(organization),
    );
  }

  async listRecentForIndexReconciliation(
    limit: number,
  ): Promise<OrganizationSearchDocument[]> {
    const organizations = await this.executeAsync(() =>
      this.prisma.organization.findMany({
        orderBy: [
          {
            updatedAt: "desc",
          },
          {
            id: "asc",
          },
        ],
        take: limit,
      }),
    );

    return organizations.map((organization) =>
      this.mapSearchDocument(organization),
    );
  }

  async countOrganizationsForIndexing(
    sourceSnapshotAt?: string,
  ): Promise<number> {
    const snapshotAt = sourceSnapshotAt
      ? new Date(sourceSnapshotAt)
      : undefined;

    return this.executeAsync(() =>
      this.prisma.organization.count({
        where: snapshotAt
          ? {
              updatedAt: {
                lte: snapshotAt,
              },
            }
          : {},
      }),
    );
  }

  async listForIndexingBatch(
    limit: number,
    cursorId?: string,
    sourceSnapshotAt?: string,
  ): Promise<OrganizationSearchDocument[]> {
    const snapshotAt = sourceSnapshotAt
      ? new Date(sourceSnapshotAt)
      : undefined;

    const organizations = await this.executeAsync(() =>
      this.prisma.organization.findMany({
        where: snapshotAt
          ? {
              updatedAt: {
                lte: snapshotAt,
              },
            }
          : {},
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
      }),
    );

    return organizations.map((organization) =>
      this.mapSearchDocument(organization),
    );
  }

  async claimSearchOutboxBatch(
    limit: number,
  ): Promise<OrganizationSearchOutboxRecord[]> {
    return this.executeAsync(async () => {
      const now = new Date();
      const staleProcessingThreshold = new Date(now.getTime() - 5 * 60 * 1000);
      const claimedRows = await this.prisma.$transaction(
        async (transaction) => {
          const idRows = await transaction.$queryRaw<SearchOutboxIdRow[]>(
            Prisma.sql`
            SELECT id
            FROM organization_search_outbox
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

          await transaction.organizationSearchOutbox.updateMany({
            where: {
              id: {
                in: ids,
              },
            },
            data: {
              processingAt: now,
            },
          });

          const rows = await transaction.organizationSearchOutbox.findMany({
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

      return claimedRows.map((row) => this.mapSearchOutbox(row, now));
    });
  }

  async markSearchOutboxIndexed(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.update({
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

  async markSearchOutboxesIndexed(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.updateMany({
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

  async incrementSearchOutboxAttempt(
    id: string,
    errorMessage: string,
  ): Promise<number> {
    const updated = await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.update({
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
      this.prisma.organizationSearchOutbox.update({
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

  async markSearchOutboxPublishRetry(
    id: string,
    attempts: number,
    errorMessage: string,
  ): Promise<void> {
    const backoffSeconds = Math.min(300, 2 ** Math.min(attempts, 8));
    await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.update({
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

  async getSearchOutboxById(
    id: string,
  ): Promise<OrganizationSearchOutboxRecord | null> {
    const outbox = await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.findUnique({
        where: {
          id,
        },
      }),
    );

    return outbox ? this.mapSearchOutbox(outbox) : null;
  }

  async getSearchOutboxesByIds(
    ids: string[],
  ): Promise<OrganizationSearchOutboxRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.findMany({
        where: {
          id: {
            in: ids,
          },
        },
      }),
    );
    const byId = new Map(
      rows.map((row) => [row.id, this.mapSearchOutbox(row)]),
    );

    return ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }

  async hasNewerSearchOutboxJob(
    job: Pick<
      OrganizationSearchOutboxRecord,
      "id" | "organizationId" | "reindexRunId" | "targetIndexName" | "createdAt"
    >,
  ): Promise<boolean> {
    if (!job.organizationId) {
      return false;
    }

    const count = await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.count({
        where: {
          organizationId: job.organizationId,
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

  async markSearchOutboxRelayed(
    id: string,
    supersededIds: string[],
    brokerMessageId?: string,
  ): Promise<void> {
    const now = new Date();

    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        await transaction.organizationSearchOutbox.update({
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
          await transaction.organizationSearchOutbox.updateMany({
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

  async releaseSearchOutboxClaims(
    ids: string[],
    errorMessage?: string,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.executeAsync(() =>
      this.prisma.organizationSearchOutbox.updateMany({
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
        const rows = await transaction.organizationSearchOutbox.findMany({
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

        await transaction.organizationSearchOutbox.updateMany({
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
        FROM organization_search_outbox
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

  async createSearchReindexRun(
    targetIndexName: string,
  ): Promise<SearchReindexRunRecord> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.create({
        data: {
          id: newUuid(),
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
      this.prisma.organizationSearchReindexRun.findUnique({
        where: {
          id,
        },
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async findActiveSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.findFirst({
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
      this.prisma.organizationSearchReindexRun.findFirst({
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
      this.prisma.organizationSearchReindexRun.findFirst({
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
      this.prisma.organizationSearchReindexRun.findMany({
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
      const candidate =
        await this.prisma.organizationSearchReindexRun.findFirst({
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

      const result = await this.prisma.organizationSearchReindexRun.updateMany({
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
    totalDocuments: number,
  ): Promise<SearchReindexRunRecord> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.update({
        where: {
          id,
        },
        data: {
          status: "running",
          totalDocuments,
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
      indexedDocuments: number;
      failedDocuments?: number;
    },
  ): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.update({
        where: {
          id,
        },
        data: {
          indexedDocuments: input.indexedDocuments,
          ...(input.failedDocuments !== undefined
            ? {
                failedDocuments: input.failedDocuments,
              }
            : {}),
        },
      }),
    );
  }

  async enqueueSearchReindexBarrier(
    reindexRunId: Uuid,
    targetIndexName: string,
  ): Promise<OrganizationSearchOutboxRecord> {
    return this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const barrierId = newUuid();

        const created = await transaction.organizationSearchOutbox.create({
          data: {
            id: barrierId,
            reindexRunId,
            operation: "barrier",
            dedupeKey: barrierId,
            targetIndexName,
          },
        });

        await transaction.organizationSearchReindexRun.update({
          where: {
            id: reindexRunId,
          },
          data: {
            status: "waiting_for_catchup",
            barrierOutboxId: barrierId,
            processingAt: null,
          },
        });

        return this.mapSearchOutbox(created);
      }),
    );
  }

  async getSearchReindexCatchUpState(
    id: string,
  ): Promise<SearchReindexCatchUpState> {
    return this.executeAsync(async () => {
      const run = await this.prisma.organizationSearchReindexRun.findUnique({
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

      const barrier = await this.prisma.organizationSearchOutbox.findUnique({
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

      const remaining = await this.prisma.organizationSearchOutbox.count({
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
      this.prisma.organizationSearchReindexRun.update({
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
      this.prisma.organizationSearchReindexRun.update({
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

  async touchSearchReindexRunProcessing(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationSearchReindexRun.update({
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
      this.prisma.organizationSearchReindexRun.update({
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
      this.prisma.organizationSearchReindexRun.update({
        where: {
          id,
        },
        data: {
          retainedIndexName: null,
        },
      }),
    );
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
            Prisma.sql`SELECT GET_LOCK(${ORGANIZATION_SEARCH_REINDEX_START_LOCK_NAME}, 0) AS acquired`,
          );
          const acquired = this.readMysqlLockResult(lockRows[0]?.acquired);

          if (!acquired) {
            return null;
          }

          try {
            return await operation({
              findActiveSearchReindexRun: async () => {
                const run =
                  await transaction.organizationSearchReindexRun.findFirst({
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
                const run =
                  await transaction.organizationSearchReindexRun.create({
                    data: {
                      id: newUuid(),
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
              Prisma.sql`SELECT RELEASE_LOCK(${ORGANIZATION_SEARCH_REINDEX_START_LOCK_NAME}) AS released`,
            );
          }
        }),
      {
        operationName: "withOrganizationSearchReindexStartLock",
      },
    );
  }

  private mapSearchDocument(
    organization: OrganizationSearchDocumentRow,
  ): OrganizationSearchDocument {
    return {
      id: asUuid(organization.id),
      name: organization.name,
      description: organization.description,
      city: organization.city,
      region: organization.region,
      country: organization.country,
      postalCode: organization.postalCode ?? null,
      createdAt: new Date(organization.createdAt).toISOString(),
      updatedAt: new Date(organization.updatedAt).toISOString(),
    };
  }

  private mapSearchOutbox(
    outbox: Prisma.OrganizationSearchOutboxGetPayload<object>,
    processingAt?: Date,
  ): OrganizationSearchOutboxRecord {
    return {
      id: asUuid(outbox.id),
      organizationId: asOptionalUuid(outbox.organizationId),
      reindexRunId: asOptionalUuid(outbox.reindexRunId),
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
    run: Prisma.OrganizationSearchReindexRunGetPayload<object>,
  ): SearchReindexRunRecord {
    return {
      id: asUuid(run.id),
      status: run.status as SearchReindexStatus,
      targetIndexName: run.targetIndexName,
      retainedIndexName: run.retainedIndexName ?? undefined,
      sourceSnapshotAt: run.sourceSnapshotAt.toISOString(),
      barrierOutboxId: asOptionalUuid(run.barrierOutboxId),
      totalPostings: run.totalDocuments,
      indexedPostings: run.indexedDocuments,
      failedPostings: run.failedDocuments,
      startedAt: run.startedAt?.toISOString(),
      completedAt: run.completedAt?.toISOString(),
      failedAt: run.failedAt?.toISOString(),
      processingAt: run.processingAt?.toISOString(),
      lastError: run.lastError ?? undefined,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private readNumberLike(value: bigint | number | null | undefined): number {
    if (typeof value === "bigint") {
      return Number(value);
    }

    return typeof value === "number" ? value : 0;
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
}
