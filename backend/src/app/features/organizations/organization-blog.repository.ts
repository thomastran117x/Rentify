import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { htmlToPlainText } from "@/configuration/security/html-sanitizer";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  CreateOrganizationBlogPostPersistence,
  ListOrganizationBlogPostsResult,
  OrganizationBlogPostRecord,
  OrganizationBlogSearchDocument,
  OrganizationBlogSearchOutboxRecord,
  OrganizationBlogSort,
  OrganizationBlogStatus,
  UpdateOrganizationBlogPostPersistence,
} from "@/features/organizations/organization-blog.model";
import type {
  SearchOutboxLagMetrics,
  SearchReindexRunRecord,
  SearchReindexStatus,
} from "@/features/search/search.model";

type BlogPostPersistence = Prisma.OrganizationBlogPostGetPayload<{
  include: {
    author: {
      include: {
        profile: true;
      };
    };
  };
}>;

type PublicBlogPostPersistence = Prisma.OrganizationBlogPostGetPayload<{
  include: {
    author: {
      include: {
        profile: true;
      };
    };
    organization: {
      select: {
        id: true;
        name: true;
        logoUrl: true;
      };
    };
  };
}>;

export interface ListOrganizationBlogPostsQueryInput {
  organizationId: string;
  page: number;
  pageSize: number;
  status?: OrganizationBlogStatus;
  statuses?: OrganizationBlogStatus[];
  tag?: string;
}

// Normalized input for the database fallback that backs both the global blog
// feed and the per-organization public feed when Elasticsearch is unavailable.
export interface OrganizationBlogSearchFallbackInput {
  page: number;
  pageSize: number;
  query?: string;
  tag?: string;
  sort?: OrganizationBlogSort;
  organizationId?: string;
}

interface SearchOutboxIdRow {
  id: string;
}

interface SearchIdRow {
  id: string;
}

interface CountRow {
  total?: bigint | number | null;
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

interface SearchReindexCatchUpState {
  state: "waiting" | "caught_up" | "failed";
  errorMessage?: string;
}

const ORGANIZATION_BLOG_SEARCH_REINDEX_START_LOCK_NAME =
  "rentify:organization-blog-search-reindex:start";

export class OrganizationBlogRepository extends BaseRepository {
  async create(
    input: CreateOrganizationBlogPostPersistence,
  ): Promise<OrganizationBlogPostRecord> {
    const row = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const created = await transaction.organizationBlogPost.create({
          data: {
            id: randomUUID(),
            organizationId: input.organizationId,
            authorUserId: input.authorUserId,
            title: input.title,
            slug: input.slug,
            excerpt: input.excerpt,
            body: input.body,
            coverImageUrl: input.coverImageUrl,
            coverImageBlobName: input.coverImageBlobName,
            tags: input.tags,
            status: input.status,
            publishedAt: input.publishedAt,
          },
          include: this.includeAuthor(),
        });

        await this.enqueueSearchOutbox(transaction, created.id, "upsert");

        return created;
      }),
    );

    return this.mapBlogPost(row);
  }

  async update(
    organizationId: string,
    blogPostId: string,
    input: UpdateOrganizationBlogPostPersistence,
  ): Promise<OrganizationBlogPostRecord> {
    const row = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.organizationBlogPost.update({
          where: { id: blogPostId, organizationId },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
            ...(input.body !== undefined ? { body: input.body } : {}),
            ...(input.coverImageUrl !== undefined
              ? { coverImageUrl: input.coverImageUrl }
              : {}),
            ...(input.coverImageBlobName !== undefined
              ? { coverImageBlobName: input.coverImageBlobName }
              : {}),
            ...(input.tags !== undefined ? { tags: input.tags } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.publishedAt !== undefined
              ? { publishedAt: input.publishedAt }
              : {}),
          },
          include: this.includeAuthor(),
        });

        await this.enqueueSearchOutbox(transaction, updated.id, "upsert");

        return updated;
      }),
    );

    return this.mapBlogPost(row);
  }

  async delete(organizationId: string, blogPostId: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        await transaction.organizationBlogPost.delete({
          where: { id: blogPostId, organizationId },
        });

        // Enqueue AFTER the row is gone. `blogPostId` is a plain column (no FK),
        // so the delete signal survives the post's removal.
        await this.enqueueSearchOutbox(transaction, blogPostId, "delete");
      }),
    );
  }

  async findById(
    organizationId: string,
    blogPostId: string,
  ): Promise<OrganizationBlogPostRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.findFirst({
        where: { id: blogPostId, organizationId },
        include: this.includeAuthor(),
      }),
    );

    return row ? this.mapBlogPost(row) : null;
  }

  async findBySlug(
    organizationId: string,
    slug: string,
  ): Promise<OrganizationBlogPostRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.findFirst({
        where: { organizationId, slug },
        include: this.includeAuthor(),
      }),
    );

    return row ? this.mapBlogPost(row) : null;
  }

  async findPublishedBySlug(
    organizationId: string,
    slug: string,
  ): Promise<OrganizationBlogPostRecord | null> {
    const row = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.findFirst({
        where: { organizationId, slug, status: "published" },
        include: this.includeAuthor(),
      }),
    );

    return row ? this.mapBlogPost(row) : null;
  }

  async list(
    input: ListOrganizationBlogPostsQueryInput,
  ): Promise<ListOrganizationBlogPostsResult> {
    const statusFilter = input.status
      ? [input.status]
      : (input.statuses ?? undefined);
    const publishedOnly =
      statusFilter?.length === 1 && statusFilter[0] === "published";
    const where: Prisma.OrganizationBlogPostWhereInput = {
      organizationId: input.organizationId,
      ...(statusFilter ? { status: { in: statusFilter } } : {}),
      ...(input.tag ? { tags: { array_contains: input.tag } } : {}),
    };
    const skip = (input.page - 1) * input.pageSize;

    const [rows, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.organizationBlogPost.findMany({
          where,
          skip,
          take: input.pageSize,
          // Published feeds read best ordered by publish date; drafts have none,
          // so fall back to creation order for management/mixed listings.
          orderBy: publishedOnly
            ? [{ publishedAt: "desc" }, { createdAt: "desc" }]
            : { createdAt: "desc" },
          include: this.includeAuthor(),
        }),
        this.prisma.organizationBlogPost.count({ where }),
      ]),
    );

    return {
      posts: rows.map((row) => this.mapBlogPost(row)),
      pagination: this.createPagination(input.page, input.pageSize, total),
    };
  }

  // Hydrate the public display rows (published only) for the given ids,
  // preserving the order in which they were provided. Includes the author and a
  // minimal organization summary so cross-organization results can be labeled.
  async batchFindPublishedByIds(
    ids: string[],
  ): Promise<OrganizationBlogPostRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.findMany({
        where: {
          id: { in: ids },
          status: "published",
        },
        include: {
          author: {
            include: {
              profile: true,
            },
          },
          organization: {
            select: {
              id: true,
              name: true,
              logoUrl: true,
            },
          },
        },
      }),
    );

    const byId = new Map(
      rows.map((row) => [row.id, this.mapPublicBlogPost(row)]),
    );

    return ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }

  // Database fallback for the public blog feeds. Returns only ordered ids + the
  // total; the caller hydrates via batchFindPublishedByIds. To stay consistent
  // with the Elasticsearch read path, it matches published posts on
  // title/excerpt/body (case-insensitive substring) and filters tags
  // case-insensitively, mirroring the ES query + lowercase-normalized tag term.
  async searchPublicFallback(
    input: OrganizationBlogSearchFallbackInput,
  ): Promise<{ ids: string[]; total: number }> {
    const clauses: Prisma.Sql[] = [Prisma.sql`b.status = 'published'`];

    if (input.organizationId) {
      clauses.push(Prisma.sql`b.organization_id = ${input.organizationId}`);
    }

    if (input.query) {
      const pattern = this.createLikePattern(input.query);
      clauses.push(
        Prisma.sql`(LOWER(b.title) LIKE ${pattern} ESCAPE '\\\\' OR LOWER(b.excerpt) LIKE ${pattern} ESCAPE '\\\\' OR LOWER(b.body) LIKE ${pattern} ESCAPE '\\\\')`,
      );
    }

    if (input.tag) {
      // JSON_SEARCH over a lowercased copy of the tags array gives a
      // case-insensitive exact element match without a data migration.
      clauses.push(
        Prisma.sql`JSON_SEARCH(LOWER(CAST(b.tags AS CHAR)), 'one', ${input.tag
          .trim()
          .toLowerCase()}) IS NOT NULL`,
      );
    }

    const whereSql = Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}`;
    const orderBySql =
      input.sort === "oldest"
        ? Prisma.sql`b.published_at ASC, b.created_at ASC, b.id ASC`
        : Prisma.sql`b.published_at DESC, b.created_at DESC, b.id ASC`;
    const offset = (input.page - 1) * input.pageSize;

    const [rows, countRows] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.$queryRaw<SearchIdRow[]>(Prisma.sql`
          SELECT b.id AS id
          FROM organization_blog_posts b
          ${whereSql}
          ORDER BY ${orderBySql}
          LIMIT ${input.pageSize}
          OFFSET ${offset}
        `),
        this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT COUNT(*) AS total
          FROM organization_blog_posts b
          ${whereSql}
        `),
      ]),
    );

    return {
      ids: rows.map((row) => row.id),
      total: this.readNumberLike(countRows[0]?.total),
    };
  }

  async findByIdsForIndexing(
    ids: string[],
  ): Promise<OrganizationBlogSearchDocument[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.findMany({
        where: {
          id: { in: ids },
        },
      }),
    );

    return rows.map((row) => this.mapSearchDocument(row));
  }

  async listRecentForIndexReconciliation(
    limit: number,
  ): Promise<OrganizationBlogSearchDocument[]> {
    const rows = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.findMany({
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: limit,
      }),
    );

    return rows.map((row) => this.mapSearchDocument(row));
  }

  async countBlogPostsForIndexing(sourceSnapshotAt?: string): Promise<number> {
    const snapshotAt = sourceSnapshotAt
      ? new Date(sourceSnapshotAt)
      : undefined;

    return this.executeAsync(() =>
      this.prisma.organizationBlogPost.count({
        where: snapshotAt ? { updatedAt: { lte: snapshotAt } } : {},
      }),
    );
  }

  async listForIndexingBatch(
    limit: number,
    cursorId?: string,
    sourceSnapshotAt?: string,
  ): Promise<OrganizationBlogSearchDocument[]> {
    const snapshotAt = sourceSnapshotAt
      ? new Date(sourceSnapshotAt)
      : undefined;

    const rows = await this.executeAsync(() =>
      this.prisma.organizationBlogPost.findMany({
        where: snapshotAt ? { updatedAt: { lte: snapshotAt } } : {},
        orderBy: { id: "asc" },
        take: limit,
        ...(cursorId
          ? {
              cursor: { id: cursorId },
              skip: 1,
            }
          : {}),
      }),
    );

    return rows.map((row) => this.mapSearchDocument(row));
  }

  async claimSearchOutboxBatch(
    limit: number,
  ): Promise<OrganizationBlogSearchOutboxRecord[]> {
    return this.executeAsync(async () => {
      const now = new Date();
      const staleProcessingThreshold = new Date(now.getTime() - 5 * 60 * 1000);
      const claimedRows = await this.prisma.$transaction(
        async (transaction) => {
          const idRows = await transaction.$queryRaw<SearchOutboxIdRow[]>(
            Prisma.sql`
            SELECT id
            FROM organization_blog_search_outbox
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

          await transaction.organizationBlogSearchOutbox.updateMany({
            where: { id: { in: ids } },
            data: { processingAt: now },
          });

          const rows = await transaction.organizationBlogSearchOutbox.findMany({
            where: { id: { in: ids } },
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
      this.prisma.organizationBlogSearchOutbox.update({
        where: { id },
        data: { indexedAt: new Date(), lastError: null },
      }),
    );
  }

  async markSearchOutboxesIndexed(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.executeAsync(() =>
      this.prisma.organizationBlogSearchOutbox.updateMany({
        where: { id: { in: ids } },
        data: { indexedAt: new Date(), lastError: null },
      }),
    );
  }

  async incrementSearchOutboxAttempt(
    id: string,
    errorMessage: string,
  ): Promise<number> {
    const updated = await this.executeAsync(() =>
      this.prisma.organizationBlogSearchOutbox.update({
        where: { id },
        data: {
          attempts: { increment: 1 },
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
      this.prisma.organizationBlogSearchOutbox.update({
        where: { id },
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
      this.prisma.organizationBlogSearchOutbox.update({
        where: { id },
        data: {
          publishAttempts: { increment: 1 },
          processingAt: null,
          availableAt: new Date(Date.now() + backoffSeconds * 1000),
          lastError: errorMessage.slice(0, 2048),
        },
      }),
    );
  }

  async getSearchOutboxById(
    id: string,
  ): Promise<OrganizationBlogSearchOutboxRecord | null> {
    const outbox = await this.executeAsync(() =>
      this.prisma.organizationBlogSearchOutbox.findUnique({
        where: { id },
      }),
    );

    return outbox ? this.mapSearchOutbox(outbox) : null;
  }

  async getSearchOutboxesByIds(
    ids: string[],
  ): Promise<OrganizationBlogSearchOutboxRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.executeAsync(() =>
      this.prisma.organizationBlogSearchOutbox.findMany({
        where: { id: { in: ids } },
      }),
    );
    const byId = new Map(rows.map((row) => [row.id, this.mapSearchOutbox(row)]));

    return ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }

  async hasNewerSearchOutboxJob(
    job: Pick<
      OrganizationBlogSearchOutboxRecord,
      "id" | "blogPostId" | "reindexRunId" | "targetIndexName" | "createdAt"
    >,
  ): Promise<boolean> {
    if (!job.blogPostId) {
      return false;
    }

    const count = await this.executeAsync(() =>
      this.prisma.organizationBlogSearchOutbox.count({
        where: {
          blogPostId: job.blogPostId,
          reindexRunId: job.reindexRunId ?? null,
          targetIndexName: job.targetIndexName ?? null,
          deadLetteredAt: null,
          id: { not: job.id },
          createdAt: { gt: new Date(job.createdAt) },
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
        await transaction.organizationBlogSearchOutbox.update({
          where: { id },
          data: {
            processedAt: now,
            processingAt: null,
            brokerMessageId: brokerMessageId ?? null,
            lastError: null,
          },
        });

        if (supersededIds.length > 0) {
          await transaction.organizationBlogSearchOutbox.updateMany({
            where: { id: { in: supersededIds } },
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
      this.prisma.organizationBlogSearchOutbox.updateMany({
        where: {
          id: { in: ids },
          indexedAt: null,
          deadLetteredAt: null,
        },
        data: {
          processingAt: null,
          ...(errorMessage !== undefined
            ? { lastError: errorMessage.slice(0, 2048) }
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
        const rows = await transaction.organizationBlogSearchOutbox.findMany({
          where: {
            deadLetteredAt: { not: null },
            operation: { in: ["upsert", "delete"] },
          },
          orderBy: [{ deadLetteredAt: "asc" }, { createdAt: "asc" }],
          take: limit,
          select: { id: true },
        });
        const ids = rows.map((row) => row.id);

        if (ids.length === 0) {
          return 0;
        }

        await transaction.organizationBlogSearchOutbox.updateMany({
          where: { id: { in: ids } },
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
        FROM organization_blog_search_outbox
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
      this.prisma.organizationBlogSearchReindexRun.create({
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
      this.prisma.organizationBlogSearchReindexRun.findUnique({
        where: { id },
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async findActiveSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationBlogSearchReindexRun.findFirst({
        where: {
          status: { in: ["pending", "running", "waiting_for_catchup"] },
        },
        orderBy: [{ createdAt: "desc" }],
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async findLatestSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationBlogSearchReindexRun.findFirst({
        orderBy: [{ createdAt: "desc" }],
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async findLatestCompletedSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationBlogSearchReindexRun.findFirst({
        where: { status: "completed" },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      }),
    );

    return run ? this.mapSearchReindexRun(run) : null;
  }

  async listCompletedSearchReindexRunsWithRetainedIndices(): Promise<
    SearchReindexRunRecord[]
  > {
    const runs = await this.executeAsync(() =>
      this.prisma.organizationBlogSearchReindexRun.findMany({
        where: {
          status: "completed",
          retainedIndexName: { not: null },
        },
        orderBy: [{ completedAt: "asc" }, { createdAt: "asc" }],
      }),
    );

    return runs.map((run) => this.mapSearchReindexRun(run));
  }

  async claimNextSearchReindexRun(): Promise<SearchReindexRunRecord | null> {
    return this.executeAsync(async () => {
      const now = new Date();
      const staleProcessingThreshold = new Date(now.getTime() - 5 * 60 * 1000);
      const candidate =
        await this.prisma.organizationBlogSearchReindexRun.findFirst({
          where: {
            status: { in: ["pending", "running", "waiting_for_catchup"] },
            OR: [
              { processingAt: null },
              { processingAt: { lt: staleProcessingThreshold } },
            ],
          },
          orderBy: [{ createdAt: "asc" }],
        });

      if (!candidate) {
        return null;
      }

      const result =
        await this.prisma.organizationBlogSearchReindexRun.updateMany({
          where: {
            id: candidate.id,
            OR: [
              { processingAt: null },
              { processingAt: { lt: staleProcessingThreshold } },
            ],
          },
          data: { processingAt: now },
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
      this.prisma.organizationBlogSearchReindexRun.update({
        where: { id },
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
      this.prisma.organizationBlogSearchReindexRun.update({
        where: { id },
        data: {
          indexedDocuments: input.indexedDocuments,
          ...(input.failedDocuments !== undefined
            ? { failedDocuments: input.failedDocuments }
            : {}),
        },
      }),
    );
  }

  async enqueueSearchReindexBarrier(
    reindexRunId: string,
    targetIndexName: string,
  ): Promise<OrganizationBlogSearchOutboxRecord> {
    return this.executeAsync(async () =>
      this.prisma.$transaction(async (transaction) => {
        const barrierId = randomUUID();

        const created = await transaction.organizationBlogSearchOutbox.create({
          data: {
            id: barrierId,
            reindexRunId,
            operation: "barrier",
            dedupeKey: barrierId,
            targetIndexName,
          },
        });

        await transaction.organizationBlogSearchReindexRun.update({
          where: { id: reindexRunId },
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
      const run = await this.prisma.organizationBlogSearchReindexRun.findUnique({
        where: { id },
        select: { barrierOutboxId: true },
      });

      if (!run?.barrierOutboxId) {
        return {
          state: "failed",
          errorMessage:
            "Search reindex run is missing its barrier outbox reference.",
        };
      }

      const barrier = await this.prisma.organizationBlogSearchOutbox.findUnique({
        where: { id: run.barrierOutboxId },
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
        return { state: "waiting" };
      }

      const remaining = await this.prisma.organizationBlogSearchOutbox.count({
        where: {
          reindexRunId: id,
          deadLetteredAt: null,
          indexedAt: null,
          createdAt: { lte: barrier.createdAt },
        },
      });

      return remaining === 0 ? { state: "caught_up" } : { state: "waiting" };
    });
  }

  async markSearchReindexRunCompleted(
    id: string,
    retainedIndexName?: string,
  ): Promise<SearchReindexRunRecord> {
    const run = await this.executeAsync(() =>
      this.prisma.organizationBlogSearchReindexRun.update({
        where: { id },
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
      this.prisma.organizationBlogSearchReindexRun.update({
        where: { id },
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
      this.prisma.organizationBlogSearchReindexRun.update({
        where: { id },
        data: { processingAt: new Date() },
      }),
    );
  }

  async clearSearchReindexRunProcessing(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationBlogSearchReindexRun.update({
        where: { id },
        data: { processingAt: null },
      }),
    );
  }

  async clearSearchReindexRunRetainedIndexName(id: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.organizationBlogSearchReindexRun.update({
        where: { id },
        data: { retainedIndexName: null },
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
            Prisma.sql`SELECT GET_LOCK(${ORGANIZATION_BLOG_SEARCH_REINDEX_START_LOCK_NAME}, 0) AS acquired`,
          );
          const acquired = this.readMysqlLockResult(lockRows[0]?.acquired);

          if (!acquired) {
            return null;
          }

          try {
            return await operation({
              findActiveSearchReindexRun: async () => {
                const run =
                  await transaction.organizationBlogSearchReindexRun.findFirst({
                    where: {
                      status: {
                        in: ["pending", "running", "waiting_for_catchup"],
                      },
                    },
                    orderBy: [{ createdAt: "desc" }],
                  });

                return run ? this.mapSearchReindexRun(run) : null;
              },
              createSearchReindexRun: async (targetIndexName: string) => {
                const run =
                  await transaction.organizationBlogSearchReindexRun.create({
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
              Prisma.sql`SELECT RELEASE_LOCK(${ORGANIZATION_BLOG_SEARCH_REINDEX_START_LOCK_NAME}) AS released`,
            );
          }
        }),
      {
        operationName: "withOrganizationBlogSearchReindexStartLock",
      },
    );
  }

  private async enqueueSearchOutbox(
    transaction: Prisma.TransactionClient,
    blogPostId: string,
    operation: "upsert" | "delete",
  ): Promise<void> {
    const activeRun =
      await transaction.organizationBlogSearchReindexRun.findFirst({
        where: {
          status: { in: ["pending", "running", "waiting_for_catchup"] },
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          targetIndexName: true,
        },
      });
    const primaryEventId = randomUUID();
    const entries: Prisma.OrganizationBlogSearchOutboxCreateManyInput[] = [
      {
        id: primaryEventId,
        blogPostId,
        operation,
        dedupeKey: primaryEventId,
      },
    ];

    if (activeRun) {
      const secondaryEventId = randomUUID();
      entries.push({
        id: secondaryEventId,
        blogPostId,
        reindexRunId: activeRun.id,
        operation,
        dedupeKey: secondaryEventId,
        targetIndexName: activeRun.targetIndexName,
      });
    }

    await transaction.organizationBlogSearchOutbox.createMany({
      data: entries,
    });
  }

  private includeAuthor() {
    return {
      author: {
        include: {
          profile: true,
        },
      },
    } satisfies Prisma.OrganizationBlogPostInclude;
  }

  private mapBlogPost(row: BlogPostPersistence): OrganizationBlogPostRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      author: this.mapAuthor(row.author),
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt ?? undefined,
      body: row.body,
      coverImageUrl: row.coverImageUrl ?? undefined,
      coverImageBlobName: row.coverImageBlobName ?? undefined,
      tags: this.parseTags(row.tags),
      status: row.status as OrganizationBlogStatus,
      publishedAt: row.publishedAt?.toISOString() ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapPublicBlogPost(
    row: PublicBlogPostPersistence,
  ): OrganizationBlogPostRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      organization: {
        id: row.organization.id,
        name: row.organization.name,
        logoUrl: row.organization.logoUrl ?? undefined,
      },
      author: this.mapAuthor(row.author),
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt ?? undefined,
      // The list UI only needs the body to show a reading-time estimate, so we
      // precompute it here and omit the (potentially large) body from list
      // payloads. Single-post reads use mapBlogPost, which keeps the full body.
      body: "",
      readingMinutes: this.estimateReadingMinutes(row.body),
      coverImageUrl: row.coverImageUrl ?? undefined,
      coverImageBlobName: row.coverImageBlobName ?? undefined,
      tags: this.parseTags(row.tags),
      status: row.status as OrganizationBlogStatus,
      publishedAt: row.publishedAt?.toISOString() ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // Rough reading-time estimate (minutes) at ~200 words per minute, from the
  // sanitized HTML body. Mirrors the client's readingTimeMinutes heuristic.
  private estimateReadingMinutes(html: string): number {
    const plain = htmlToPlainText(html);
    const words = plain ? plain.split(/\s+/).filter(Boolean).length : 0;
    return Math.max(1, Math.round(words / 200));
  }

  private mapAuthor(author: BlogPostPersistence["author"]) {
    return author
      ? {
          id: author.id,
          email: author.email,
          username: author.profile?.username ?? author.email,
          avatarUrl: author.profile?.avatarUrl ?? undefined,
        }
      : undefined;
  }

  private mapSearchDocument(
    row: Prisma.OrganizationBlogPostGetPayload<object>,
  ): OrganizationBlogSearchDocument {
    return {
      id: row.id,
      organizationId: row.organizationId,
      title: row.title,
      excerpt: row.excerpt ?? null,
      body: htmlToPlainText(row.body),
      tags: this.parseTags(row.tags),
      status: row.status as OrganizationBlogStatus,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapSearchOutbox(
    outbox: Prisma.OrganizationBlogSearchOutboxGetPayload<object>,
    processingAt?: Date,
  ): OrganizationBlogSearchOutboxRecord {
    return {
      id: outbox.id,
      blogPostId: outbox.blogPostId ?? undefined,
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
    run: Prisma.OrganizationBlogSearchReindexRunGetPayload<object>,
  ): SearchReindexRunRecord {
    return {
      id: run.id,
      status: run.status as SearchReindexStatus,
      targetIndexName: run.targetIndexName,
      retainedIndexName: run.retainedIndexName ?? undefined,
      sourceSnapshotAt: run.sourceSnapshotAt.toISOString(),
      barrierOutboxId: run.barrierOutboxId ?? undefined,
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

  private parseTags(value: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((entry): entry is string => typeof entry === "string");
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

  private readNumberLike(value: bigint | number | null | undefined): number {
    if (typeof value === "bigint") {
      return Number(value);
    }

    return typeof value === "number" ? value : 0;
  }

  // Builds a lowercased, wildcard-escaped LIKE pattern for case-insensitive
  // substring matching (paired with LOWER(column) ... ESCAPE '\\').
  private createLikePattern(query: string): string {
    const escaped = query
      .trim()
      .toLowerCase()
      .replace(/[\\%_]/g, "\\$&");
    return `%${escaped}%`;
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
