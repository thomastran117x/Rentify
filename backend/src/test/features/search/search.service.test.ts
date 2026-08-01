import ConflictError from "@/errors/http/conflict.error";
import { SearchService } from "@/features/search/search.service";
import { resetSearchTelemetry } from "@/features/search/search.telemetry";

describe("SearchService", () => {
  beforeEach(() => {
    resetSearchTelemetry();
  });

  it("starts a reindex run while holding the start lock", async () => {
    const createSearchReindexRun = jest.fn(async (targetIndexName: string) => ({
      id: "run-1",
      status: "pending" as const,
      targetIndexName,
      sourceSnapshotAt: "2026-04-27T00:00:00.000Z",
      totalPostings: 0,
      indexedPostings: 0,
      failedPostings: 0,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    }));
    const withSearchReindexStartLock = jest.fn(
      async (operation: (helpers: unknown) => Promise<unknown>) =>
        operation({
          findActiveSearchReindexRun: async () => null,
          createSearchReindexRun,
        }),
    );
    const postingsRepository = {
      withSearchReindexStartLock,
    } as any;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      isElasticsearchEnabled: () => true,
      isLiveMappingStale: jest.fn(async () => false),
      createVersionedIndex: jest.fn(async () => "postings_v2"),
      buildVersionedIndexName: jest.fn(() => "postings_v2"),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as any,
    );

    const result = await service.startReindex();

    expect(withSearchReindexStartLock).toHaveBeenCalledTimes(1);
    expect(postingsSearchService.ensureLiveIndex).not.toHaveBeenCalled();
    expect(postingsSearchService.createVersionedIndex).not.toHaveBeenCalled();
    expect(postingsSearchService.buildVersionedIndexName).toHaveBeenCalledTimes(
      1,
    );
    expect(createSearchReindexRun).toHaveBeenCalledWith("postings_v2");
    expect(result).toMatchObject({
      id: "run-1",
      targetIndexName: "postings_v2",
    });
  });

  it("starts a reindex run when the live index mapping is out of date", async () => {
    const createSearchReindexRun = jest.fn(async (targetIndexName: string) => ({
      id: "run-1",
      status: "pending" as const,
      targetIndexName,
    }));
    const postingsRepository = {
      withSearchReindexStartLock: jest.fn(
        async (operation: (helpers: unknown) => Promise<unknown>) =>
          operation({
            findActiveSearchReindexRun: async () => null,
            createSearchReindexRun,
          }),
      ),
    } as any;
    const service = new SearchService(
      postingsRepository,
      {
        isElasticsearchEnabled: () => true,
        isLiveMappingStale: jest.fn(async () => true),
        buildVersionedIndexName: jest.fn(() => "postings_v2"),
      } as any,
      {} as any,
    );

    await expect(service.ensureCurrentIndexMapping()).resolves.toBe(true);
    expect(createSearchReindexRun).toHaveBeenCalledWith("postings_v2");
  });

  it("does not start a reindex run when the live index mapping is current", async () => {
    const withSearchReindexStartLock = jest.fn();
    const service = new SearchService(
      { withSearchReindexStartLock } as any,
      {
        isElasticsearchEnabled: () => true,
        isLiveMappingStale: jest.fn(async () => false),
      } as any,
      {} as any,
    );

    await expect(service.ensureCurrentIndexMapping()).resolves.toBe(false);
    expect(withSearchReindexStartLock).not.toHaveBeenCalled();
  });

  it("leaves an in-flight reindex run to bring the mapping up to date", async () => {
    const service = new SearchService(
      {
        withSearchReindexStartLock: jest.fn(
          async (operation: (helpers: unknown) => Promise<unknown>) =>
            operation({
              findActiveSearchReindexRun: async () => ({
                id: "run-1",
                status: "running" as const,
              }),
              createSearchReindexRun: jest.fn(),
            }),
        ),
      } as any,
      {
        isElasticsearchEnabled: () => true,
        isLiveMappingStale: jest.fn(async () => true),
        buildVersionedIndexName: jest.fn(() => "postings_v2"),
      } as any,
      {} as any,
    );

    // The active run already rebuilds with the current mapping, so the
    // conflict is expected rather than an error worth surfacing.
    await expect(service.ensureCurrentIndexMapping()).resolves.toBe(false);
  });

  it("skips mapping drift detection when Elasticsearch is disabled", async () => {
    const isLiveMappingStale = jest.fn();
    const service = new SearchService(
      {} as any,
      {
        isElasticsearchEnabled: () => false,
        isLiveMappingStale,
      } as any,
      {} as any,
    );

    await expect(service.ensureCurrentIndexMapping()).resolves.toBe(false);
    expect(isLiveMappingStale).not.toHaveBeenCalled();
  });

  it("returns a conflict when the start lock cannot be acquired", async () => {
    const postingsRepository = {
      withSearchReindexStartLock: jest.fn(async () => null),
    } as any;
    const service = new SearchService(postingsRepository, {} as any, {} as any);

    await expect(service.startReindex()).rejects.toBeInstanceOf(ConflictError);
  });

  it("returns a conflict when a reindex run is already active inside the start lock", async () => {
    const withSearchReindexStartLock = jest.fn(
      async (operation: (helpers: unknown) => Promise<unknown>) =>
        operation({
          findActiveSearchReindexRun: async () => ({
            id: "run-1",
            status: "running" as const,
          }),
          createSearchReindexRun: jest.fn(),
        }),
    );
    const service = new SearchService(
      {
        withSearchReindexStartLock,
      } as any,
      {
        ensureLiveIndex: jest.fn(async () => undefined),
        isElasticsearchEnabled: () => true,
        isLiveMappingStale: jest.fn(async () => false),
        createVersionedIndex: jest.fn(async () => "postings_v2"),
      } as any,
      {} as any,
    );

    await expect(service.startReindex()).rejects.toBeInstanceOf(ConflictError);
    expect(withSearchReindexStartLock).toHaveBeenCalledTimes(1);
  });

  it("returns disabled alias health and empty queue counts when Elasticsearch is disabled", async () => {
    const postingsRepository = {
      findActiveSearchReindexRun: jest.fn(async () => null),
      findLatestSearchReindexRun: jest.fn(async () => null),
      getSearchOutboxLagMetrics: jest.fn(async () => ({
        unpublishedCount: 0,
        unpublishedOldestAgeMs: null,
        publishedNotIndexedCount: 0,
        publishedNotIndexedOldestAgeMs: null,
        deadLetteredByOperation: {
          upsert: 0,
          delete: 0,
          barrier: 0,
        },
      })),
    } as any;
    const postingsSearchService = {
      isElasticsearchEnabled: () => false,
      getReadAliasName: () => "postings-read",
      getWriteAliasName: () => "postings-write",
      getCircuitBreakerState: () => ({
        state: "closed" as const,
        consecutiveFailures: 0,
        failureThreshold: 3,
        cooldownMs: 30_000,
      }),
    } as any;
    const searchQueueService = {
      getQueueCounts: jest.fn(async () => ({
        main: { ready: 99, consumers: 9 },
      })),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    const status = await service.getStatus();

    expect(status.aliases.health).toEqual({
      state: "disabled",
      readAlias: "postings-read",
      writeAlias: "postings-write",
      readTargets: [],
      writeTargets: [],
    });
    expect(status.queueInspection).toEqual({ ok: true });
    expect(status.queueCounts).toEqual({
      main: { ready: 0, consumers: 0 },
      retry1: { ready: 0, consumers: 0 },
      retry2: { ready: 0, consumers: 0 },
      retry3: { ready: 0, consumers: 0 },
      deadLetter: { ready: 0, consumers: 0 },
    });
    expect(searchQueueService.getQueueCounts).not.toHaveBeenCalled();
  });

  it("reports degraded alias health instead of failing status when Elasticsearch is unavailable", async () => {
    const postingsRepository = {
      findActiveSearchReindexRun: jest.fn(async () => null),
      findLatestSearchReindexRun: jest.fn(async () => null),
      getSearchOutboxLagMetrics: jest.fn(async () => ({
        unpublishedCount: 0,
        unpublishedOldestAgeMs: null,
        publishedNotIndexedCount: 0,
        publishedNotIndexedOldestAgeMs: null,
        deadLetteredByOperation: {
          upsert: 0,
          delete: 0,
          barrier: 0,
        },
      })),
    } as any;
    const postingsSearchService = {
      isElasticsearchEnabled: () => true,
      getAliasStatus: jest.fn(async () => {
        throw new Error("Elasticsearch is down");
      }),
      getReadAliasName: () => "postings-read",
      getWriteAliasName: () => "postings-write",
      getCircuitBreakerState: () => ({
        state: "open" as const,
        consecutiveFailures: 3,
        failureThreshold: 3,
        cooldownMs: 30_000,
      }),
    } as any;
    const searchQueueService = {
      getQueueCounts: jest.fn(async () => ({
        main: { ready: 0, consumers: 0 },
        retry1: { ready: 0, consumers: 0 },
        retry2: { ready: 0, consumers: 0 },
        retry3: { ready: 0, consumers: 0 },
        deadLetter: { ready: 0, consumers: 0 },
      })),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    const status = await service.getStatus();

    expect(status.aliases.health).toEqual({
      state: "unavailable",
      readAlias: "postings-read",
      writeAlias: "postings-write",
      readTargets: [],
      writeTargets: [],
      message: "Elasticsearch is down",
    });
    expect(status.queueInspection).toEqual({ ok: true });
  });

  it("returns reindex runs by id from the repository", async () => {
    const findSearchReindexRunById = jest.fn(async () => ({
      id: "run-42",
      status: "completed" as const,
      targetIndexName: "postings_v42",
      sourceSnapshotAt: "2026-04-27T00:00:00.000Z",
      totalPostings: 42,
      indexedPostings: 42,
      failedPostings: 0,
      completedAt: "2026-04-27T00:10:00.000Z",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:10:00.000Z",
    }));
    const service = new SearchService(
      {
        findSearchReindexRunById,
      } as any,
      {} as any,
      {} as any,
    );

    await expect(service.getReindexRun("run-42")).resolves.toMatchObject({
      id: "run-42",
      targetIndexName: "postings_v42",
    });
    expect(findSearchReindexRunById).toHaveBeenCalledWith("run-42");
  });

  it("reports queue inspection failures explicitly in status", async () => {
    const postingsRepository = {
      findActiveSearchReindexRun: jest.fn(async () => null),
      findLatestSearchReindexRun: jest.fn(async () => ({
        id: "run-9",
        status: "failed" as const,
        targetIndexName: "postings_v9",
        sourceSnapshotAt: "2026-04-27T00:00:00.000Z",
        barrierOutboxId: "barrier-9",
        totalPostings: 25,
        indexedPostings: 25,
        failedPostings: 0,
        failedAt: "2026-04-27T00:10:00.000Z",
        lastError:
          "Search reindex barrier could not complete: broker publish retries exhausted.",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:10:00.000Z",
      })),
      getSearchOutboxLagMetrics: jest.fn(async () => ({
        unpublishedCount: 3,
        unpublishedOldestAgeMs: 1_500,
        publishedNotIndexedCount: 2,
        publishedNotIndexedOldestAgeMs: 500,
        deadLetteredByOperation: {
          upsert: 1,
          delete: 0,
          barrier: 0,
        },
      })),
    } as any;
    const postingsSearchService = {
      isElasticsearchEnabled: () => true,
      getAliasStatus: jest.fn(async () => ({
        state: "ready" as const,
        readAlias: "postings-read",
        writeAlias: "postings-write",
        readTargets: ["postings_v1"],
        writeTargets: ["postings_v1"],
      })),
      getReadAliasName: () => "postings-read",
      getWriteAliasName: () => "postings-write",
      getCircuitBreakerState: () => ({
        state: "closed" as const,
        consecutiveFailures: 0,
        failureThreshold: 3,
        cooldownMs: 30_000,
      }),
    } as any;
    const searchQueueService = {
      getQueueCounts: jest.fn(async () => {
        throw new Error("broker unavailable");
      }),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    const status = await service.getStatus();

    expect(status.queueInspection).toEqual({
      ok: false,
      error: "broker unavailable",
    });
    expect(status.queueCounts).toBeUndefined();
    expect(status.latestReindexRun).toMatchObject({
      id: "run-9",
      status: "failed",
      lastError:
        "Search reindex barrier could not complete: broker publish retries exhausted.",
    });
    expect(status.pendingOutboxCount).toBe(3);
    expect(status.pendingOutboxOldestAgeMs).toBe(1_500);
    expect(status.lag).toEqual({
      unpublishedCount: 3,
      unpublishedOldestAgeMs: 1_500,
      publishedNotIndexedCount: 2,
      publishedNotIndexedOldestAgeMs: 500,
      deadLetteredByOperation: {
        upsert: 1,
        delete: 0,
        barrier: 0,
      },
    });
    expect(status.aliases.health.state).toBe("ready");
    expect(status.telemetry.queueInspectionFailures).toBe(1);
  });

  it("coalesces relay jobs by posting and target before publish", async () => {
    const markSearchOutboxRelayed = jest.fn(async () => undefined);
    const releaseSearchOutboxClaims = jest.fn(async () => undefined);
    const postingsRepository = {
      claimSearchOutboxBatch: jest.fn(async () => [
        {
          id: "outbox-1",
          postingId: "posting-1",
          operation: "upsert",
          dedupeKey: "outbox-1",
          attempts: 0,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
        {
          id: "outbox-2",
          postingId: "posting-1",
          operation: "delete",
          dedupeKey: "outbox-2",
          attempts: 0,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:01.000Z",
          createdAt: "2026-04-27T00:00:01.000Z",
          updatedAt: "2026-04-27T00:00:01.000Z",
        },
      ]),
      markSearchOutboxRelayed,
      releaseSearchOutboxClaims,
    } as any;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      isElasticsearchEnabled: () => true,
      isLiveMappingStale: jest.fn(async () => false),
    } as any;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
      publishIndexJob: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    const processed = await service.processOutboxRelayBatch(10, 3);

    expect(processed).toBe(2);
    expect(searchQueueService.publishIndexJob).toHaveBeenCalledTimes(1);
    expect(searchQueueService.publishIndexJob).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxId: "outbox-2",
        operation: "delete",
      }),
    );
    expect(markSearchOutboxRelayed).toHaveBeenCalledWith(
      "outbox-2",
      ["outbox-1"],
      "outbox-2",
    );
    expect(releaseSearchOutboxClaims).not.toHaveBeenCalled();
  });

  it("releases claims instead of dead-lettering when relay publish succeeds but finalize fails", async () => {
    const markSearchOutboxRelayed = jest.fn(async () => {
      throw new Error("database unavailable");
    });
    const releaseSearchOutboxClaims = jest.fn(async () => undefined);
    const markSearchOutboxDeadLettered = jest.fn(async () => undefined);
    const markSearchOutboxPublishRetry = jest.fn(async () => undefined);
    const postingsRepository = {
      claimSearchOutboxBatch: jest.fn(async () => [
        {
          id: "outbox-2",
          postingId: "posting-1",
          operation: "delete",
          dedupeKey: "outbox-2",
          attempts: 0,
          publishAttempts: 2,
          availableAt: "2026-04-27T00:00:01.000Z",
          createdAt: "2026-04-27T00:00:01.000Z",
          updatedAt: "2026-04-27T00:00:01.000Z",
        },
      ]),
      markSearchOutboxRelayed,
      releaseSearchOutboxClaims,
      markSearchOutboxDeadLettered,
      markSearchOutboxPublishRetry,
    } as any;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      isElasticsearchEnabled: () => true,
      isLiveMappingStale: jest.fn(async () => false),
    } as any;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
      publishIndexJob: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    const processed = await service.processOutboxRelayBatch(10, 3);

    expect(processed).toBe(1);
    expect(searchQueueService.publishIndexJob).toHaveBeenCalledTimes(1);
    expect(markSearchOutboxRelayed).toHaveBeenCalledWith(
      "outbox-2",
      [],
      "outbox-2",
    );
    expect(releaseSearchOutboxClaims).toHaveBeenCalledWith(
      ["outbox-2"],
      "database unavailable",
    );
    expect(markSearchOutboxDeadLettered).not.toHaveBeenCalled();
    expect(markSearchOutboxPublishRetry).not.toHaveBeenCalled();
  });

  it("marks relay jobs for publish retry before the dead-letter threshold", async () => {
    const releaseSearchOutboxClaims = jest.fn(async () => undefined);
    const markSearchOutboxPublishRetry = jest.fn(async () => undefined);
    const postingsRepository = {
      claimSearchOutboxBatch: jest.fn(async () => [
        {
          id: "outbox-1",
          postingId: "posting-1",
          operation: "upsert",
          dedupeKey: "outbox-1",
          attempts: 0,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
      ]),
      releaseSearchOutboxClaims,
      markSearchOutboxPublishRetry,
      markSearchOutboxDeadLettered: jest.fn(async () => undefined),
    } as any;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      isElasticsearchEnabled: () => true,
      isLiveMappingStale: jest.fn(async () => false),
    } as any;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
      publishIndexJob: jest.fn(async () => {
        throw new Error("broker unavailable");
      }),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    const processed = await service.processOutboxRelayBatch(10, 3);

    expect(processed).toBe(1);
    expect(searchQueueService.publishIndexJob).toHaveBeenCalledTimes(3);
    expect(releaseSearchOutboxClaims).toHaveBeenCalledWith(
      [],
      "broker unavailable",
    );
    expect(markSearchOutboxPublishRetry).toHaveBeenCalledWith(
      "outbox-1",
      1,
      "broker unavailable",
    );
  });

  it("dead-letters relay jobs after broker publish retries are exhausted", async () => {
    const releaseSearchOutboxClaims = jest.fn(async () => undefined);
    const markSearchOutboxDeadLettered = jest.fn(async () => undefined);
    const postingsRepository = {
      claimSearchOutboxBatch: jest.fn(async () => [
        {
          id: "outbox-9",
          postingId: "posting-9",
          operation: "delete",
          dedupeKey: "outbox-9",
          attempts: 0,
          publishAttempts: 2,
          availableAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
      ]),
      releaseSearchOutboxClaims,
      markSearchOutboxDeadLettered,
      markSearchOutboxPublishRetry: jest.fn(async () => undefined),
    } as any;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      isElasticsearchEnabled: () => true,
      isLiveMappingStale: jest.fn(async () => false),
    } as any;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
      publishIndexJob: jest.fn(async () => {
        throw new Error("broker unavailable");
      }),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    await service.processOutboxRelayBatch(10, 3);

    expect(releaseSearchOutboxClaims).toHaveBeenCalledWith(
      [],
      "broker unavailable",
    );
    expect(markSearchOutboxDeadLettered).toHaveBeenCalledWith(
      "outbox-9",
      "broker unavailable",
    );
  });

  it("skips stale index jobs when a newer outbox job exists", async () => {
    const markSearchOutboxIndexed = jest.fn(async () => undefined);
    const postingsRepository = {
      getSearchOutboxById: jest.fn(async () => ({
        id: "outbox-1",
        postingId: "posting-1",
        reindexRunId: undefined,
        operation: "delete",
        dedupeKey: "outbox-1",
        attempts: 0,
        publishAttempts: 0,
        availableAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
      })),
      hasNewerSearchOutboxJob: jest.fn(async () => true),
      markSearchOutboxIndexed,
    } as any;
    const postingsSearchService = {
      deleteDocument: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as any,
    );

    await service.processIndexJob(
      {
        outboxId: "outbox-1",
        eventId: "outbox-1",
        dedupeKey: "outbox-1",
        operation: "delete",
        jobType: "delete",
        postingId: "posting-1",
        targetIndexScope: "live",
        occurredAt: "2026-04-27T00:00:00.000Z",
        attempt: 0,
      },
      3,
    );

    expect(postingsSearchService.deleteDocument).not.toHaveBeenCalled();
    expect(markSearchOutboxIndexed).toHaveBeenCalledWith("outbox-1");
  });

  it("marks barrier jobs indexed immediately during single-job processing", async () => {
    const markSearchOutboxIndexed = jest.fn(async () => undefined);
    const service = new SearchService(
      {
        getSearchOutboxById: jest.fn(async () => ({
          id: "barrier-1",
          postingId: undefined,
          reindexRunId: "run-1",
          operation: "barrier",
          dedupeKey: "barrier-1",
          attempts: 0,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        })),
        markSearchOutboxIndexed,
      } as any,
      {} as any,
      {} as any,
    );

    await service.processIndexJob(
      {
        outboxId: "barrier-1",
        eventId: "barrier-1",
        dedupeKey: "barrier-1",
        operation: "barrier",
        jobType: "barrier",
        postingId: undefined,
        reindexRunId: "run-1",
        targetIndexScope: "reindex",
        targetIndexName: "postings_v2",
        occurredAt: "2026-04-27T00:00:00.000Z",
        attempt: 0,
      },
      3,
    );

    expect(markSearchOutboxIndexed).toHaveBeenCalledWith("barrier-1");
  });

  it("requeues failed index jobs until the max attempts threshold", async () => {
    const incrementSearchOutboxAttempt = jest.fn(async () => 1);
    const searchQueueService = {
      publishRetryJob: jest.fn(async () => undefined),
      publishDeadLetterJob: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      {
        getSearchOutboxById: jest.fn(async () => ({
          id: "outbox-1",
          postingId: undefined,
          reindexRunId: undefined,
          operation: "upsert",
          dedupeKey: "outbox-1",
          attempts: 0,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        })),
        incrementSearchOutboxAttempt,
        markSearchOutboxDeadLettered: jest.fn(async () => undefined),
      } as any,
      {} as any,
      searchQueueService,
    );

    await service.processIndexJob(
      {
        outboxId: "outbox-1",
        eventId: "outbox-1",
        dedupeKey: "outbox-1",
        operation: "upsert",
        jobType: "upsert",
        postingId: undefined,
        targetIndexScope: "live",
        occurredAt: "2026-04-27T00:00:00.000Z",
        attempt: 0,
      },
      3,
    );

    expect(incrementSearchOutboxAttempt).toHaveBeenCalledWith(
      "outbox-1",
      "Search outbox job is missing a posting id.",
    );
    expect(searchQueueService.publishRetryJob).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxId: "outbox-1",
        attempt: 1,
      }),
      1,
    );
    expect(searchQueueService.publishDeadLetterJob).not.toHaveBeenCalled();
  });

  it("dead-letters index jobs after the max attempts threshold", async () => {
    const markSearchOutboxDeadLettered = jest.fn(async () => undefined);
    const searchQueueService = {
      publishRetryJob: jest.fn(async () => undefined),
      publishDeadLetterJob: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      {
        getSearchOutboxById: jest.fn(async () => ({
          id: "outbox-3",
          postingId: undefined,
          reindexRunId: undefined,
          operation: "delete",
          dedupeKey: "outbox-3",
          attempts: 2,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        })),
        incrementSearchOutboxAttempt: jest.fn(async () => 3),
        markSearchOutboxDeadLettered,
      } as any,
      {} as any,
      searchQueueService,
    );

    await service.processIndexJob(
      {
        outboxId: "outbox-3",
        eventId: "outbox-3",
        dedupeKey: "outbox-3",
        operation: "delete",
        jobType: "delete",
        postingId: undefined,
        targetIndexScope: "live",
        occurredAt: "2026-04-27T00:00:00.000Z",
        attempt: 2,
      },
      3,
    );

    expect(searchQueueService.publishDeadLetterJob).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxId: "outbox-3",
        attempt: 3,
      }),
    );
    expect(markSearchOutboxDeadLettered).toHaveBeenCalledWith(
      "outbox-3",
      "Search outbox job is missing a posting id.",
    );
    expect(searchQueueService.publishRetryJob).not.toHaveBeenCalled();
  });

  it("propagates retry publication failures so the worker can nack the original message", async () => {
    const incrementSearchOutboxAttempt = jest.fn(async () => 1);
    const publishRetryJob = jest.fn(async () => {
      throw new Error("retry queue unavailable");
    });
    const markSearchOutboxDeadLettered = jest.fn(async () => undefined);
    const service = new SearchService(
      {
        getSearchOutboxById: jest.fn(async () => ({
          id: "outbox-retry-failure",
          postingId: undefined,
          reindexRunId: undefined,
          operation: "upsert",
          dedupeKey: "outbox-retry-failure",
          attempts: 0,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        })),
        incrementSearchOutboxAttempt,
        markSearchOutboxDeadLettered,
      } as any,
      {} as any,
      {
        publishRetryJob,
        publishDeadLetterJob: jest.fn(async () => undefined),
      } as any,
    );

    await expect(
      service.processIndexJob(
        {
          outboxId: "outbox-retry-failure",
          eventId: "outbox-retry-failure",
          dedupeKey: "outbox-retry-failure",
          operation: "upsert",
          jobType: "upsert",
          postingId: undefined,
          targetIndexScope: "live",
          occurredAt: "2026-04-27T00:00:00.000Z",
          attempt: 0,
        },
        3,
      ),
    ).rejects.toThrow("retry queue unavailable");

    expect(incrementSearchOutboxAttempt).toHaveBeenCalledWith(
      "outbox-retry-failure",
      "Search outbox job is missing a posting id.",
    );
    expect(publishRetryJob).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxId: "outbox-retry-failure",
        attempt: 1,
      }),
      1,
    );
    expect(markSearchOutboxDeadLettered).not.toHaveBeenCalled();
  });

  it("does not mark index jobs dead-lettered when dead-letter publication fails", async () => {
    const markSearchOutboxDeadLettered = jest.fn(async () => undefined);
    const publishDeadLetterJob = jest.fn(async () => {
      throw new Error("dead-letter queue unavailable");
    });
    const service = new SearchService(
      {
        getSearchOutboxById: jest.fn(async () => ({
          id: "outbox-dead-letter-failure",
          postingId: undefined,
          reindexRunId: undefined,
          operation: "delete",
          dedupeKey: "outbox-dead-letter-failure",
          attempts: 2,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        })),
        incrementSearchOutboxAttempt: jest.fn(async () => 3),
        markSearchOutboxDeadLettered,
      } as any,
      {} as any,
      {
        publishRetryJob: jest.fn(async () => undefined),
        publishDeadLetterJob,
      } as any,
    );

    await expect(
      service.processIndexJob(
        {
          outboxId: "outbox-dead-letter-failure",
          eventId: "outbox-dead-letter-failure",
          dedupeKey: "outbox-dead-letter-failure",
          operation: "delete",
          jobType: "delete",
          postingId: undefined,
          targetIndexScope: "live",
          occurredAt: "2026-04-27T00:00:00.000Z",
          attempt: 2,
        },
        3,
      ),
    ).rejects.toThrow("dead-letter queue unavailable");

    expect(publishDeadLetterJob).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxId: "outbox-dead-letter-failure",
        attempt: 3,
      }),
    );
    expect(markSearchOutboxDeadLettered).not.toHaveBeenCalled();
  });

  it("heartbeats reindex processing and clears waiting runs for the next poll", async () => {
    const touchSearchReindexRunProcessing = jest.fn(async () => undefined);
    const clearSearchReindexRunProcessing = jest.fn(async () => undefined);
    const markSearchReindexRunRunning = jest.fn(async () => undefined);
    const postingsRepository = {
      claimNextSearchReindexRun: jest
        .fn()
        .mockResolvedValueOnce({
          id: "run-1",
          status: "running",
          targetIndexName: "postings_v2",
          sourceSnapshotAt: "2026-04-27T00:00:00.000Z",
          totalPostings: 0,
          indexedPostings: 0,
          failedPostings: 0,
          startedAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        })
        .mockResolvedValueOnce({
          id: "run-1",
          status: "waiting_for_catchup",
          targetIndexName: "postings_v2",
          sourceSnapshotAt: "2026-04-27T00:00:00.000Z",
          totalPostings: 2,
          indexedPostings: 2,
          failedPostings: 0,
          startedAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        }),
      countPublishedPostingsForIndexing: jest.fn(async () => 2),
      markSearchReindexRunRunning,
      findLatestCompletedSearchReindexRun: jest.fn(async () => null),
      listPublishedForIndexingBatch: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "posting-1",
          },
          {
            id: "posting-2",
          },
        ])
        .mockResolvedValueOnce([]),
      updateSearchReindexRunProgress: jest.fn(async () => undefined),
      enqueueSearchReindexBarrier: jest.fn(async () => undefined),
      touchSearchReindexRunProcessing,
      getSearchReindexCatchUpState: jest.fn(async () => ({
        state: "waiting" as const,
      })),
      clearSearchReindexRunProcessing,
    } as any;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      isElasticsearchEnabled: () => true,
      isLiveMappingStale: jest.fn(async () => false),
      createVersionedIndex: jest.fn(async () => "postings_v2"),
      bulkUpsertDocuments: jest.fn(async () => undefined),
    } as any;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    await service.processReindexRuns(200);
    await service.processReindexRuns(200);

    expect(
      postingsRepository.listPublishedForIndexingBatch,
    ).toHaveBeenCalledWith(200, undefined, "2026-04-27T00:00:00.000Z");
    expect(touchSearchReindexRunProcessing).toHaveBeenCalled();
    expect(postingsSearchService.createVersionedIndex).not.toHaveBeenCalled();
    expect(markSearchReindexRunRunning).not.toHaveBeenCalled();
    expect(clearSearchReindexRunProcessing).toHaveBeenCalledWith("run-1");
  });

  it("creates and marks pending reindex runs before indexing", async () => {
    const markSearchReindexRunRunning = jest.fn(async () => undefined);
    const postingsRepository = {
      claimNextSearchReindexRun: jest.fn(async () => ({
        id: "run-1",
        status: "pending",
        targetIndexName: "postings_v2",
        sourceSnapshotAt: "2026-04-27T00:00:00.000Z",
        totalPostings: 0,
        indexedPostings: 0,
        failedPostings: 0,
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
      })),
      countPublishedPostingsForIndexing: jest.fn(async () => 2),
      markSearchReindexRunRunning,
      listPublishedForIndexingBatch: jest.fn(async () => []),
      enqueueSearchReindexBarrier: jest.fn(async () => undefined),
    } as any;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      isElasticsearchEnabled: () => true,
      isLiveMappingStale: jest.fn(async () => false),
      createVersionedIndex: jest.fn(async () => "postings_v2"),
    } as any;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    const processed = await service.processReindexRuns(200);

    expect(processed).toBe(1);
    expect(postingsSearchService.createVersionedIndex).toHaveBeenCalledWith(
      "postings_v2",
    );
    expect(
      postingsRepository.countPublishedPostingsForIndexing,
    ).toHaveBeenCalledWith("2026-04-27T00:00:00.000Z");
    expect(markSearchReindexRunRunning).toHaveBeenCalledWith("run-1", 2);
    expect(postingsRepository.enqueueSearchReindexBarrier).toHaveBeenCalledWith(
      "run-1",
      "postings_v2",
    );
  });

  it("fails waiting reindex runs when the barrier dead-letters", async () => {
    const markSearchReindexRunFailed = jest.fn(async () => undefined);
    const clearSearchReindexRunProcessing = jest.fn(async () => undefined);
    const postingsRepository = {
      claimNextSearchReindexRun: jest.fn(async () => ({
        id: "run-1",
        status: "waiting_for_catchup",
        targetIndexName: "postings_v2",
        sourceSnapshotAt: "2026-04-27T00:00:00.000Z",
        barrierOutboxId: "barrier-1",
        totalPostings: 2,
        indexedPostings: 2,
        failedPostings: 0,
        startedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
      })),
      getSearchReindexCatchUpState: jest.fn(async () => ({
        state: "failed" as const,
        errorMessage:
          "Search reindex barrier could not complete: broker publish retries exhausted.",
      })),
      markSearchReindexRunFailed,
      clearSearchReindexRunProcessing,
    } as any;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      isElasticsearchEnabled: () => true,
      isLiveMappingStale: jest.fn(async () => false),
    } as any;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    const processed = await service.processReindexRuns(100);

    expect(processed).toBe(1);
    expect(markSearchReindexRunFailed).toHaveBeenCalledWith(
      "run-1",
      "Search reindex barrier could not complete: broker publish retries exhausted.",
    );
    expect(clearSearchReindexRunProcessing).not.toHaveBeenCalled();
  });

  it("retries transient reindex failures without failing the run", async () => {
    const clearSearchReindexRunProcessing = jest.fn(async () => undefined);
    const markSearchReindexRunFailed = jest.fn(async () => undefined);
    const countPublishedPostingsForIndexing = jest.fn(async () => 1);
    const markSearchReindexRunRunning = jest.fn(async () => undefined);
    const postingsRepository = {
      claimNextSearchReindexRun: jest.fn(async () => ({
        id: "run-1",
        status: "running",
        targetIndexName: "postings_v2",
        sourceSnapshotAt: "2026-04-27T00:00:00.000Z",
        totalPostings: 0,
        indexedPostings: 0,
        failedPostings: 0,
        startedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
      })),
      countPublishedPostingsForIndexing,
      markSearchReindexRunRunning,
      listPublishedForIndexingBatch: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "posting-1",
          },
        ])
        .mockResolvedValueOnce([]),
      touchSearchReindexRunProcessing: jest.fn(async () => undefined),
      clearSearchReindexRunProcessing,
      markSearchReindexRunFailed,
    } as any;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      isElasticsearchEnabled: () => true,
      isLiveMappingStale: jest.fn(async () => false),
      createVersionedIndex: jest.fn(async () => "postings_v2"),
      bulkUpsertDocuments: jest.fn(async () => {
        throw new Error("amqp broker unavailable");
      }),
    } as any;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    const processed = await service.processReindexRuns(100);

    expect(processed).toBe(0);
    expect(postingsSearchService.createVersionedIndex).not.toHaveBeenCalled();
    expect(countPublishedPostingsForIndexing).not.toHaveBeenCalled();
    expect(markSearchReindexRunRunning).not.toHaveBeenCalled();
    expect(clearSearchReindexRunProcessing).toHaveBeenCalledWith("run-1");
    expect(markSearchReindexRunFailed).not.toHaveBeenCalled();
  });

  it("bulk-indexes live jobs and only falls back per message on failed groups", async () => {
    const markSearchOutboxesIndexed = jest.fn(async () => undefined);
    const postingsRepository = {
      getSearchOutboxesByIds: jest.fn(async () => [
        {
          id: "outbox-1",
          postingId: "posting-1",
          operation: "upsert",
          dedupeKey: "outbox-1",
          attempts: 0,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
        {
          id: "outbox-2",
          postingId: "posting-2",
          operation: "delete",
          dedupeKey: "outbox-2",
          attempts: 0,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:01.000Z",
          createdAt: "2026-04-27T00:00:01.000Z",
          updatedAt: "2026-04-27T00:00:01.000Z",
        },
      ]),
      hasNewerSearchOutboxJob: jest.fn(async () => false),
      markSearchOutboxesIndexed,
      findByIdsForIndexing: jest.fn(async () => [
        {
          id: "posting-1",
          status: "published",
          photos: [],
          pricing: {
            daily: {
              amount: 100,
              currency: "CAD",
            },
          },
        },
      ]),
    } as any;
    const postingsSearchService = {
      getWriteAliasName: () => "postings-write",
      bulkUpsertDocuments: jest.fn(async () => undefined),
      bulkDeleteDocuments: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as any,
    );

    await service.processIndexJobsBatch(
      [
        {
          outboxId: "outbox-1",
          eventId: "outbox-1",
          dedupeKey: "outbox-1",
          operation: "upsert",
          jobType: "upsert",
          postingId: "posting-1",
          targetIndexScope: "live",
          occurredAt: "2026-04-27T00:00:00.000Z",
          attempt: 0,
        },
        {
          outboxId: "outbox-2",
          eventId: "outbox-2",
          dedupeKey: "outbox-2",
          operation: "delete",
          jobType: "delete",
          postingId: "posting-2",
          targetIndexScope: "live",
          occurredAt: "2026-04-27T00:00:01.000Z",
          attempt: 0,
        },
      ],
      3,
    );

    expect(postingsSearchService.bulkUpsertDocuments).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "posting-1" })]),
      "postings-write",
    );
    expect(postingsSearchService.bulkDeleteDocuments).toHaveBeenCalledWith(
      ["posting-2"],
      "postings-write",
    );
    expect(markSearchOutboxesIndexed).toHaveBeenCalledTimes(2);
  });

  it("falls back to per-job indexing when bulk group operations fail", async () => {
    const outboxById = new Map([
      [
        "outbox-1",
        {
          id: "outbox-1",
          postingId: "posting-1",
          operation: "upsert",
          targetIndexName: "postings_v2",
          dedupeKey: "outbox-1",
          attempts: 0,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
      ],
      [
        "outbox-2",
        {
          id: "outbox-2",
          postingId: "posting-2",
          operation: "delete",
          targetIndexName: "postings_v2",
          dedupeKey: "outbox-2",
          attempts: 0,
          publishAttempts: 0,
          availableAt: "2026-04-27T00:00:01.000Z",
          createdAt: "2026-04-27T00:00:01.000Z",
          updatedAt: "2026-04-27T00:00:01.000Z",
        },
      ],
    ]);
    const postingsRepository = {
      getSearchOutboxesByIds: jest.fn(async () =>
        Array.from(outboxById.values()),
      ),
      getSearchOutboxById: jest.fn(async (id: string) => outboxById.get(id)),
      hasNewerSearchOutboxJob: jest.fn(async () => false),
      markSearchOutboxesIndexed: jest.fn(async () => undefined),
      markSearchOutboxIndexed: jest.fn(async () => undefined),
      findByIdsForIndexing: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "posting-1",
            status: "published",
            photos: [],
            pricing: {
              daily: {
                amount: 100,
                currency: "CAD",
              },
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "posting-1",
            status: "published",
            photos: [],
            pricing: {
              daily: {
                amount: 100,
                currency: "CAD",
              },
            },
          },
        ]),
    } as any;
    const postingsSearchService = {
      getWriteAliasName: () => "postings-write",
      bulkUpsertDocuments: jest.fn(async () => {
        throw new Error("bulk upsert failed");
      }),
      bulkDeleteDocuments: jest.fn(async () => {
        throw new Error("bulk delete failed");
      }),
      upsertDocument: jest.fn(async () => undefined),
      deleteDocument: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {
        publishRetryJob: jest.fn(async () => undefined),
        publishDeadLetterJob: jest.fn(async () => undefined),
      } as any,
    );

    await service.processIndexJobsBatch(
      [
        {
          outboxId: "outbox-1",
          eventId: "outbox-1",
          dedupeKey: "outbox-1",
          operation: "upsert",
          jobType: "upsert",
          postingId: "posting-1",
          targetIndexScope: "reindex",
          targetIndexName: "postings_v2",
          occurredAt: "2026-04-27T00:00:00.000Z",
          attempt: 0,
        },
        {
          outboxId: "outbox-2",
          eventId: "outbox-2",
          dedupeKey: "outbox-2",
          operation: "delete",
          jobType: "delete",
          postingId: "posting-2",
          targetIndexScope: "reindex",
          targetIndexName: "postings_v2",
          occurredAt: "2026-04-27T00:00:01.000Z",
          attempt: 0,
        },
      ],
      3,
    );

    expect(postingsSearchService.upsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "posting-1" }),
      "postings_v2",
    );
    expect(postingsSearchService.deleteDocument).toHaveBeenCalledWith(
      "posting-2",
      "postings_v2",
    );
    expect(postingsRepository.markSearchOutboxIndexed).toHaveBeenCalledWith(
      "outbox-1",
    );
    expect(postingsRepository.markSearchOutboxIndexed).toHaveBeenCalledWith(
      "outbox-2",
    );
  });

  it("completes a caught-up reindex run and cleans the previous stale retained index", async () => {
    const markSearchReindexRunCompleted = jest.fn(async () => undefined);
    const clearSearchReindexRunRetainedIndexName = jest.fn(
      async () => undefined,
    );
    const postingsRepository = {
      claimNextSearchReindexRun: jest.fn(async () => ({
        id: "run-2",
        status: "waiting_for_catchup",
        targetIndexName: "postings_v3",
        sourceSnapshotAt: "2026-04-27T00:00:00.000Z",
        barrierOutboxId: "barrier-2",
        totalPostings: 10,
        indexedPostings: 10,
        failedPostings: 0,
        startedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:10:00.000Z",
      })),
      getSearchReindexCatchUpState: jest.fn(async () => ({
        state: "caught_up" as const,
      })),
      findLatestCompletedSearchReindexRun: jest.fn(async () => ({
        id: "run-1",
        status: "completed" as const,
        targetIndexName: "postings_v2",
        retainedIndexName: "postings_v0",
        sourceSnapshotAt: "2026-04-26T00:00:00.000Z",
        totalPostings: 8,
        indexedPostings: 8,
        failedPostings: 0,
        completedAt: "2026-04-26T00:10:00.000Z",
        createdAt: "2026-04-26T00:00:00.000Z",
        updatedAt: "2026-04-26T00:10:00.000Z",
      })),
      markSearchReindexRunCompleted,
      clearSearchReindexRunRetainedIndexName,
    } as any;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      isElasticsearchEnabled: () => true,
      isLiveMappingStale: jest.fn(async () => false),
      swapAliases: jest.fn(async () => ({
        previousReadTargets: ["postings_v_old"],
        previousWriteTargets: ["postings_v3"],
      })),
      getAliasStatus: jest.fn(async () => ({
        state: "ready" as const,
        readAlias: "postings-read",
        writeAlias: "postings-write",
        readTargets: ["postings_v3"],
        writeTargets: ["postings_v3"],
      })),
      deleteConcreteIndex: jest.fn(async () => undefined),
    } as any;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    const processed = await service.processReindexRuns(100);

    expect(processed).toBe(1);
    expect(postingsSearchService.swapAliases).toHaveBeenCalledWith(
      "postings_v3",
    );
    expect(markSearchReindexRunCompleted).toHaveBeenCalledWith(
      "run-2",
      "postings_v_old",
    );
    expect(postingsSearchService.deleteConcreteIndex).toHaveBeenCalledWith(
      "postings_v0",
    );
    expect(clearSearchReindexRunRetainedIndexName).toHaveBeenCalledWith(
      "run-1",
    );
  });

  it("returns zero when no reindex run is available to process", async () => {
    const postingsRepository = {
      claimNextSearchReindexRun: jest.fn(async () => null),
    } as any;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      isElasticsearchEnabled: () => true,
      isLiveMappingStale: jest.fn(async () => false),
    } as any;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    await expect(service.processReindexRuns(100)).resolves.toBe(0);
    expect(postingsSearchService.ensureLiveIndex).toHaveBeenCalledTimes(1);
    expect(searchQueueService.ensureTopology).toHaveBeenCalledTimes(1);
  });

  it("reconciles recent postings back into the live index", async () => {
    const postingsRepository = {
      listRecentForIndexReconciliation: jest.fn(async () => [
        {
          id: "posting-1",
          status: "published",
          photos: [],
          pricing: {
            daily: {
              amount: 100,
              currency: "CAD",
            },
          },
        },
        {
          id: "posting-2",
          status: "archived",
          photos: [],
          pricing: {
            daily: {
              amount: 50,
              currency: "CAD",
            },
          },
        },
      ]),
    } as any;
    const postingsSearchService = {
      isElasticsearchEnabled: () => true,
      ensureLiveIndex: jest.fn(async () => undefined),
      isLiveMappingStale: jest.fn(async () => false),
      getWriteAliasName: () => "postings-write",
      bulkUpsertDocuments: jest.fn(async () => undefined),
      bulkDeleteDocuments: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as any,
    );

    const processed = await service.processReconciliationBatch(25);

    expect(processed).toBe(2);
    expect(postingsSearchService.bulkUpsertDocuments).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "posting-1" })]),
      "postings-write",
    );
    expect(postingsSearchService.bulkDeleteDocuments).toHaveBeenCalledWith(
      ["posting-2"],
      "postings-write",
    );
  });

  it("falls back to per-document reconciliation when bulk sync fails", async () => {
    const postingsRepository = {
      listRecentForIndexReconciliation: jest.fn(async () => [
        {
          id: "posting-1",
          status: "published",
          photos: [],
          pricing: {
            daily: {
              amount: 100,
              currency: "CAD",
            },
          },
        },
        {
          id: "posting-2",
          status: "archived",
          photos: [],
          pricing: {
            daily: {
              amount: 50,
              currency: "CAD",
            },
          },
        },
      ]),
    } as any;
    const postingsSearchService = {
      isElasticsearchEnabled: () => true,
      ensureLiveIndex: jest.fn(async () => undefined),
      isLiveMappingStale: jest.fn(async () => false),
      getWriteAliasName: () => "postings-write",
      bulkUpsertDocuments: jest.fn(async () => {
        throw new Error("bulk upsert failed");
      }),
      bulkDeleteDocuments: jest.fn(async () => {
        throw new Error("bulk delete failed");
      }),
      upsertDocument: jest.fn(async () => undefined),
      deleteDocument: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as any,
    );

    const processed = await service.processReconciliationBatch(25);

    expect(processed).toBe(2);
    expect(postingsSearchService.upsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: "posting-1" }),
    );
    expect(postingsSearchService.deleteDocument).toHaveBeenCalledWith(
      "posting-2",
    );
  });

  it("skips reconciliation when Elasticsearch is disabled", async () => {
    const postingsRepository = {
      listRecentForIndexReconciliation: jest.fn(async () => []),
    } as any;
    const postingsSearchService = {
      isElasticsearchEnabled: () => false,
      ensureLiveIndex: jest.fn(async () => undefined),
      isLiveMappingStale: jest.fn(async () => false),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as any,
    );

    await expect(service.processReconciliationBatch(25)).resolves.toBe(0);
    expect(postingsSearchService.ensureLiveIndex).not.toHaveBeenCalled();
    expect(
      postingsRepository.listRecentForIndexReconciliation,
    ).not.toHaveBeenCalled();
  });

  it("returns zero reconciliation work when there are no recent postings", async () => {
    const postingsRepository = {
      listRecentForIndexReconciliation: jest.fn(async () => []),
    } as any;
    const postingsSearchService = {
      isElasticsearchEnabled: () => true,
      ensureLiveIndex: jest.fn(async () => undefined),
      isLiveMappingStale: jest.fn(async () => false),
      getWriteAliasName: () => "postings-write",
      bulkUpsertDocuments: jest.fn(async () => undefined),
      bulkDeleteDocuments: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as any,
    );

    await expect(service.processReconciliationBatch(25)).resolves.toBe(0);
    expect(postingsSearchService.ensureLiveIndex).toHaveBeenCalledTimes(1);
    expect(postingsSearchService.bulkUpsertDocuments).not.toHaveBeenCalled();
    expect(postingsSearchService.bulkDeleteDocuments).not.toHaveBeenCalled();
  });

  it("replays dead-lettered outbox rows back into the relay pipeline", async () => {
    const postingsRepository = {
      reviveDeadLetteredSearchOutbox: jest.fn(async () => 7),
    } as any;
    const service = new SearchService(postingsRepository, {} as any, {} as any);

    await expect(service.replayDeadLetteredOutbox(25)).resolves.toEqual({
      revived: 7,
    });
    expect(
      postingsRepository.reviveDeadLetteredSearchOutbox,
    ).toHaveBeenCalledWith(25);
  });

  it("skips retained-index cleanup when Elasticsearch is disabled", async () => {
    const service = new SearchService(
      {
        listCompletedSearchReindexRunsWithRetainedIndices: jest.fn(),
      } as any,
      {
        isElasticsearchEnabled: () => false,
      } as any,
      {} as any,
    );

    await expect(service.cleanupRetainedIndices()).resolves.toEqual({
      deleted: 0,
    });
  });

  it("cleans up retained concrete indices that are no longer active", async () => {
    const clearSearchReindexRunRetainedIndexName = jest.fn(
      async () => undefined,
    );
    const postingsRepository = {
      listCompletedSearchReindexRunsWithRetainedIndices: jest.fn(async () => [
        {
          id: "run-1",
          status: "completed" as const,
          targetIndexName: "postings_v2",
          retainedIndexName: "postings_v0",
          sourceSnapshotAt: "2026-04-27T00:00:00.000Z",
          totalPostings: 10,
          indexedPostings: 10,
          failedPostings: 0,
          completedAt: "2026-04-27T00:10:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:10:00.000Z",
        },
        {
          id: "run-2",
          status: "completed" as const,
          targetIndexName: "postings_v3",
          retainedIndexName: "postings_v2",
          sourceSnapshotAt: "2026-04-28T00:00:00.000Z",
          totalPostings: 12,
          indexedPostings: 12,
          failedPostings: 0,
          completedAt: "2026-04-28T00:10:00.000Z",
          createdAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:10:00.000Z",
        },
      ]),
      clearSearchReindexRunRetainedIndexName,
    } as any;
    const postingsSearchService = {
      isElasticsearchEnabled: () => true,
      getAliasStatus: jest.fn(async () => ({
        state: "ready" as const,
        readAlias: "postings-read",
        writeAlias: "postings-write",
        readTargets: ["postings_v4"],
        writeTargets: ["postings_v4"],
      })),
      deleteConcreteIndex: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as any,
    );

    await expect(service.cleanupRetainedIndices()).resolves.toEqual({
      deleted: 2,
    });
    expect(postingsSearchService.deleteConcreteIndex).toHaveBeenCalledWith(
      "postings_v0",
    );
    expect(postingsSearchService.deleteConcreteIndex).toHaveBeenCalledWith(
      "postings_v2",
    );
    expect(clearSearchReindexRunRetainedIndexName).toHaveBeenCalledWith(
      "run-1",
    );
    expect(clearSearchReindexRunRetainedIndexName).toHaveBeenCalledWith(
      "run-2",
    );
  });

  it("skips retained-index cleanup for missing or still-active indices", async () => {
    const clearSearchReindexRunRetainedIndexName = jest.fn(
      async () => undefined,
    );
    const postingsRepository = {
      listCompletedSearchReindexRunsWithRetainedIndices: jest.fn(async () => [
        {
          id: "run-1",
          status: "completed" as const,
          targetIndexName: "postings_v2",
          retainedIndexName: null,
          sourceSnapshotAt: "2026-04-27T00:00:00.000Z",
          totalPostings: 10,
          indexedPostings: 10,
          failedPostings: 0,
          completedAt: "2026-04-27T00:10:00.000Z",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:10:00.000Z",
        },
        {
          id: "run-2",
          status: "completed" as const,
          targetIndexName: "postings_v3",
          retainedIndexName: "postings_v4",
          sourceSnapshotAt: "2026-04-28T00:00:00.000Z",
          totalPostings: 12,
          indexedPostings: 12,
          failedPostings: 0,
          completedAt: "2026-04-28T00:10:00.000Z",
          createdAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:10:00.000Z",
        },
      ]),
      clearSearchReindexRunRetainedIndexName,
    } as any;
    const postingsSearchService = {
      isElasticsearchEnabled: () => true,
      getAliasStatus: jest.fn(async () => ({
        state: "ready" as const,
        readAlias: "postings-read",
        writeAlias: "postings-write",
        readTargets: ["postings_v4"],
        writeTargets: ["postings_v4"],
      })),
      deleteConcreteIndex: jest.fn(async () => undefined),
    } as any;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as any,
    );

    await expect(service.cleanupRetainedIndices()).resolves.toEqual({
      deleted: 0,
    });
    expect(postingsSearchService.deleteConcreteIndex).not.toHaveBeenCalled();
    expect(clearSearchReindexRunRetainedIndexName).not.toHaveBeenCalled();
  });
});
