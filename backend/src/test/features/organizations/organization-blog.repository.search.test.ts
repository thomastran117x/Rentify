import { OrganizationBlogRepository } from "@/features/organizations/organization-blog.repository";

function sqlText(arg: unknown): string {
  const value = arg as { strings?: string[]; text?: string };
  if (value?.strings) {
    return value.strings.join(" ");
  }
  return value?.text ?? String(arg);
}

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-1",
    blogPostId: "post-1",
    reindexRunId: null,
    operation: "upsert",
    dedupeKey: "outbox-1",
    targetIndexName: null,
    attempts: 0,
    publishAttempts: 0,
    availableAt: new Date("2026-05-01T00:00:00.000Z"),
    processingAt: null,
    processedAt: null,
    indexedAt: null,
    deadLetteredAt: null,
    brokerMessageId: null,
    lastError: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...overrides,
  };
}

function reindexRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "reindex-1",
    status: "pending",
    targetIndexName: "organization-blogs_v1",
    retainedIndexName: null,
    sourceSnapshotAt: new Date("2026-05-01T00:00:00.000Z"),
    barrierOutboxId: null,
    totalDocuments: 0,
    indexedDocuments: 0,
    failedDocuments: 0,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    processingAt: null,
    lastError: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...overrides,
  };
}

function blogPostRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: `org-${id}`,
    authorUserId: "user-1",
    title: `Post ${id}`,
    slug: `post-${id}`,
    excerpt: "Excerpt",
    body: "<p>Body <b>text</b></p>",
    coverImageUrl: null,
    coverImageBlobName: null,
    tags: ["news", "guides"],
    status: "published",
    publishedAt: new Date("2026-05-01T00:00:00.000Z"),
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    ...overrides,
  };
}

function publicBlogPostRow(id: string) {
  return {
    ...blogPostRow(id),
    author: {
      id: "user-1",
      email: "author@example.com",
      profile: { username: "author-one", avatarUrl: null },
    },
    organization: { id: `org-${id}`, name: `Org ${id}`, logoUrl: null },
  };
}

function createDb(config?: {
  queryRaw?: (text: string) => unknown;
  blogPost?: Record<string, jest.Mock>;
  outbox?: Record<string, jest.Mock>;
  reindexRun?: Record<string, jest.Mock>;
}) {
  const db: Record<string, unknown> = {
    $queryRaw: jest.fn(async (arg: unknown) =>
      config?.queryRaw ? config.queryRaw(sqlText(arg)) : [],
    ),
    organizationBlogPost: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      ...config?.blogPost,
    },
    organizationBlogSearchOutbox: {
      update: jest.fn(async () => outboxRow()),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUnique: jest.fn(async () => outboxRow()),
      findMany: jest.fn(async () => [outboxRow()]),
      count: jest.fn(async () => 0),
      create: jest.fn(async () => outboxRow()),
      createMany: jest.fn(async () => ({ count: 1 })),
      ...config?.outbox,
    },
    organizationBlogSearchReindexRun: {
      create: jest.fn(async () => reindexRunRow()),
      findUnique: jest.fn(async () => reindexRunRow()),
      findFirst: jest.fn(async () => reindexRunRow()),
      findMany: jest.fn(async () => [reindexRunRow()]),
      update: jest.fn(async () => reindexRunRow()),
      updateMany: jest.fn(async () => ({ count: 1 })),
      ...config?.reindexRun,
    },
  };
  db.$transaction = jest.fn(async (cb: unknown) =>
    typeof cb === "function" ? (cb as (client: unknown) => unknown)(db) : cb,
  );
  return db;
}

function repoWith(db: Record<string, unknown>) {
  return new OrganizationBlogRepository(db as any);
}

describe("OrganizationBlogRepository search methods", () => {
  describe("indexing sources", () => {
    it("maps blog posts to search documents by id (body as plain text)", async () => {
      const db = createDb({
        blogPost: { findMany: jest.fn(async () => [blogPostRow("post-1")]) },
      });
      const docs = await repoWith(db).findByIdsForIndexing(["post-1"]);
      expect(docs[0]).toEqual(
        expect.objectContaining({
          id: "post-1",
          organizationId: "org-post-1",
          title: "Post post-1",
          status: "published",
          publishedAt: "2026-05-01T00:00:00.000Z",
        }),
      );
      // HTML is stripped for indexing.
      expect(docs[0]?.body).not.toContain("<");
      expect(docs[0]?.body).toContain("Body");
    });

    it("short-circuits indexing lookups for empty id lists", async () => {
      const db = createDb();
      expect(await repoWith(db).findByIdsForIndexing([])).toEqual([]);
      expect(
        (db.organizationBlogPost as { findMany: jest.Mock }).findMany,
      ).not.toHaveBeenCalled();
    });

    it("lists recent blog posts for reconciliation", async () => {
      const db = createDb({
        blogPost: { findMany: jest.fn(async () => [blogPostRow("post-2")]) },
      });
      const docs = await repoWith(db).listRecentForIndexReconciliation(10);
      expect(docs[0]?.id).toBe("post-2");
    });

    it("counts blog posts for indexing with and without a snapshot", async () => {
      const count = jest.fn(async () => 7);
      const db = createDb({ blogPost: { count } });
      const repo = repoWith(db);
      expect(await repo.countBlogPostsForIndexing()).toBe(7);
      expect(
        await repo.countBlogPostsForIndexing("2026-05-01T00:00:00.000Z"),
      ).toBe(7);
      expect(count).toHaveBeenLastCalledWith({
        where: { updatedAt: { lte: new Date("2026-05-01T00:00:00.000Z") } },
      });
    });

    it("lists indexing batches with and without a cursor", async () => {
      const findMany = jest.fn(async () => [blogPostRow("post-3")]);
      const db = createDb({ blogPost: { findMany } });
      const repo = repoWith(db);
      await repo.listForIndexingBatch(50);
      await repo.listForIndexingBatch(50, "post-2", "2026-05-01T00:00:00.000Z");
      expect(findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: { id: "post-2" }, skip: 1 }),
      );
    });
  });

  describe("public feed fallback and hydration", () => {
    it("returns ordered ids and a total for a query", async () => {
      const db = createDb({
        blogPost: {
          findMany: jest.fn(async () => [{ id: "post-1" }, { id: "post-2" }]),
          count: jest.fn(async () => 2),
        },
      });
      const result = await repoWith(db).searchPublicFallback({
        page: 1,
        pageSize: 20,
        query: "weekend",
        sort: "newest",
      });
      expect(result).toEqual({ ids: ["post-1", "post-2"], total: 2 });
    });

    it("scopes the fallback to an organization and supports oldest sort", async () => {
      const findMany = jest.fn(async () => []);
      const db = createDb({ blogPost: { findMany, count: jest.fn(async () => 0) } });
      await repoWith(db).searchPublicFallback({
        page: 1,
        pageSize: 20,
        organizationId: "org-9",
        tag: "news",
        sort: "oldest",
      });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "published",
            organizationId: "org-9",
            tags: { array_contains: "news" },
          }),
          orderBy: [
            { publishedAt: "asc" },
            { createdAt: "asc" },
            { id: "asc" },
          ],
        }),
      );
    });

    it("hydrates published rows by id, preserving order", async () => {
      const db = createDb({
        blogPost: {
          findMany: jest.fn(async () => [
            publicBlogPostRow("post-2"),
            publicBlogPostRow("post-1"),
          ]),
        },
      });
      const rows = await repoWith(db).batchFindPublishedByIds([
        "post-1",
        "post-2",
      ]);
      expect(rows.map((row) => row.id)).toEqual(["post-1", "post-2"]);
      expect(rows[0]?.organization?.name).toBe("Org post-1");
      expect(rows[0]?.author?.username).toBe("author-one");
    });

    it("returns an empty hydration for empty id lists", async () => {
      const db = createDb();
      expect(await repoWith(db).batchFindPublishedByIds([])).toEqual([]);
    });
  });

  describe("outbox lifecycle", () => {
    it("claims a batch of pending outbox rows", async () => {
      const db = createDb({
        queryRaw: (text) => (text.includes("SELECT id") ? [{ id: "o1" }] : []),
        outbox: { findMany: jest.fn(async () => [outboxRow({ id: "o1" })]) },
      });
      const claimed = await repoWith(db).claimSearchOutboxBatch(10);
      expect(claimed[0]?.id).toBe("o1");
      expect(
        (db.organizationBlogSearchOutbox as { updateMany: jest.Mock })
          .updateMany,
      ).toHaveBeenCalled();
    });

    it("returns nothing when there are no claimable rows", async () => {
      const db = createDb({ queryRaw: () => [] });
      expect(await repoWith(db).claimSearchOutboxBatch(10)).toEqual([]);
    });

    it("marks outbox rows indexed individually and in bulk", async () => {
      const db = createDb();
      const repo = repoWith(db);
      await repo.markSearchOutboxIndexed("outbox-1");
      await repo.markSearchOutboxesIndexed(["a", "b"]);
      await repo.markSearchOutboxesIndexed([]);
      const outbox = db.organizationBlogSearchOutbox as {
        update: jest.Mock;
        updateMany: jest.Mock;
      };
      expect(outbox.update).toHaveBeenCalledTimes(1);
      expect(outbox.updateMany).toHaveBeenCalledTimes(1);
    });

    it("increments attempts, dead-letters, and schedules publish retries", async () => {
      const db = createDb({
        outbox: { update: jest.fn(async () => outboxRow({ attempts: 3 })) },
      });
      const repo = repoWith(db);
      expect(await repo.incrementSearchOutboxAttempt("outbox-1", "boom")).toBe(
        3,
      );
      await repo.markSearchOutboxDeadLettered("outbox-1", "dead");
      await repo.markSearchOutboxPublishRetry("outbox-1", 2, "retry");
      expect(
        (db.organizationBlogSearchOutbox as { update: jest.Mock }).update,
      ).toHaveBeenCalledTimes(3);
    });

    it("reads outbox rows by id and by id list", async () => {
      const db = createDb({
        outbox: {
          findUnique: jest.fn(async () => outboxRow({ id: "x" })),
          findMany: jest.fn(async () => [outboxRow({ id: "x" })]),
        },
      });
      const repo = repoWith(db);
      expect((await repo.getSearchOutboxById("x"))?.id).toBe("x");
      expect((await repo.getSearchOutboxesByIds(["x"]))[0]?.id).toBe("x");
      expect(await repo.getSearchOutboxesByIds([])).toEqual([]);
    });

    it("returns null when an outbox row is missing", async () => {
      const db = createDb({
        outbox: { findUnique: jest.fn(async () => null) },
      });
      expect(await repoWith(db).getSearchOutboxById("missing")).toBeNull();
    });

    it("detects newer outbox jobs for the same blog post", async () => {
      const db = createDb({ outbox: { count: jest.fn(async () => 1) } });
      const result = await repoWith(db).hasNewerSearchOutboxJob({
        id: "outbox-1",
        blogPostId: "post-1",
        createdAt: "2026-05-01T00:00:00.000Z",
      });
      expect(result).toBe(true);
    });

    it("returns false when the job has no blog post id", async () => {
      const db = createDb();
      const result = await repoWith(db).hasNewerSearchOutboxJob({
        id: "outbox-1",
        createdAt: "2026-05-01T00:00:00.000Z",
      });
      expect(result).toBe(false);
    });

    it("marks a primary row relayed and its superseded rows indexed", async () => {
      const db = createDb();
      await repoWith(db).markSearchOutboxRelayed("outbox-1", ["s1"], "broker-1");
      const outbox = db.organizationBlogSearchOutbox as {
        update: jest.Mock;
        updateMany: jest.Mock;
      };
      expect(outbox.update).toHaveBeenCalled();
      expect(outbox.updateMany).toHaveBeenCalled();
    });

    it("releases outbox claims and no-ops for empty lists", async () => {
      const db = createDb();
      const repo = repoWith(db);
      await repo.releaseSearchOutboxClaims(["a"], "err");
      await repo.releaseSearchOutboxClaims([]);
      expect(
        (db.organizationBlogSearchOutbox as { updateMany: jest.Mock })
          .updateMany,
      ).toHaveBeenCalledTimes(1);
    });

    it("revives dead-lettered outbox rows", async () => {
      const db = createDb({
        outbox: { findMany: jest.fn(async () => [{ id: "d1" }, { id: "d2" }]) },
      });
      expect(await repoWith(db).reviveDeadLetteredSearchOutbox(10)).toBe(2);
      expect(await repoWith(createDb()).reviveDeadLetteredSearchOutbox(0)).toBe(
        0,
      );
    });

    it("computes outbox lag metrics", async () => {
      const db = createDb({
        queryRaw: () => [
          {
            unpublishedCount: 2,
            unpublishedOldestCreatedAt: new Date("2026-05-01T00:00:00.000Z"),
            publishedNotIndexedCount: 1,
            publishedNotIndexedOldestProcessedAt: new Date(
              "2026-05-01T00:00:00.000Z",
            ),
            upsertDeadLetteredCount: 0,
            deleteDeadLetteredCount: 0,
            barrierDeadLetteredCount: 0,
          },
        ],
      });
      const metrics = await repoWith(db).getSearchOutboxLagMetrics();
      expect(metrics.unpublishedCount).toBe(2);
      expect(metrics.publishedNotIndexedCount).toBe(1);
      expect(metrics.deadLetteredByOperation).toEqual({
        upsert: 0,
        delete: 0,
        barrier: 0,
      });
    });
  });

  describe("reindex runs", () => {
    it("creates and reads reindex runs", async () => {
      const db = createDb();
      const repo = repoWith(db);
      expect(
        (await repo.createSearchReindexRun("organization-blogs_v9")).id,
      ).toBe("reindex-1");
      expect((await repo.findSearchReindexRunById("reindex-1"))?.id).toBe(
        "reindex-1",
      );
      expect((await repo.findActiveSearchReindexRun())?.status).toBe("pending");
      expect((await repo.findLatestSearchReindexRun())?.id).toBe("reindex-1");
      expect((await repo.findLatestCompletedSearchReindexRun())?.id).toBe(
        "reindex-1",
      );
      expect(
        (await repo.listCompletedSearchReindexRunsWithRetainedIndices()).length,
      ).toBe(1);
    });

    it("returns null when a reindex run is missing", async () => {
      const db = createDb({
        reindexRun: {
          findUnique: jest.fn(async () => null),
          findFirst: jest.fn(async () => null),
        },
      });
      const repo = repoWith(db);
      expect(await repo.findSearchReindexRunById("x")).toBeNull();
      expect(await repo.findActiveSearchReindexRun()).toBeNull();
    });

    it("claims the next processable reindex run", async () => {
      const db = createDb({
        reindexRun: {
          findFirst: jest.fn(async () => reindexRunRow()),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
      });
      expect((await repoWith(db).claimNextSearchReindexRun())?.id).toBe(
        "reindex-1",
      );
    });

    it("returns null when there is no run to claim or the claim is lost", async () => {
      const emptyDb = createDb({
        reindexRun: { findFirst: jest.fn(async () => null) },
      });
      expect(await repoWith(emptyDb).claimNextSearchReindexRun()).toBeNull();

      const contendedDb = createDb({
        reindexRun: {
          findFirst: jest.fn(async () => reindexRunRow()),
          updateMany: jest.fn(async () => ({ count: 0 })),
        },
      });
      expect(await repoWith(contendedDb).claimNextSearchReindexRun()).toBeNull();
    });

    it("updates run status, progress, and processing markers", async () => {
      const db = createDb();
      const repo = repoWith(db);
      await repo.markSearchReindexRunRunning("reindex-1", 10);
      await repo.updateSearchReindexRunProgress("reindex-1", {
        indexedDocuments: 5,
        failedDocuments: 1,
      });
      await repo.markSearchReindexRunCompleted(
        "reindex-1",
        "organization-blogs_v0",
      );
      await repo.markSearchReindexRunFailed("reindex-1", "boom");
      await repo.touchSearchReindexRunProcessing("reindex-1");
      await repo.clearSearchReindexRunProcessing("reindex-1");
      await repo.clearSearchReindexRunRetainedIndexName("reindex-1");
      expect(
        (db.organizationBlogSearchReindexRun as { update: jest.Mock }).update,
      ).toHaveBeenCalledTimes(7);
    });

    it("enqueues a reindex barrier and flips the run to waiting", async () => {
      const db = createDb();
      const barrier = await repoWith(db).enqueueSearchReindexBarrier(
        "reindex-1",
        "organization-blogs_v1",
      );
      expect(barrier.id).toBe("outbox-1");
      expect(
        (db.organizationBlogSearchReindexRun as { update: jest.Mock }).update,
      ).toHaveBeenCalled();
    });
  });

  describe("reindex catch-up state", () => {
    it("reports failed when the barrier reference is missing", async () => {
      const db = createDb({
        reindexRun: {
          findUnique: jest.fn(async () => ({ barrierOutboxId: null })),
        },
      });
      expect(
        await repoWith(db).getSearchReindexCatchUpState("reindex-1"),
      ).toEqual(expect.objectContaining({ state: "failed" }));
    });

    it("reports waiting until the barrier has been indexed", async () => {
      const db = createDb({
        reindexRun: {
          findUnique: jest.fn(async () => ({ barrierOutboxId: "barrier-1" })),
        },
        outbox: {
          findUnique: jest.fn(async () => ({
            createdAt: new Date("2026-05-01T00:00:00.000Z"),
            indexedAt: null,
            deadLetteredAt: null,
            lastError: null,
          })),
        },
      });
      expect(
        await repoWith(db).getSearchReindexCatchUpState("reindex-1"),
      ).toEqual({ state: "waiting" });
    });

    it("reports caught_up when the barrier drained and nothing remains", async () => {
      const db = createDb({
        reindexRun: {
          findUnique: jest.fn(async () => ({ barrierOutboxId: "barrier-1" })),
        },
        outbox: {
          findUnique: jest.fn(async () => ({
            createdAt: new Date("2026-05-01T00:00:00.000Z"),
            indexedAt: new Date("2026-05-02T00:00:00.000Z"),
            deadLetteredAt: null,
            lastError: null,
          })),
          count: jest.fn(async () => 0),
        },
      });
      expect(
        await repoWith(db).getSearchReindexCatchUpState("reindex-1"),
      ).toEqual({ state: "caught_up" });
    });

    it("reports failed when the barrier was dead-lettered", async () => {
      const db = createDb({
        reindexRun: {
          findUnique: jest.fn(async () => ({ barrierOutboxId: "barrier-1" })),
        },
        outbox: {
          findUnique: jest.fn(async () => ({
            createdAt: new Date("2026-05-01T00:00:00.000Z"),
            indexedAt: null,
            deadLetteredAt: new Date("2026-05-02T00:00:00.000Z"),
            lastError: "kaboom",
          })),
        },
      });
      expect(
        await repoWith(db).getSearchReindexCatchUpState("reindex-1"),
      ).toEqual(expect.objectContaining({ state: "failed" }));
    });
  });

  describe("reindex start lock", () => {
    it("runs the operation while holding the advisory lock", async () => {
      const db = createDb({
        queryRaw: (text) =>
          text.includes("GET_LOCK") ? [{ acquired: 1 }] : [{ released: 1 }],
      });
      const result = await repoWith(db).withSearchReindexStartLock(
        async ({ findActiveSearchReindexRun, createSearchReindexRun }) => {
          const active = await findActiveSearchReindexRun();
          const created = await createSearchReindexRun("organization-blogs_v2");
          return { active, created };
        },
      );
      expect(result?.created.id).toBe("reindex-1");
    });

    it("returns null when the advisory lock cannot be acquired", async () => {
      const db = createDb({
        queryRaw: (text) =>
          text.includes("GET_LOCK") ? [{ acquired: 0 }] : [{ released: 1 }],
      });
      const operation = jest.fn();
      const result = await repoWith(db).withSearchReindexStartLock(operation);
      expect(result).toBeNull();
      expect(operation).not.toHaveBeenCalled();
    });
  });
});
