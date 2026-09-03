import { OrganizationsSearchService } from "@/features/organizations/search/search.service";
import { ElasticsearchUnavailableError } from "@/configuration/resources/elasticsearch";
import { testUuid } from "../../../support/uuid";
const BARRIER_1_ID = testUuid(9200, 557311);
const O1_ID = testUuid(9200, 3490);
const O2_ID = testUuid(9200, 3491);
const OLD_RUN_ID = testUuid(9200, 391785);
const ORG_1_ID = testUuid(9200, 9234);
const OUTBOX_1_ID = testUuid(9200, 747639);
const REINDEX_1_ID = testUuid(9200, 674617);

function createOutbox(overrides: Record<string, unknown> = {}) {
  return {
    id: OUTBOX_1_ID,
    organizationId: ORG_1_ID,
    operation: "upsert",
    dedupeKey: OUTBOX_1_ID,
    attempts: 0,
    publishAttempts: 0,
    availableAt: "2026-05-01T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createDocument(id: string) {
  return {
    id,
    name: `Org ${id}`,
    description: null,
    city: null,
    region: null,
    country: null,
    postalCode: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  };
}

function createReindexRun(overrides: Record<string, unknown> = {}) {
  return {
    id: REINDEX_1_ID,
    status: "pending",
    targetIndexName: "organizations_v1",
    sourceSnapshotAt: "2026-05-01T00:00:00.000Z",
    totalPostings: 0,
    indexedPostings: 0,
    failedPostings: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createHarness(overrides?: {
  repository?: Record<string, jest.Mock>;
  indexService?: Record<string, jest.Mock | (() => unknown)>;
  queueService?: Record<string, jest.Mock>;
}) {
  const repository = {
    getSearchOutboxById: jest.fn(async () => createOutbox()),
    getSearchOutboxesByIds: jest.fn(async () => [createOutbox()]),
    hasNewerSearchOutboxJob: jest.fn(async () => false),
    findByIdsForIndexing: jest.fn(async () => [createDocument(ORG_1_ID)]),
    markSearchOutboxIndexed: jest.fn(async () => undefined),
    markSearchOutboxesIndexed: jest.fn(async () => undefined),
    incrementSearchOutboxAttempt: jest.fn(async () => 1),
    markSearchOutboxDeadLettered: jest.fn(async () => undefined),
    markSearchOutboxPublishRetry: jest.fn(async () => undefined),
    markSearchOutboxRelayed: jest.fn(async () => undefined),
    releaseSearchOutboxClaims: jest.fn(async () => undefined),
    claimSearchOutboxBatch: jest.fn(async () => []),
    reviveDeadLetteredSearchOutbox: jest.fn(async () => 4),
    withSearchReindexStartLock: jest.fn(
      async (
        cb: (helpers: {
          findActiveSearchReindexRun: () => Promise<unknown>;
          createSearchReindexRun: (name: string) => Promise<unknown>;
        }) => Promise<unknown>,
      ) =>
        cb({
          findActiveSearchReindexRun: async () => null,
          createSearchReindexRun: async (name: string) =>
            createReindexRun({ targetIndexName: name }),
        }),
    ),
    findSearchReindexRunById: jest.fn(async () => createReindexRun()),
    findActiveSearchReindexRun: jest.fn(async () => null),
    findLatestSearchReindexRun: jest.fn(async () => null),
    findLatestCompletedSearchReindexRun: jest.fn(async () => null),
    listCompletedSearchReindexRunsWithRetainedIndices: jest.fn(async () => []),
    clearSearchReindexRunRetainedIndexName: jest.fn(async () => undefined),
    clearSearchReindexRunProcessing: jest.fn(async () => undefined),
    touchSearchReindexRunProcessing: jest.fn(async () => undefined),
    getSearchOutboxLagMetrics: jest.fn(async () => ({
      unpublishedCount: 0,
      publishedNotIndexedCount: 0,
      deadLetteredByOperation: { upsert: 0, delete: 0, barrier: 0 },
    })),
    claimNextSearchReindexRun: jest.fn(async () => null),
    countOrganizationsForIndexing: jest.fn(async () => 2),
    markSearchReindexRunRunning: jest.fn(async () => createReindexRun()),
    listForIndexingBatch: jest.fn(async () => []),
    updateSearchReindexRunProgress: jest.fn(async () => undefined),
    enqueueSearchReindexBarrier: jest.fn(async () => createOutbox()),
    getSearchReindexCatchUpState: jest.fn(async () => ({ state: "waiting" })),
    markSearchReindexRunCompleted: jest.fn(async () => createReindexRun()),
    markSearchReindexRunFailed: jest.fn(async () => createReindexRun()),
    listRecentForIndexReconciliation: jest.fn(async () => [
      createDocument(ORG_1_ID),
    ]),
    ...overrides?.repository,
  };
  const indexService = {
    isElasticsearchEnabled: () => true,
    ensureLiveIndex: jest.fn(async () => undefined),
    getAliasStatus: jest.fn(async () => ({
      state: "ready",
      readAlias: "organizations-read",
      writeAlias: "organizations-write",
      readTargets: ["organizations_v1"],
      writeTargets: ["organizations_v1"],
    })),
    getReadAliasName: () => "organizations-read",
    getWriteAliasName: () => "organizations-write",
    getCircuitBreakerState: () => ({
      state: "closed",
      consecutiveFailures: 0,
      failureThreshold: 3,
      cooldownMs: 30_000,
    }),
    buildVersionedIndexName: () => "organizations_v2",
    upsertDocument: jest.fn(async () => undefined),
    deleteDocument: jest.fn(async () => undefined),
    bulkUpsertDocuments: jest.fn(async () => undefined),
    bulkDeleteDocuments: jest.fn(async () => undefined),
    createVersionedIndex: jest.fn(async () => "organizations_v1"),
    swapAliases: jest.fn(async () => ({
      previousReadTargets: ["organizations_v0"],
      previousWriteTargets: ["organizations_v0"],
    })),
    deleteConcreteIndex: jest.fn(async () => undefined),
    ...overrides?.indexService,
  };
  const queueService = {
    ensureTopology: jest.fn(async () => undefined),
    getQueueCounts: jest.fn(async () => ({
      main: { ready: 0, consumers: 1 },
      retry1: { ready: 0, consumers: 0 },
      retry2: { ready: 0, consumers: 0 },
      retry3: { ready: 0, consumers: 0 },
      deadLetter: { ready: 0, consumers: 0 },
    })),
    publishIndexJob: jest.fn(async () => undefined),
    publishRetryJob: jest.fn(async () => undefined),
    publishDeadLetterJob: jest.fn(async () => undefined),
    ...overrides?.queueService,
  };

  const service = new OrganizationsSearchService(
    repository as any,
    indexService as any,
    queueService as any,
  );

  return { service, repository, indexService, queueService };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    outboxId: OUTBOX_1_ID,
    eventId: OUTBOX_1_ID,
    dedupeKey: OUTBOX_1_ID,
    operation: "upsert" as const,
    jobType: "upsert" as const,
    postingId: ORG_1_ID,
    targetIndexScope: "live" as const,
    occurredAt: "2026-05-01T00:00:00.000Z",
    attempt: 0,
    ...overrides,
  };
}

describe("OrganizationsSearchService", () => {
  describe("processIndexJob", () => {
    it("indexes the document for an upsert job", async () => {
      const { service, repository, indexService } = createHarness();
      await service.processIndexJob(payload(), 5);
      expect(indexService.upsertDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: ORG_1_ID }),
        undefined,
      );
      expect(repository.markSearchOutboxIndexed).toHaveBeenCalledWith(
        OUTBOX_1_ID,
      );
    });

    it("removes the document for a delete job", async () => {
      const { service, indexService } = createHarness({
        repository: {
          getSearchOutboxById: jest.fn(async () =>
            createOutbox({ operation: "delete" }),
          ),
        },
      });
      await service.processIndexJob(payload({ operation: "delete" }), 5);
      expect(indexService.deleteDocument).toHaveBeenCalledWith(
        ORG_1_ID,
        undefined,
      );
    });

    it("deletes when the organization no longer exists", async () => {
      const { service, indexService } = createHarness({
        repository: { findByIdsForIndexing: jest.fn(async () => []) },
      });
      await service.processIndexJob(payload(), 5);
      expect(indexService.deleteDocument).toHaveBeenCalled();
    });

    it("marks a barrier job as indexed without touching the index", async () => {
      const { service, repository, indexService } = createHarness({
        repository: {
          getSearchOutboxById: jest.fn(async () =>
            createOutbox({ operation: "barrier", organizationId: undefined }),
          ),
        },
      });
      await service.processIndexJob(payload({ operation: "barrier" }), 5);
      expect(indexService.upsertDocument).not.toHaveBeenCalled();
      expect(repository.markSearchOutboxIndexed).toHaveBeenCalledWith(
        OUTBOX_1_ID,
      );
    });

    it("retries a failed index job, then dead-letters at the attempt limit", async () => {
      const harness = createHarness({
        indexService: {
          upsertDocument: jest.fn(async () => {
            throw new Error("boom");
          }),
        },
        repository: { incrementSearchOutboxAttempt: jest.fn(async () => 1) },
      });
      await harness.service.processIndexJob(payload(), 5);
      expect(harness.queueService.publishRetryJob).toHaveBeenCalled();

      const atLimit = createHarness({
        indexService: {
          upsertDocument: jest.fn(async () => {
            throw new Error("boom");
          }),
        },
        repository: { incrementSearchOutboxAttempt: jest.fn(async () => 5) },
      });
      await atLimit.service.processIndexJob(payload(), 5);
      expect(atLimit.queueService.publishDeadLetterJob).toHaveBeenCalled();
      expect(
        atLimit.repository.markSearchOutboxDeadLettered,
      ).toHaveBeenCalled();
    });
  });

  describe("processIndexJobsBatch", () => {
    it("bulk indexes upserts and marks the outbox rows indexed", async () => {
      const { service, indexService, repository } = createHarness({
        repository: {
          getSearchOutboxesByIds: jest.fn(async () => [createOutbox()]),
        },
      });
      await service.processIndexJobsBatch([payload()], 5);
      expect(indexService.bulkUpsertDocuments).toHaveBeenCalled();
      expect(repository.markSearchOutboxesIndexed).toHaveBeenCalled();
    });

    it("bulk deletes when the organization row is gone", async () => {
      const { service, indexService } = createHarness({
        repository: {
          getSearchOutboxesByIds: jest.fn(async () => [createOutbox()]),
          findByIdsForIndexing: jest.fn(async () => []),
        },
      });
      await service.processIndexJobsBatch([payload()], 5);
      expect(indexService.bulkDeleteDocuments).toHaveBeenCalled();
    });

    it("ignores empty batches", async () => {
      const { service, repository } = createHarness();
      await service.processIndexJobsBatch([], 5);
      expect(repository.getSearchOutboxesByIds).not.toHaveBeenCalled();
    });
  });

  describe("processOutboxRelayBatch", () => {
    it("publishes claimed outbox jobs and marks them relayed", async () => {
      const { service, queueService, repository } = createHarness({
        repository: {
          claimSearchOutboxBatch: jest.fn(async () => [createOutbox()]),
        },
      });
      const processed = await service.processOutboxRelayBatch(10, 5);
      expect(processed).toBe(1);
      expect(queueService.publishIndexJob).toHaveBeenCalled();
      expect(repository.markSearchOutboxRelayed).toHaveBeenCalledWith(
        OUTBOX_1_ID,
        [],
        OUTBOX_1_ID,
      );
    });

    it("dead-letters a job that cannot be published", async () => {
      const { service, repository } = createHarness({
        repository: {
          claimSearchOutboxBatch: jest.fn(async () => [
            createOutbox({ publishAttempts: 5 }),
          ]),
        },
        queueService: {
          publishIndexJob: jest.fn(async () => {
            throw new Error("broker down");
          }),
        },
      });
      await service.processOutboxRelayBatch(10, 5);
      expect(repository.markSearchOutboxDeadLettered).toHaveBeenCalled();
    });

    it("retries publishing before dead-lettering when attempts remain", async () => {
      const { service, repository } = createHarness({
        repository: {
          claimSearchOutboxBatch: jest.fn(async () => [
            createOutbox({ publishAttempts: 0 }),
          ]),
        },
        queueService: {
          publishIndexJob: jest.fn(async () => {
            throw new Error("broker down");
          }),
        },
      });
      await service.processOutboxRelayBatch(10, 5);
      expect(repository.markSearchOutboxPublishRetry).toHaveBeenCalled();
    });

    it("coalesces multiple pending jobs for the same organization", async () => {
      const { service, queueService, repository } = createHarness({
        repository: {
          claimSearchOutboxBatch: jest.fn(async () => [
            createOutbox({ id: O1_ID }),
            createOutbox({ id: O2_ID }),
          ]),
        },
      });
      await service.processOutboxRelayBatch(10, 5);
      expect(queueService.publishIndexJob).toHaveBeenCalledTimes(1);
      expect(repository.markSearchOutboxRelayed).toHaveBeenCalledWith(
        O2_ID,
        [O1_ID],
        O2_ID,
      );
    });

    it("relays a barrier job as its own uncoalesced group", async () => {
      const { service, queueService, repository } = createHarness({
        repository: {
          claimSearchOutboxBatch: jest.fn(async () => [
            createOutbox({
              id: BARRIER_1_ID,
              operation: "barrier",
              organizationId: undefined,
              reindexRunId: REINDEX_1_ID,
            }),
          ]),
        },
      });
      await service.processOutboxRelayBatch(10, 5);
      expect(queueService.publishIndexJob).toHaveBeenCalledTimes(1);
      expect(repository.markSearchOutboxRelayed).toHaveBeenCalledWith(
        BARRIER_1_ID,
        [],
        BARRIER_1_ID,
      );
    });

    it("releases claims when the relayed state cannot be finalized", async () => {
      const { service, repository } = createHarness({
        repository: {
          claimSearchOutboxBatch: jest.fn(async () => [createOutbox()]),
          markSearchOutboxRelayed: jest.fn(async () => {
            throw new Error("db write failed");
          }),
        },
      });
      await service.processOutboxRelayBatch(10, 5);
      expect(repository.releaseSearchOutboxClaims).toHaveBeenCalled();
    });
  });

  describe("processIndexJobsBatch branches", () => {
    it("marks stale batch jobs indexed without reindexing", async () => {
      const { service, indexService, repository } = createHarness({
        repository: {
          getSearchOutboxesByIds: jest.fn(async () => [createOutbox()]),
          hasNewerSearchOutboxJob: jest.fn(async () => true),
        },
      });
      await service.processIndexJobsBatch([payload()], 5);
      expect(indexService.bulkUpsertDocuments).not.toHaveBeenCalled();
      expect(repository.markSearchOutboxesIndexed).toHaveBeenCalledWith([
        OUTBOX_1_ID,
      ]);
    });

    it("falls back to per-job processing when a bulk upsert fails", async () => {
      const bulkUpsert = jest
        .fn()
        .mockRejectedValueOnce(new Error("bulk failed"))
        .mockResolvedValue(undefined);
      const { service, indexService } = createHarness({
        repository: {
          getSearchOutboxesByIds: jest.fn(async () => [createOutbox()]),
        },
        indexService: { bulkUpsertDocuments: bulkUpsert },
      });
      await service.processIndexJobsBatch([payload()], 5);
      // The single-document fallback path indexes the document directly.
      expect(indexService.upsertDocument).toHaveBeenCalled();
    });

    it("bulk deletes delete-operation jobs in a batch", async () => {
      const { service, indexService, repository } = createHarness({
        repository: {
          getSearchOutboxesByIds: jest.fn(async () => [
            createOutbox({ operation: "delete" }),
          ]),
        },
      });
      await service.processIndexJobsBatch(
        [payload({ operation: "delete" })],
        5,
      );
      expect(indexService.bulkDeleteDocuments).toHaveBeenCalled();
      expect(repository.markSearchOutboxesIndexed).toHaveBeenCalled();
    });

    it("falls back to per-job processing when a bulk delete fails", async () => {
      const bulkDelete = jest
        .fn()
        .mockRejectedValueOnce(new Error("bulk delete failed"))
        .mockResolvedValue(undefined);
      const { service, indexService } = createHarness({
        repository: {
          getSearchOutboxesByIds: jest.fn(async () => [
            createOutbox({ operation: "delete" }),
          ]),
          getSearchOutboxById: jest.fn(async () =>
            createOutbox({ operation: "delete" }),
          ),
        },
        indexService: { bulkDeleteDocuments: bulkDelete },
      });
      await service.processIndexJobsBatch(
        [payload({ operation: "delete" })],
        5,
      );
      expect(indexService.deleteDocument).toHaveBeenCalled();
    });

    it("marks a batched barrier job indexed", async () => {
      const { service, repository } = createHarness({
        repository: {
          getSearchOutboxesByIds: jest.fn(async () => [
            createOutbox({ operation: "barrier", organizationId: undefined }),
          ]),
        },
      });
      await service.processIndexJobsBatch(
        [payload({ operation: "barrier" })],
        5,
      );
      expect(repository.markSearchOutboxesIndexed).toHaveBeenCalledWith([
        OUTBOX_1_ID,
      ]);
    });
  });

  describe("index job failure propagation", () => {
    it("rethrows when a retry job cannot be published", async () => {
      const { service } = createHarness({
        indexService: {
          upsertDocument: jest.fn(async () => {
            throw new Error("index boom");
          }),
        },
        repository: { incrementSearchOutboxAttempt: jest.fn(async () => 1) },
        queueService: {
          publishRetryJob: jest.fn(async () => {
            throw new Error("broker down");
          }),
        },
      });
      await expect(service.processIndexJob(payload(), 5)).rejects.toBeDefined();
    });

    it("rethrows when the dead-letter job cannot be published", async () => {
      const { service } = createHarness({
        indexService: {
          upsertDocument: jest.fn(async () => {
            throw new Error("index boom");
          }),
        },
        repository: { incrementSearchOutboxAttempt: jest.fn(async () => 5) },
        queueService: {
          publishDeadLetterJob: jest.fn(async () => {
            throw new Error("broker down");
          }),
        },
      });
      await expect(service.processIndexJob(payload(), 5)).rejects.toBeDefined();
    });
  });

  describe("reindex catch-up branches", () => {
    it("waits when the catch-up barrier has not drained", async () => {
      const { service, repository } = createHarness({
        repository: {
          claimNextSearchReindexRun: jest.fn(async () =>
            createReindexRun({ status: "waiting_for_catchup" }),
          ),
          getSearchReindexCatchUpState: jest.fn(async () => ({
            state: "waiting",
          })),
        },
      });
      const processed = await service.processReindexRuns(50);
      expect(processed).toBe(1);
      expect(repository.clearSearchReindexRunProcessing).toHaveBeenCalled();
    });

    it("fails the run when catch-up reports a failure", async () => {
      const { service, repository } = createHarness({
        repository: {
          claimNextSearchReindexRun: jest.fn(async () =>
            createReindexRun({ status: "waiting_for_catchup" }),
          ),
          getSearchReindexCatchUpState: jest.fn(async () => ({
            state: "failed",
            errorMessage: "barrier dead-lettered",
          })),
        },
      });
      await service.processReindexRuns(50);
      expect(repository.markSearchReindexRunFailed).toHaveBeenCalled();
    });
  });

  describe("status and reconciliation branches", () => {
    it("reports a disabled Elasticsearch status", async () => {
      const { service } = createHarness({
        indexService: { isElasticsearchEnabled: () => false },
      });
      const status = await service.getStatus();
      expect(status.elasticsearch.enabled).toBe(false);
      expect(status.aliases.health.state).toBe("disabled");
    });

    it("marks queue inspection as failed when counts cannot be read", async () => {
      const { service } = createHarness({
        queueService: {
          getQueueCounts: jest.fn(async () => {
            throw new Error("broker unreachable");
          }),
        },
      });
      const status = await service.getStatus();
      expect(status.queueInspection.ok).toBe(false);
    });

    it("reports degraded alias health when the cluster is unavailable", async () => {
      const { service } = createHarness({
        indexService: {
          getAliasStatus: jest.fn(async () => {
            throw new ElasticsearchUnavailableError("es down");
          }),
        },
      });
      const status = await service.getStatus();
      expect(status.aliases.health.state).toBe("unavailable");
    });

    it("returns no deletions when cleanup runs with Elasticsearch disabled", async () => {
      const { service, indexService } = createHarness({
        indexService: { isElasticsearchEnabled: () => false },
      });
      const result = await service.cleanupRetainedIndices();
      expect(result.deleted).toBe(0);
      expect(indexService.deleteConcreteIndex).not.toHaveBeenCalled();
    });

    it("falls back to per-document upserts when reconciliation bulk fails", async () => {
      const { service, indexService } = createHarness({
        indexService: {
          bulkUpsertDocuments: jest.fn(async () => {
            throw new Error("bulk failed");
          }),
        },
      });
      await service.processReconciliationBatch(50);
      expect(indexService.upsertDocument).toHaveBeenCalled();
    });
  });

  describe("reindex lifecycle", () => {
    it("starts a reindex run when none is active", async () => {
      const { service } = createHarness();
      const run = await service.startReindex();
      expect(run.targetIndexName).toBe("organizations_v2");
    });

    it("rejects starting a reindex when one is already active", async () => {
      const { service } = createHarness({
        repository: {
          withSearchReindexStartLock: jest.fn(
            async (
              cb: (helpers: {
                findActiveSearchReindexRun: () => Promise<unknown>;
                createSearchReindexRun: (name: string) => Promise<unknown>;
              }) => Promise<unknown>,
            ) =>
              cb({
                findActiveSearchReindexRun: async () => createReindexRun(),
                createSearchReindexRun: async () => createReindexRun(),
              }),
          ),
        },
      });
      await expect(service.startReindex()).rejects.toBeDefined();
    });

    it("rebuilds the target index for a pending run", async () => {
      const { service, indexService, repository } = createHarness({
        repository: {
          claimNextSearchReindexRun: jest.fn(async () =>
            createReindexRun({ status: "pending" }),
          ),
          listForIndexingBatch: jest
            .fn()
            .mockResolvedValueOnce([createDocument(ORG_1_ID)])
            .mockResolvedValueOnce([]),
        },
      });
      const processed = await service.processReindexRuns(50);
      expect(processed).toBe(1);
      expect(indexService.createVersionedIndex).toHaveBeenCalled();
      expect(indexService.bulkUpsertDocuments).toHaveBeenCalled();
      expect(repository.enqueueSearchReindexBarrier).toHaveBeenCalled();
    });

    it("swaps aliases once a catch-up run is complete", async () => {
      const { service, indexService, repository } = createHarness({
        repository: {
          claimNextSearchReindexRun: jest.fn(async () =>
            createReindexRun({ status: "waiting_for_catchup" }),
          ),
          getSearchReindexCatchUpState: jest.fn(async () => ({
            state: "caught_up",
          })),
        },
      });
      await service.processReindexRuns(50);
      expect(indexService.swapAliases).toHaveBeenCalledWith("organizations_v1");
      expect(repository.markSearchReindexRunCompleted).toHaveBeenCalled();
    });

    it("cleans up the previous retained index after an alias swap", async () => {
      const { service, indexService, repository } = createHarness({
        repository: {
          claimNextSearchReindexRun: jest.fn(async () =>
            createReindexRun({ status: "waiting_for_catchup" }),
          ),
          getSearchReindexCatchUpState: jest.fn(async () => ({
            state: "caught_up",
          })),
          findLatestCompletedSearchReindexRun: jest.fn(async () =>
            createReindexRun({
              id: OLD_RUN_ID,
              status: "completed",
              retainedIndexName: "organizations_vOld",
            }),
          ),
        },
      });
      await service.processReindexRuns(50);
      expect(indexService.deleteConcreteIndex).toHaveBeenCalledWith(
        "organizations_vOld",
      );
      expect(
        repository.clearSearchReindexRunRetainedIndexName,
      ).toHaveBeenCalledWith(OLD_RUN_ID);
    });

    it("marks the run failed on a non-transient error", async () => {
      const { service, repository } = createHarness({
        repository: {
          claimNextSearchReindexRun: jest.fn(async () =>
            createReindexRun({ status: "pending" }),
          ),
          countOrganizationsForIndexing: jest.fn(async () => {
            throw new Error("fatal");
          }),
        },
      });
      await service.processReindexRuns(50);
      expect(repository.markSearchReindexRunFailed).toHaveBeenCalled();
    });

    it("retries the run without failing on a transient error", async () => {
      const { service, repository } = createHarness({
        repository: {
          claimNextSearchReindexRun: jest.fn(async () =>
            createReindexRun({ status: "pending" }),
          ),
          countOrganizationsForIndexing: jest.fn(async () => {
            throw new ElasticsearchUnavailableError("es down");
          }),
        },
      });
      const processed = await service.processReindexRuns(50);
      expect(processed).toBe(0);
      expect(repository.clearSearchReindexRunProcessing).toHaveBeenCalled();
      expect(repository.markSearchReindexRunFailed).not.toHaveBeenCalled();
    });

    it("returns zero when there is no reindex run to process", async () => {
      const { service } = createHarness();
      expect(await service.processReindexRuns(50)).toBe(0);
    });

    it("looks up a reindex run by id", async () => {
      const { service } = createHarness();
      const run = await service.getReindexRun(REINDEX_1_ID);
      expect(run?.id).toBe(REINDEX_1_ID);
    });
  });

  describe("maintenance", () => {
    it("reconciles recent organizations into the index", async () => {
      const { service, indexService } = createHarness();
      const count = await service.processReconciliationBatch(50);
      expect(count).toBe(1);
      expect(indexService.bulkUpsertDocuments).toHaveBeenCalled();
    });

    it("skips reconciliation when Elasticsearch is disabled", async () => {
      const { service, repository } = createHarness({
        indexService: { isElasticsearchEnabled: () => false },
      });
      expect(await service.processReconciliationBatch(50)).toBe(0);
      expect(
        repository.listRecentForIndexReconciliation,
      ).not.toHaveBeenCalled();
    });

    it("replays dead-lettered outbox rows", async () => {
      const { service } = createHarness();
      expect(await service.replayDeadLetteredOutbox(50)).toEqual({
        revived: 4,
      });
    });

    it("deletes retained indices that are no longer referenced by an alias", async () => {
      const { service, indexService } = createHarness({
        repository: {
          listCompletedSearchReindexRunsWithRetainedIndices: jest.fn(
            async () => [
              createReindexRun({ retainedIndexName: "organizations_v0" }),
            ],
          ),
        },
      });
      const result = await service.cleanupRetainedIndices();
      expect(result.deleted).toBe(1);
      expect(indexService.deleteConcreteIndex).toHaveBeenCalledWith(
        "organizations_v0",
      );
    });

    it("reports pipeline status", async () => {
      const { service } = createHarness();
      const status = await service.getStatus();
      expect(status.aliases.read).toBe("organizations-read");
      expect(status.elasticsearch.enabled).toBe(true);
      expect(status.queueInspection.ok).toBe(true);
    });
  });
});
