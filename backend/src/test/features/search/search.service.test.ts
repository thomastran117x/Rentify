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
    } as never;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      createVersionedIndex: jest.fn(async () => "postings_v2"),
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as never,
    );

    const result = await service.startReindex();

    expect(withSearchReindexStartLock).toHaveBeenCalledTimes(1);
    expect(postingsSearchService.ensureLiveIndex).toHaveBeenCalledTimes(1);
    expect(postingsSearchService.createVersionedIndex).toHaveBeenCalledTimes(1);
    expect(createSearchReindexRun).toHaveBeenCalledWith("postings_v2");
    expect(result).toMatchObject({
      id: "run-1",
      targetIndexName: "postings_v2",
    });
  });

  it("returns a conflict when the start lock cannot be acquired", async () => {
    const postingsRepository = {
      withSearchReindexStartLock: jest.fn(async () => null),
    } as never;
    const service = new SearchService(
      postingsRepository,
      {} as never,
      {} as never,
    );

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
      } as never,
      {
        ensureLiveIndex: jest.fn(async () => undefined),
        createVersionedIndex: jest.fn(async () => "postings_v2"),
      } as never,
      {} as never,
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
    } as never;
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
    } as never;
    const searchQueueService = {
      getQueueCounts: jest.fn(async () => ({
        main: { ready: 99, consumers: 9 },
      })),
    } as never;
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
      } as never,
      {} as never,
      {} as never,
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
    } as never;
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
    } as never;
    const searchQueueService = {
      getQueueCounts: jest.fn(async () => {
        throw new Error("broker unavailable");
      }),
    } as never;
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
    } as never;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
    } as never;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
      publishIndexJob: jest.fn(async () => undefined),
    } as never;
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
    } as never;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
    } as never;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
      publishIndexJob: jest.fn(async () => undefined),
    } as never;
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
    } as never;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
    } as never;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
      publishIndexJob: jest.fn(async () => {
        throw new Error("broker unavailable");
      }),
    } as never;
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
    } as never;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
    } as never;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
      publishIndexJob: jest.fn(async () => {
        throw new Error("broker unavailable");
      }),
    } as never;
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
    } as never;
    const postingsSearchService = {
      deleteDocument: jest.fn(async () => undefined),
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as never,
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
          postingId: null,
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
      } as never,
      {} as never,
      {} as never,
    );

    await service.processIndexJob(
      {
        outboxId: "barrier-1",
        eventId: "barrier-1",
        dedupeKey: "barrier-1",
        operation: "barrier",
        jobType: "barrier",
        postingId: null,
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
    } as never;
    const service = new SearchService(
      {
        getSearchOutboxById: jest.fn(async () => ({
          id: "outbox-1",
          postingId: null,
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
      } as never,
      {} as never,
      searchQueueService,
    );

    await service.processIndexJob(
      {
        outboxId: "outbox-1",
        eventId: "outbox-1",
        dedupeKey: "outbox-1",
        operation: "upsert",
        jobType: "upsert",
        postingId: null,
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
    } as never;
    const service = new SearchService(
      {
        getSearchOutboxById: jest.fn(async () => ({
          id: "outbox-3",
          postingId: null,
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
      } as never,
      {} as never,
      searchQueueService,
    );

    await service.processIndexJob(
      {
        outboxId: "outbox-3",
        eventId: "outbox-3",
        dedupeKey: "outbox-3",
        operation: "delete",
        jobType: "delete",
        postingId: null,
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

  it("heartbeats reindex processing and clears waiting runs for the next poll", async () => {
    const touchSearchReindexRunProcessing = jest.fn(async () => undefined);
    const clearSearchReindexRunProcessing = jest.fn(async () => undefined);
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
      markSearchReindexRunRunning: jest.fn(async () => undefined),
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
    } as never;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      bulkUpsertDocuments: jest.fn(async () => undefined),
    } as never;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    await service.processReindexRuns(200);
    await service.processReindexRuns(200);

    expect(
      postingsRepository.countPublishedPostingsForIndexing,
    ).toHaveBeenCalledWith("2026-04-27T00:00:00.000Z");
    expect(
      postingsRepository.listPublishedForIndexingBatch,
    ).toHaveBeenCalledWith(200, undefined, "2026-04-27T00:00:00.000Z");
    expect(touchSearchReindexRunProcessing).toHaveBeenCalled();
    expect(clearSearchReindexRunProcessing).toHaveBeenCalledWith("run-1");
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
    } as never;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
    } as never;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
    } as never;
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
      countPublishedPostingsForIndexing: jest.fn(async () => 1),
      markSearchReindexRunRunning: jest.fn(async () => undefined),
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
    } as never;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
      bulkUpsertDocuments: jest.fn(async () => {
        throw new Error("amqp broker unavailable");
      }),
    } as never;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      searchQueueService,
    );

    const processed = await service.processReindexRuns(100);

    expect(processed).toBe(0);
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
    } as never;
    const postingsSearchService = {
      getWriteAliasName: () => "postings-write",
      bulkUpsertDocuments: jest.fn(async () => undefined),
      bulkDeleteDocuments: jest.fn(async () => undefined),
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as never,
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
    } as never;
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
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {
        publishRetryJob: jest.fn(async () => undefined),
        publishDeadLetterJob: jest.fn(async () => undefined),
      } as never,
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
    } as never;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
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
    } as never;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
    } as never;
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
    } as never;
    const postingsSearchService = {
      ensureLiveIndex: jest.fn(async () => undefined),
    } as never;
    const searchQueueService = {
      ensureTopology: jest.fn(async () => undefined),
    } as never;
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
    } as never;
    const postingsSearchService = {
      isElasticsearchEnabled: () => true,
      ensureLiveIndex: jest.fn(async () => undefined),
      getWriteAliasName: () => "postings-write",
      bulkUpsertDocuments: jest.fn(async () => undefined),
      bulkDeleteDocuments: jest.fn(async () => undefined),
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as never,
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
    } as never;
    const postingsSearchService = {
      isElasticsearchEnabled: () => true,
      ensureLiveIndex: jest.fn(async () => undefined),
      getWriteAliasName: () => "postings-write",
      bulkUpsertDocuments: jest.fn(async () => {
        throw new Error("bulk upsert failed");
      }),
      bulkDeleteDocuments: jest.fn(async () => {
        throw new Error("bulk delete failed");
      }),
      upsertDocument: jest.fn(async () => undefined),
      deleteDocument: jest.fn(async () => undefined),
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as never,
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
    } as never;
    const postingsSearchService = {
      isElasticsearchEnabled: () => false,
      ensureLiveIndex: jest.fn(async () => undefined),
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as never,
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
    } as never;
    const postingsSearchService = {
      isElasticsearchEnabled: () => true,
      ensureLiveIndex: jest.fn(async () => undefined),
      getWriteAliasName: () => "postings-write",
      bulkUpsertDocuments: jest.fn(async () => undefined),
      bulkDeleteDocuments: jest.fn(async () => undefined),
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as never,
    );

    await expect(service.processReconciliationBatch(25)).resolves.toBe(0);
    expect(postingsSearchService.ensureLiveIndex).toHaveBeenCalledTimes(1);
    expect(postingsSearchService.bulkUpsertDocuments).not.toHaveBeenCalled();
    expect(postingsSearchService.bulkDeleteDocuments).not.toHaveBeenCalled();
  });

  it("replays dead-lettered outbox rows back into the relay pipeline", async () => {
    const postingsRepository = {
      reviveDeadLetteredSearchOutbox: jest.fn(async () => 7),
    } as never;
    const service = new SearchService(
      postingsRepository,
      {} as never,
      {} as never,
    );

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
      } as never,
      {
        isElasticsearchEnabled: () => false,
      } as never,
      {} as never,
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
    } as never;
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
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as never,
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
    } as never;
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
    } as never;
    const service = new SearchService(
      postingsRepository,
      postingsSearchService,
      {} as never,
    );

    await expect(service.cleanupRetainedIndices()).resolves.toEqual({
      deleted: 0,
    });
    expect(postingsSearchService.deleteConcreteIndex).not.toHaveBeenCalled();
    expect(clearSearchReindexRunRetainedIndexName).not.toHaveBeenCalled();
  });
});
