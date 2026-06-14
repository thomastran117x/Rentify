import ConflictError from "@/errors/http/conflict.error";
import { ElasticsearchUnavailableError } from "@/configuration/resources/elasticsearch";
import type {
  PostingSearchDocument,
  PostingSearchOutboxRecord,
} from "@/features/postings/postings.model";
import { isPostingSearchIndexable } from "@/features/postings/postings.model";
import { PostingsSearchIndexService } from "@/features/postings/search/index.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type {
  CleanupRetainedSearchIndicesResult,
  SearchAliasStatus,
  SearchIndexJobPayload,
  SearchQueueCounts,
  ReplayDeadLetteredSearchOutboxResult,
  SearchReindexRunRecord,
  SearchStatusResult,
} from "@/features/search/search.model";
import { SearchQueueService } from "@/features/search/search.queue.service";
import {
  getSearchTelemetrySnapshot,
  recordQueueInspectionFailure,
  recordReindexRunCompleted,
  recordReindexRunFailed,
} from "@/features/search/search.telemetry";
import { loggerFactory, type Logger } from "@/configuration/logging";

function createEmptyQueueCounts(): SearchQueueCounts {
  return {
    ready: 0,
    consumers: 0,
  };
}

const REINDEX_HEARTBEAT_BULK_CHUNK_SIZE = 100;
const TRANSIENT_REINDEX_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ETIMEDOUT",
]);

class SearchReindexCatchUpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchReindexCatchUpError";
  }
}

type BatchedIndexEntry = {
  job: PostingSearchOutboxRecord;
  payload: SearchIndexJobPayload;
};

type BatchedUpsertGroup = {
  documents: PostingSearchDocument[];
  entries: BatchedIndexEntry[];
};

type BatchedDeleteGroup = {
  ids: string[];
  entries: BatchedIndexEntry[];
};

export class SearchService {
  private readonly logger: Logger;

  constructor(
    private readonly postingsRepository: PostingsRepository,
    private readonly postingsSearchIndexService: PostingsSearchIndexService,
    private readonly searchQueueService: SearchQueueService,
  ) {
    this.logger = loggerFactory.forClass(SearchService, "service");
  }

  async startReindex(): Promise<SearchReindexRunRecord> {
    const run = await this.postingsRepository.withSearchReindexStartLock(
      async ({ findActiveSearchReindexRun, createSearchReindexRun }) => {
        const activeRun = await findActiveSearchReindexRun();

        if (activeRun) {
          throw new ConflictError("A search reindex run is already active.");
        }

        return createSearchReindexRun(
          this.postingsSearchIndexService.buildVersionedIndexName(),
        );
      },
    );

    if (!run) {
      throw new ConflictError("A search reindex run is already active.");
    }

    return run;
  }

  async getReindexRun(id: string): Promise<SearchReindexRunRecord | null> {
    return this.postingsRepository.findSearchReindexRunById(id);
  }

  async replayDeadLetteredOutbox(
    limit: number,
  ): Promise<ReplayDeadLetteredSearchOutboxResult> {
    const revived =
      await this.postingsRepository.reviveDeadLetteredSearchOutbox(limit);

    return {
      revived,
    };
  }

  async cleanupRetainedIndices(): Promise<CleanupRetainedSearchIndicesResult> {
    if (!this.postingsSearchIndexService.isElasticsearchEnabled()) {
      return {
        deleted: 0,
      };
    }

    const aliasStatus = await this.postingsSearchIndexService.getAliasStatus();
    const activeTargets = new Set([
      ...aliasStatus.readTargets,
      ...aliasStatus.writeTargets,
    ]);
    const runs =
      await this.postingsRepository.listCompletedSearchReindexRunsWithRetainedIndices();
    let deleted = 0;

    for (const run of runs) {
      const indexName = run.retainedIndexName;

      if (!indexName || activeTargets.has(indexName)) {
        continue;
      }

      await this.postingsSearchIndexService.deleteConcreteIndex(indexName);
      await this.postingsRepository.clearSearchReindexRunRetainedIndexName(
        run.id,
      );
      deleted += 1;
    }

    return {
      deleted,
    };
  }

  async getStatus(): Promise<SearchStatusResult> {
    const [
      aliasHealth,
      currentReindexRun,
      latestReindexRun,
      lagMetrics,
      queueInspection,
    ] = await Promise.all([
      this.readAliasHealth(),
      this.postingsRepository.findActiveSearchReindexRun(),
      this.postingsRepository.findLatestSearchReindexRun(),
      this.postingsRepository.getSearchOutboxLagMetrics(),
      this.postingsSearchIndexService.isElasticsearchEnabled()
        ? this.searchQueueService
            .getQueueCounts()
            .then((counts) => ({
              inspection: {
                ok: true as const,
              },
              counts,
            }))
            .catch((error) => {
              recordQueueInspectionFailure();
              return {
                inspection: {
                  ok: false as const,
                  error:
                    error instanceof Error
                      ? error.message
                      : "Unable to inspect search queues.",
                },
              };
            })
        : Promise.resolve({
            inspection: {
              ok: true as const,
            },
            counts: {
              main: createEmptyQueueCounts(),
              retry1: createEmptyQueueCounts(),
              retry2: createEmptyQueueCounts(),
              retry3: createEmptyQueueCounts(),
              deadLetter: createEmptyQueueCounts(),
            },
          }),
    ]);
    const telemetry = getSearchTelemetrySnapshot();

    return {
      aliases: {
        read: this.postingsSearchIndexService.getReadAliasName(),
        write: this.postingsSearchIndexService.getWriteAliasName(),
        readTargets: aliasHealth.readTargets,
        writeTargets: aliasHealth.writeTargets,
        health: aliasHealth,
      },
      elasticsearch: {
        enabled: this.postingsSearchIndexService.isElasticsearchEnabled(),
        circuitBreaker:
          this.postingsSearchIndexService.getCircuitBreakerState(),
        telemetry: {
          ...telemetry.elasticsearchRequests,
          ...telemetry.circuitBreaker,
        },
      },
      currentReindexRun: currentReindexRun ?? undefined,
      latestReindexRun: latestReindexRun ?? undefined,
      pendingOutboxCount: lagMetrics.unpublishedCount,
      pendingOutboxOldestAgeMs: lagMetrics.unpublishedOldestAgeMs,
      lag: lagMetrics,
      queueInspection: queueInspection.inspection,
      ...("counts" in queueInspection
        ? { queueCounts: queueInspection.counts }
        : {}),
      telemetry: {
        fallbacks: telemetry.fallbacks,
        queueInspectionFailures: telemetry.queueInspectionFailures,
        reindexRuns: telemetry.reindexRuns,
        aliasActions: telemetry.aliasActions,
      },
    };
  }

  async processOutboxRelayBatch(
    limit: number,
    maxPublishAttempts: number,
  ): Promise<number> {
    await this.postingsSearchIndexService.ensureLiveIndex();
    await this.searchQueueService.ensureTopology();

    const jobs = await this.postingsRepository.claimSearchOutboxBatch(limit);
    const relayJobs = this.coalesceRelayJobs(jobs);

    for (const relayJob of relayJobs) {
      const job = relayJob.primary;
      let publishedToBroker = false;
      let publishError: string | undefined;
      const claimedIds = [job.id, ...relayJob.supersededIds];

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await this.searchQueueService.publishIndexJob(this.toIndexJob(job));
          publishedToBroker = true;
          break;
        } catch (error) {
          publishError =
            error instanceof Error ? error.message : "Unknown relay error.";
        }
      }

      if (!publishedToBroker) {
        try {
          const errorMessage = publishError ?? "Unknown relay error.";
          await this.postingsRepository.releaseSearchOutboxClaims(
            relayJob.supersededIds,
            errorMessage,
          );

          if (job.publishAttempts + 1 >= maxPublishAttempts) {
            await this.postingsRepository.markSearchOutboxDeadLettered(
              job.id,
              errorMessage,
            );
          } else {
            await this.postingsRepository.markSearchOutboxPublishRetry(
              job.id,
              job.publishAttempts + 1,
              errorMessage,
            );
          }
        } catch (error) {
          this.logger.error(
            "Failed to persist relay failure state.",
            {
              outboxId: job.id,
            },
            error,
          );
        }

        continue;
      }

      try {
        await this.postingsRepository.markSearchOutboxRelayed(
          job.id,
          relayJob.supersededIds,
          job.id,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown relay state error.";
        await this.postingsRepository.releaseSearchOutboxClaims(
          claimedIds,
          errorMessage,
        );
        this.logger.error(
          "Search relay publish succeeded but outbox state could not be finalized.",
          {
            outboxId: job.id,
            supersededIds: relayJob.supersededIds,
          },
          error,
        );
      }
    }

    return jobs.length;
  }

  async processIndexJob(
    payload: SearchIndexJobPayload,
    maxAttempts: number,
  ): Promise<void> {
    const job = await this.postingsRepository.getSearchOutboxById(
      payload.outboxId,
    );

    if (!job || job.deadLetteredAt || job.indexedAt) {
      return;
    }

    if (job.operation === "barrier") {
      await this.postingsRepository.markSearchOutboxIndexed(job.id);
      return;
    }

    try {
      if (!job.postingId) {
        throw new Error("Search outbox job is missing a posting id.");
      }

      if (await this.postingsRepository.hasNewerSearchOutboxJob(job)) {
        this.logStaleOutboxJob(job);
        await this.postingsRepository.markSearchOutboxIndexed(job.id);
        return;
      }

      if (job.operation === "delete") {
        await this.postingsSearchIndexService.deleteDocument(
          job.postingId,
          job.targetIndexName,
        );
      } else {
        const documents = await this.postingsRepository.findByIdsForIndexing([
          job.postingId,
        ]);
        const document = documents[0];

        if (!document || !isPostingSearchIndexable(document.status)) {
          await this.postingsSearchIndexService.deleteDocument(
            job.postingId,
            job.targetIndexName,
          );
        } else {
          await this.postingsSearchIndexService.upsertDocument(
            document,
            job.targetIndexName,
          );
        }
      }

      await this.postingsRepository.markSearchOutboxIndexed(job.id);
    } catch (error) {
      await this.handleIndexJobFailure(job, payload, maxAttempts, error);
    }
  }

  async processIndexJobsBatch(
    payloads: SearchIndexJobPayload[],
    maxAttempts: number,
  ): Promise<void> {
    if (payloads.length === 0) {
      return;
    }

    const uniquePayloads = Array.from(
      new Map(payloads.map((payload) => [payload.outboxId, payload])).values(),
    );
    const jobs = await this.postingsRepository.getSearchOutboxesByIds(
      uniquePayloads.map((payload) => payload.outboxId),
    );
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const immediateIndexIds: string[] = [];
    const fallbackPayloads: SearchIndexJobPayload[] = [];
    const upsertCandidates: BatchedIndexEntry[] = [];
    const deleteCandidates: BatchedIndexEntry[] = [];

    for (const payload of uniquePayloads) {
      const job = jobsById.get(payload.outboxId);

      if (!job || job.deadLetteredAt || job.indexedAt) {
        continue;
      }

      if (job.operation === "barrier") {
        immediateIndexIds.push(job.id);
        continue;
      }

      try {
        if (!job.postingId) {
          throw new Error("Search outbox job is missing a posting id.");
        }

        if (await this.postingsRepository.hasNewerSearchOutboxJob(job)) {
          this.logStaleOutboxJob(job);
          immediateIndexIds.push(job.id);
          continue;
        }

        if (job.operation === "delete") {
          deleteCandidates.push({
            job,
            payload,
          });
          continue;
        }

        upsertCandidates.push({
          job,
          payload,
        });
      } catch (error) {
        await this.handleIndexJobFailure(job, payload, maxAttempts, error);
      }
    }

    if (immediateIndexIds.length > 0) {
      await this.postingsRepository.markSearchOutboxesIndexed(
        immediateIndexIds,
      );
    }

    const documents = await this.postingsRepository.findByIdsForIndexing(
      upsertCandidates.map(({ job }) => job.postingId!).filter(Boolean),
    );
    const documentsById = new Map(
      documents.map((document) => [document.id, document]),
    );
    const upsertGroups = new Map<string, BatchedUpsertGroup>();
    const deleteGroups = new Map<string, BatchedDeleteGroup>();

    for (const entry of upsertCandidates) {
      const document = documentsById.get(entry.job.postingId!);

      if (!document || !isPostingSearchIndexable(document.status)) {
        const deleteGroup = this.getOrCreateDeleteGroup(
          deleteGroups,
          this.resolveIndexTargetName(entry.job),
        );
        deleteGroup.ids.push(entry.job.postingId!);
        deleteGroup.entries.push(entry);
        continue;
      }

      const upsertGroup = this.getOrCreateUpsertGroup(
        upsertGroups,
        this.resolveIndexTargetName(entry.job),
      );
      upsertGroup.documents.push(document);
      upsertGroup.entries.push(entry);
    }

    for (const entry of deleteCandidates) {
      const deleteGroup = this.getOrCreateDeleteGroup(
        deleteGroups,
        this.resolveIndexTargetName(entry.job),
      );
      deleteGroup.ids.push(entry.job.postingId!);
      deleteGroup.entries.push(entry);
    }

    await Promise.all(
      Array.from(upsertGroups.entries(), async ([targetIndexName, group]) => {
        try {
          await this.postingsSearchIndexService.bulkUpsertDocuments(
            group.documents,
            targetIndexName,
          );
          await this.postingsRepository.markSearchOutboxesIndexed(
            group.entries.map(({ job }) => job.id),
          );
        } catch (error) {
          this.logger.warn(
            "Falling back to per-job upsert processing after bulk indexing failed.",
            {
              targetIndexName,
              jobIds: group.entries.map(({ job }) => job.id),
            },
            error,
          );
          fallbackPayloads.push(...group.entries.map(({ payload }) => payload));
        }
      }),
    );

    await Promise.all(
      Array.from(deleteGroups.entries(), async ([targetIndexName, group]) => {
        try {
          await this.postingsSearchIndexService.bulkDeleteDocuments(
            Array.from(new Set(group.ids)),
            targetIndexName,
          );
          await this.postingsRepository.markSearchOutboxesIndexed(
            group.entries.map(({ job }) => job.id),
          );
        } catch (error) {
          this.logger.warn(
            "Falling back to per-job delete processing after bulk delete failed.",
            {
              targetIndexName,
              jobIds: group.entries.map(({ job }) => job.id),
            },
            error,
          );
          fallbackPayloads.push(...group.entries.map(({ payload }) => payload));
        }
      }),
    );

    for (const payload of fallbackPayloads) {
      await this.processIndexJob(payload, maxAttempts);
    }
  }

  async processReindexRuns(batchSize: number): Promise<number> {
    await this.postingsSearchIndexService.ensureLiveIndex();
    await this.searchQueueService.ensureTopology();

    const run = await this.postingsRepository.claimNextSearchReindexRun();

    if (!run) {
      return 0;
    }

    try {
      if (run.status === "pending" || run.status === "running") {
        await this.rebuildTargetIndex(run, batchSize);
        return 1;
      }

      if (run.status === "waiting_for_catchup") {
        const catchUpState =
          await this.postingsRepository.getSearchReindexCatchUpState(run.id);

        if (catchUpState.state === "waiting") {
          await this.postingsRepository.clearSearchReindexRunProcessing(run.id);
          return 1;
        }

        if (catchUpState.state === "failed") {
          throw new SearchReindexCatchUpError(catchUpState.errorMessage);
        }

        const previousCompletedRun =
          await this.postingsRepository.findLatestCompletedSearchReindexRun();
        const { previousReadTargets, previousWriteTargets } =
          await this.postingsSearchIndexService.swapAliases(
            run.targetIndexName,
          );
        const retainedIndexName = [
          ...previousReadTargets,
          ...previousWriteTargets,
        ].find((index) => index !== run.targetIndexName);

        await this.postingsRepository.markSearchReindexRunCompleted(
          run.id,
          retainedIndexName,
        );
        await this.cleanupPreviousRetainedIndex(
          previousCompletedRun,
          run.targetIndexName,
          retainedIndexName,
        );
        recordReindexRunCompleted(this.readReindexDurationMs(run));
      }

      return 1;
    } catch (error) {
      if (this.isTransientReindexError(error)) {
        await this.postingsRepository.clearSearchReindexRunProcessing(run.id);
        this.logger.warn(
          "Search reindex run hit a transient infrastructure error and will be retried.",
          {
            runId: run.id,
            targetIndexName: run.targetIndexName,
          },
          error,
        );
        return 0;
      }

      await this.postingsRepository.markSearchReindexRunFailed(
        run.id,
        error instanceof Error ? error.message : "Unknown reindex error.",
      );
      recordReindexRunFailed(this.readReindexDurationMs(run));
      this.logger.error(
        "Search reindex run failed.",
        {
          runId: run.id,
          targetIndexName: run.targetIndexName,
        },
        error,
      );
      return 1;
    }
  }

  private async rebuildTargetIndex(
    run: SearchReindexRunRecord,
    batchSize: number,
  ): Promise<void> {
    await this.postingsSearchIndexService.createVersionedIndex(
      run.targetIndexName,
    );
    const totalPostings =
      await this.postingsRepository.countPublishedPostingsForIndexing(
        run.sourceSnapshotAt,
      );
    await this.postingsRepository.markSearchReindexRunRunning(
      run.id,
      totalPostings,
    );

    let cursorId: string | undefined;
    let indexedPostings = 0;

    while (true) {
      const documents =
        await this.postingsRepository.listPublishedForIndexingBatch(
          batchSize,
          cursorId,
          run.sourceSnapshotAt,
        );

      if (documents.length === 0) {
        break;
      }

      for (const chunk of this.chunkDocuments(
        documents,
        REINDEX_HEARTBEAT_BULK_CHUNK_SIZE,
      )) {
        await this.postingsRepository.touchSearchReindexRunProcessing(run.id);
        await this.postingsSearchIndexService.bulkUpsertDocuments(
          chunk,
          run.targetIndexName,
        );
        await this.postingsRepository.touchSearchReindexRunProcessing(run.id);
      }
      indexedPostings += documents.length;
      cursorId = documents[documents.length - 1]?.id;

      await this.postingsRepository.updateSearchReindexRunProgress(run.id, {
        indexedPostings,
      });
    }

    await this.postingsRepository.enqueueSearchReindexBarrier(
      run.id,
      run.targetIndexName,
    );
  }

  async processReconciliationBatch(limit: number): Promise<number> {
    if (!this.postingsSearchIndexService.isElasticsearchEnabled()) {
      return 0;
    }

    await this.postingsSearchIndexService.ensureLiveIndex();
    const documents =
      await this.postingsRepository.listRecentForIndexReconciliation(limit);

    if (documents.length === 0) {
      return 0;
    }

    const targetIndexName = this.postingsSearchIndexService.getWriteAliasName();
    const upserts = documents.filter((document) =>
      isPostingSearchIndexable(document.status),
    );
    const deletes = documents
      .filter((document) => !isPostingSearchIndexable(document.status))
      .map((document) => document.id);

    if (upserts.length > 0) {
      try {
        await this.postingsSearchIndexService.bulkUpsertDocuments(
          upserts,
          targetIndexName,
        );
      } catch (error) {
        this.logger.warn(
          "Search reconciliation bulk upsert failed; falling back to per-document sync.",
          {
            targetIndexName,
            documentIds: upserts.map((document) => document.id),
          },
          error,
        );
        for (const document of upserts) {
          await this.postingsSearchIndexService.upsertDocument(document);
        }
      }
    }

    if (deletes.length > 0) {
      try {
        await this.postingsSearchIndexService.bulkDeleteDocuments(
          deletes,
          targetIndexName,
        );
      } catch (error) {
        this.logger.warn(
          "Search reconciliation bulk delete failed; falling back to per-document sync.",
          {
            targetIndexName,
            documentIds: deletes,
          },
          error,
        );
        for (const id of deletes) {
          await this.postingsSearchIndexService.deleteDocument(id);
        }
      }
    }

    return documents.length;
  }

  private toIndexJob(job: PostingSearchOutboxRecord): SearchIndexJobPayload {
    return {
      outboxId: job.id,
      eventId: job.id,
      dedupeKey: job.dedupeKey,
      operation: job.operation,
      jobType: job.operation,
      postingId: job.postingId,
      reindexRunId: job.reindexRunId,
      targetIndexScope: job.reindexRunId ? "reindex" : "live",
      targetIndexName: job.targetIndexName,
      occurredAt: job.createdAt,
      attempt: job.attempts,
    };
  }

  private createDisabledAliasHealth(): SearchStatusResult["aliases"]["health"] {
    return {
      state: "disabled",
      readAlias: this.postingsSearchIndexService.getReadAliasName(),
      writeAlias: this.postingsSearchIndexService.getWriteAliasName(),
      readTargets: [],
      writeTargets: [],
    };
  }

  private async readAliasHealth(): Promise<SearchAliasStatus> {
    if (!this.postingsSearchIndexService.isElasticsearchEnabled()) {
      return this.createDisabledAliasHealth();
    }

    try {
      return await this.postingsSearchIndexService.getAliasStatus();
    } catch (error) {
      this.logger.warn(
        "Search status using degraded alias health because Elasticsearch is unavailable.",
        undefined,
        error,
      );

      return {
        state: "unavailable",
        readAlias: this.postingsSearchIndexService.getReadAliasName(),
        writeAlias: this.postingsSearchIndexService.getWriteAliasName(),
        readTargets: [],
        writeTargets: [],
        message:
          error instanceof Error
            ? error.message
            : "Elasticsearch is unavailable.",
      };
    }
  }

  private readReindexDurationMs(
    run: SearchReindexRunRecord,
  ): number | undefined {
    if (!run.startedAt) {
      return undefined;
    }

    const startedAt = new Date(run.startedAt).getTime();

    if (Number.isNaN(startedAt)) {
      return undefined;
    }

    return Math.max(0, Date.now() - startedAt);
  }

  private coalesceRelayJobs(
    jobs: PostingSearchOutboxRecord[],
  ): Array<{ primary: PostingSearchOutboxRecord; supersededIds: string[] }> {
    const groups = new Map<
      string,
      {
        primary: PostingSearchOutboxRecord;
        supersededIds: string[];
      }
    >();

    for (const job of jobs) {
      const key = this.createRelayCoalescingKey(job);

      if (!key) {
        groups.set(`outbox:${job.id}`, {
          primary: job,
          supersededIds: [],
        });
        continue;
      }

      const existing = groups.get(key);

      if (!existing) {
        groups.set(key, {
          primary: job,
          supersededIds: [],
        });
        continue;
      }

      existing.supersededIds.push(existing.primary.id);
      existing.primary = job;
    }

    return Array.from(groups.values());
  }

  private createRelayCoalescingKey(
    job: PostingSearchOutboxRecord,
  ): string | null {
    if (job.operation === "barrier" || !job.postingId) {
      return null;
    }

    return [
      job.postingId,
      job.reindexRunId ?? "live",
      job.targetIndexName ?? "live",
    ].join(":");
  }

  private chunkDocuments<T>(documents: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < documents.length; index += size) {
      chunks.push(documents.slice(index, index + size));
    }

    return chunks;
  }

  private async handleIndexJobFailure(
    job: PostingSearchOutboxRecord,
    payload: SearchIndexJobPayload,
    maxAttempts: number,
    error: unknown,
  ): Promise<void> {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown indexing error.";
    const attempt = await this.postingsRepository.incrementSearchOutboxAttempt(
      job.id,
      errorMessage,
    );
    const nextPayload = {
      ...payload,
      attempt,
    };

    if (attempt >= maxAttempts) {
      try {
        await this.searchQueueService.publishDeadLetterJob(nextPayload);
      } catch (publishError) {
        this.logger.error(
          "Failed to publish search index job to the dead-letter queue.",
          {
            outboxId: job.id,
            postingId: job.postingId,
            attempt,
          },
          publishError,
        );
        throw publishError;
      }

      await this.postingsRepository.markSearchOutboxDeadLettered(
        job.id,
        errorMessage,
      );
      return;
    }

    try {
      await this.searchQueueService.publishRetryJob(nextPayload, attempt);
    } catch (publishError) {
      this.logger.error(
        "Failed to publish search index job retry.",
        {
          outboxId: job.id,
          postingId: job.postingId,
          attempt,
        },
        publishError,
      );
      throw publishError;
    }
  }

  private logStaleOutboxJob(job: PostingSearchOutboxRecord): void {
    this.logger.info(
      "Skipping stale search outbox job because a newer job exists.",
      {
        outboxId: job.id,
        postingId: job.postingId,
        targetIndexName: job.targetIndexName,
      },
    );
  }

  private resolveIndexTargetName(job: PostingSearchOutboxRecord): string {
    return (
      job.targetIndexName ?? this.postingsSearchIndexService.getWriteAliasName()
    );
  }

  private getOrCreateUpsertGroup(
    groups: Map<string, BatchedUpsertGroup>,
    targetIndexName: string,
  ): BatchedUpsertGroup {
    const existing = groups.get(targetIndexName);

    if (existing) {
      return existing;
    }

    const created: BatchedUpsertGroup = {
      documents: [],
      entries: [],
    };
    groups.set(targetIndexName, created);
    return created;
  }

  private getOrCreateDeleteGroup(
    groups: Map<string, BatchedDeleteGroup>,
    targetIndexName: string,
  ): BatchedDeleteGroup {
    const existing = groups.get(targetIndexName);

    if (existing) {
      return existing;
    }

    const created: BatchedDeleteGroup = {
      ids: [],
      entries: [],
    };
    groups.set(targetIndexName, created);
    return created;
  }

  private async cleanupPreviousRetainedIndex(
    previousCompletedRun: SearchReindexRunRecord | null,
    currentTargetIndexName: string,
    currentRetainedIndexName?: string,
  ): Promise<void> {
    const previousRetainedIndexName = previousCompletedRun?.retainedIndexName;

    if (
      !previousCompletedRun?.id ||
      !previousRetainedIndexName ||
      previousRetainedIndexName === currentTargetIndexName ||
      previousRetainedIndexName === currentRetainedIndexName
    ) {
      return;
    }

    try {
      const aliasStatus =
        await this.postingsSearchIndexService.getAliasStatus();
      const activeTargets = new Set([
        ...aliasStatus.readTargets,
        ...aliasStatus.writeTargets,
      ]);

      if (activeTargets.has(previousRetainedIndexName)) {
        return;
      }

      await this.postingsSearchIndexService.deleteConcreteIndex(
        previousRetainedIndexName,
      );
      await this.postingsRepository.clearSearchReindexRunRetainedIndexName(
        previousCompletedRun.id,
      );
    } catch (error) {
      this.logger.warn(
        "Failed to clean up a stale retained search index.",
        {
          reindexRunId: previousCompletedRun.id,
          retainedIndexName: previousRetainedIndexName,
        },
        error,
      );
    }
  }

  private isTransientReindexError(error: unknown): boolean {
    if (error instanceof ElasticsearchUnavailableError) {
      return true;
    }

    if (error instanceof SearchReindexCatchUpError) {
      return false;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    const code = (error as NodeJS.ErrnoException).code;

    if (code && TRANSIENT_REINDEX_ERROR_CODES.has(code)) {
      return true;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes("rabbitmq") ||
      message.includes("amqp") ||
      message.includes("broker") ||
      message.includes("connection closed") ||
      message.includes("socket closed") ||
      message.includes("timed out")
    );
  }
}
