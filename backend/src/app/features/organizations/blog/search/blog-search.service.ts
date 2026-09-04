import ConflictError from "@/errors/http/conflict.error";
import { ElasticsearchUnavailableError } from "@/configuration/resources/elasticsearch";
import type {
  OrganizationBlogSearchDocument,
  OrganizationBlogSearchOutboxRecord,
} from "@/features/organizations/blog/blog.model";
import type { OrganizationBlogRepository } from "@/features/organizations/blog/blog.repository";
import type { OrganizationBlogSearchIndexService } from "@/features/organizations/blog/search/index.service";
import type {
  CleanupRetainedSearchIndicesResult,
  ReplayDeadLetteredSearchOutboxResult,
  SearchAliasStatus,
  SearchIndexJobPayload,
  SearchQueueCounts,
  SearchReindexRunRecord,
  SearchStatusResult,
} from "@/features/search/search.model";
import type { SearchQueueService } from "@/features/search/search.queue.service";
import {
  getSearchTelemetrySnapshot,
  recordQueueInspectionFailure,
  recordReindexRunCompleted,
  recordReindexRunFailed,
} from "@/features/search/search.telemetry";
import { loggerFactory, type Logger } from "@/configuration/logging";
import { asUuid } from "@/configuration/validation/uuid";

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
  job: OrganizationBlogSearchOutboxRecord;
  payload: SearchIndexJobPayload;
};

type BatchedUpsertGroup = {
  documents: OrganizationBlogSearchDocument[];
  entries: BatchedIndexEntry[];
};

type BatchedDeleteGroup = {
  ids: string[];
  entries: BatchedIndexEntry[];
};

// Orchestrates the organization blog search index pipeline: relays the
// transactional outbox onto RabbitMQ, consumes index jobs, runs zero-downtime
// reindexes with alias swaps, and reconciles drift. Mirrors
// OrganizationsSearchService but is bound to the blog repository/index/queue
// trio. Note: the shared SearchIndexJobPayload's `postingId` field carries the
// blog post id here.
export class OrganizationBlogSearchService {
  private readonly logger: Logger;

  constructor(
    private readonly organizationBlogRepository: OrganizationBlogRepository,
    private readonly organizationBlogSearchIndexService: OrganizationBlogSearchIndexService,
    private readonly searchQueueService: SearchQueueService,
  ) {
    this.logger = loggerFactory.forClass(
      OrganizationBlogSearchService,
      "service",
    );
  }

  async startReindex(): Promise<SearchReindexRunRecord> {
    const run =
      await this.organizationBlogRepository.withSearchReindexStartLock(
        async ({ findActiveSearchReindexRun, createSearchReindexRun }) => {
          const activeRun = await findActiveSearchReindexRun();

          if (activeRun) {
            throw new ConflictError(
              "An organization blog search reindex run is already active.",
            );
          }

          return createSearchReindexRun(
            this.organizationBlogSearchIndexService.buildVersionedIndexName(),
          );
        },
      );

    if (!run) {
      throw new ConflictError(
        "An organization blog search reindex run is already active.",
      );
    }

    return run;
  }

  async getReindexRun(id: string): Promise<SearchReindexRunRecord | null> {
    return this.organizationBlogRepository.findSearchReindexRunById(id);
  }

  async replayDeadLetteredOutbox(
    limit: number,
  ): Promise<ReplayDeadLetteredSearchOutboxResult> {
    const revived =
      await this.organizationBlogRepository.reviveDeadLetteredSearchOutbox(
        limit,
      );

    return {
      revived,
    };
  }

  async cleanupRetainedIndices(): Promise<CleanupRetainedSearchIndicesResult> {
    if (!this.organizationBlogSearchIndexService.isElasticsearchEnabled()) {
      return {
        deleted: 0,
      };
    }

    const aliasStatus =
      await this.organizationBlogSearchIndexService.getAliasStatus();
    const activeTargets = new Set([
      ...aliasStatus.readTargets,
      ...aliasStatus.writeTargets,
    ]);
    const runs =
      await this.organizationBlogRepository.listCompletedSearchReindexRunsWithRetainedIndices();
    let deleted = 0;

    for (const run of runs) {
      const indexName = run.retainedIndexName;

      if (!indexName || activeTargets.has(indexName)) {
        continue;
      }

      await this.organizationBlogSearchIndexService.deleteConcreteIndex(
        indexName,
      );
      await this.organizationBlogRepository.clearSearchReindexRunRetainedIndexName(
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
      this.organizationBlogRepository.findActiveSearchReindexRun(),
      this.organizationBlogRepository.findLatestSearchReindexRun(),
      this.organizationBlogRepository.getSearchOutboxLagMetrics(),
      this.organizationBlogSearchIndexService.isElasticsearchEnabled()
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
        read: this.organizationBlogSearchIndexService.getReadAliasName(),
        write: this.organizationBlogSearchIndexService.getWriteAliasName(),
        readTargets: aliasHealth.readTargets,
        writeTargets: aliasHealth.writeTargets,
        health: aliasHealth,
      },
      elasticsearch: {
        enabled:
          this.organizationBlogSearchIndexService.isElasticsearchEnabled(),
        circuitBreaker:
          this.organizationBlogSearchIndexService.getCircuitBreakerState(),
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
    await this.organizationBlogSearchIndexService.ensureLiveIndex();
    await this.searchQueueService.ensureTopology();

    const jobs =
      await this.organizationBlogRepository.claimSearchOutboxBatch(limit);
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
          await this.organizationBlogRepository.releaseSearchOutboxClaims(
            relayJob.supersededIds,
            errorMessage,
          );

          if (job.publishAttempts + 1 >= maxPublishAttempts) {
            await this.organizationBlogRepository.markSearchOutboxDeadLettered(
              job.id,
              errorMessage,
            );
          } else {
            await this.organizationBlogRepository.markSearchOutboxPublishRetry(
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
        await this.organizationBlogRepository.markSearchOutboxRelayed(
          job.id,
          relayJob.supersededIds,
          job.id,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown relay state error.";
        await this.organizationBlogRepository.releaseSearchOutboxClaims(
          claimedIds,
          errorMessage,
        );
        this.logger.error(
          "Organization blog search relay publish succeeded but outbox state could not be finalized.",
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
    const job = await this.organizationBlogRepository.getSearchOutboxById(
      payload.outboxId,
    );

    if (!job || job.deadLetteredAt || job.indexedAt) {
      return;
    }

    if (job.operation === "barrier") {
      await this.organizationBlogRepository.markSearchOutboxIndexed(job.id);
      return;
    }

    try {
      if (!job.blogPostId) {
        throw new Error("Search outbox job is missing a blog post id.");
      }

      if (await this.organizationBlogRepository.hasNewerSearchOutboxJob(job)) {
        this.logStaleOutboxJob(job);
        await this.organizationBlogRepository.markSearchOutboxIndexed(job.id);
        return;
      }

      if (job.operation === "delete") {
        await this.organizationBlogSearchIndexService.deleteDocument(
          job.blogPostId,
          job.targetIndexName,
        );
      } else {
        const documents =
          await this.organizationBlogRepository.findByIdsForIndexing([
            job.blogPostId,
          ]);
        const document = documents[0];

        if (!document) {
          await this.organizationBlogSearchIndexService.deleteDocument(
            job.blogPostId,
            job.targetIndexName,
          );
        } else {
          await this.organizationBlogSearchIndexService.upsertDocument(
            document,
            job.targetIndexName,
          );
        }
      }

      await this.organizationBlogRepository.markSearchOutboxIndexed(job.id);
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
    const jobs = await this.organizationBlogRepository.getSearchOutboxesByIds(
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
        if (!job.blogPostId) {
          throw new Error("Search outbox job is missing a blog post id.");
        }

        if (
          await this.organizationBlogRepository.hasNewerSearchOutboxJob(job)
        ) {
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
      await this.organizationBlogRepository.markSearchOutboxesIndexed(
        immediateIndexIds,
      );
    }

    const documents =
      await this.organizationBlogRepository.findByIdsForIndexing(
        upsertCandidates.map(({ job }) => job.blogPostId!).filter(Boolean),
      );
    const documentsById = new Map(
      documents.map((document) => [document.id, document]),
    );
    const upsertGroups = new Map<string, BatchedUpsertGroup>();
    const deleteGroups = new Map<string, BatchedDeleteGroup>();

    for (const entry of upsertCandidates) {
      const document = documentsById.get(entry.job.blogPostId!);

      if (!document) {
        const deleteGroup = this.getOrCreateDeleteGroup(
          deleteGroups,
          this.resolveIndexTargetName(entry.job),
        );
        deleteGroup.ids.push(entry.job.blogPostId!);
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
      deleteGroup.ids.push(entry.job.blogPostId!);
      deleteGroup.entries.push(entry);
    }

    await Promise.all(
      Array.from(upsertGroups.entries(), async ([targetIndexName, group]) => {
        try {
          await this.organizationBlogSearchIndexService.bulkUpsertDocuments(
            group.documents,
            targetIndexName,
          );
          await this.organizationBlogRepository.markSearchOutboxesIndexed(
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
          await this.organizationBlogSearchIndexService.bulkDeleteDocuments(
            Array.from(new Set(group.ids)),
            targetIndexName,
          );
          await this.organizationBlogRepository.markSearchOutboxesIndexed(
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
    await this.organizationBlogSearchIndexService.ensureLiveIndex();
    await this.searchQueueService.ensureTopology();

    const run =
      await this.organizationBlogRepository.claimNextSearchReindexRun();

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
          await this.organizationBlogRepository.getSearchReindexCatchUpState(
            run.id,
          );

        if (catchUpState.state === "waiting") {
          await this.organizationBlogRepository.clearSearchReindexRunProcessing(
            run.id,
          );
          return 1;
        }

        if (catchUpState.state === "failed") {
          throw new SearchReindexCatchUpError(catchUpState.errorMessage!);
        }

        const previousCompletedRun =
          await this.organizationBlogRepository.findLatestCompletedSearchReindexRun();
        const { previousReadTargets, previousWriteTargets } =
          await this.organizationBlogSearchIndexService.swapAliases(
            run.targetIndexName,
          );
        const retainedIndexName = [
          ...previousReadTargets,
          ...previousWriteTargets,
        ].find((index) => index !== run.targetIndexName);

        await this.organizationBlogRepository.markSearchReindexRunCompleted(
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
        await this.organizationBlogRepository.clearSearchReindexRunProcessing(
          run.id,
        );
        this.logger.warn(
          "Organization blog search reindex run hit a transient infrastructure error and will be retried.",
          {
            runId: run.id,
            targetIndexName: run.targetIndexName,
          },
          error,
        );
        return 0;
      }

      await this.organizationBlogRepository.markSearchReindexRunFailed(
        run.id,
        error instanceof Error ? error.message : "Unknown reindex error.",
      );
      recordReindexRunFailed(this.readReindexDurationMs(run));
      this.logger.error(
        "Organization blog search reindex run failed.",
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
    if (run.status === "pending") {
      await this.organizationBlogSearchIndexService.createVersionedIndex(
        run.targetIndexName,
      );
      const totalDocuments =
        await this.organizationBlogRepository.countBlogPostsForIndexing(
          run.sourceSnapshotAt,
        );
      await this.organizationBlogRepository.markSearchReindexRunRunning(
        run.id,
        totalDocuments,
      );
    }

    let cursorId: string | undefined;
    let indexedDocuments = 0;

    while (true) {
      const documents =
        await this.organizationBlogRepository.listForIndexingBatch(
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
        await this.organizationBlogRepository.touchSearchReindexRunProcessing(
          run.id,
        );
        await this.organizationBlogSearchIndexService.bulkUpsertDocuments(
          chunk,
          run.targetIndexName,
        );
        await this.organizationBlogRepository.touchSearchReindexRunProcessing(
          run.id,
        );
      }
      indexedDocuments += documents.length;
      cursorId = documents[documents.length - 1]?.id;

      await this.organizationBlogRepository.updateSearchReindexRunProgress(
        run.id,
        {
          indexedDocuments,
        },
      );
    }

    await this.organizationBlogRepository.enqueueSearchReindexBarrier(
      asUuid(run.id),
      run.targetIndexName,
    );
  }

  async processReconciliationBatch(limit: number): Promise<number> {
    if (!this.organizationBlogSearchIndexService.isElasticsearchEnabled()) {
      return 0;
    }

    await this.organizationBlogSearchIndexService.ensureLiveIndex();
    const documents =
      await this.organizationBlogRepository.listRecentForIndexReconciliation(
        limit,
      );

    if (documents.length === 0) {
      return 0;
    }

    const targetIndexName =
      this.organizationBlogSearchIndexService.getWriteAliasName();

    try {
      await this.organizationBlogSearchIndexService.bulkUpsertDocuments(
        documents,
        targetIndexName,
      );
    } catch (error) {
      this.logger.warn(
        "Organization blog search reconciliation bulk upsert failed; falling back to per-document sync.",
        {
          targetIndexName,
          documentIds: documents.map((document) => document.id),
        },
        error,
      );
      for (const document of documents) {
        await this.organizationBlogSearchIndexService.upsertDocument(document);
      }
    }

    return documents.length;
  }

  private toIndexJob(
    job: OrganizationBlogSearchOutboxRecord,
  ): SearchIndexJobPayload {
    return {
      outboxId: asUuid(job.id),
      eventId: job.id,
      dedupeKey: job.dedupeKey,
      operation: job.operation,
      jobType: job.operation,
      postingId: job.blogPostId,
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
      readAlias: this.organizationBlogSearchIndexService.getReadAliasName(),
      writeAlias: this.organizationBlogSearchIndexService.getWriteAliasName(),
      readTargets: [],
      writeTargets: [],
    };
  }

  private async readAliasHealth(): Promise<SearchAliasStatus> {
    if (!this.organizationBlogSearchIndexService.isElasticsearchEnabled()) {
      return this.createDisabledAliasHealth();
    }

    try {
      return await this.organizationBlogSearchIndexService.getAliasStatus();
    } catch (error) {
      this.logger.warn(
        "Organization blog search status using degraded alias health because Elasticsearch is unavailable.",
        undefined,
        error,
      );

      return {
        state: "unavailable",
        readAlias: this.organizationBlogSearchIndexService.getReadAliasName(),
        writeAlias: this.organizationBlogSearchIndexService.getWriteAliasName(),
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

  private coalesceRelayJobs(jobs: OrganizationBlogSearchOutboxRecord[]): Array<{
    primary: OrganizationBlogSearchOutboxRecord;
    supersededIds: string[];
  }> {
    const groups = new Map<
      string,
      {
        primary: OrganizationBlogSearchOutboxRecord;
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

      // Keep the NEWEST event (by createdAt) as primary. Claim order follows
      // availableAt, and a retried older row can have a later availableAt than a
      // newer row, so the newer job may arrive first. If we blindly made the
      // last-seen job primary, the older job could win, the newer row would be
      // marked superseded, and when the older message is later consumed it would
      // stale-skip against that newer superseded row — leaving neither event
      // applied to Elasticsearch.
      if (
        new Date(job.createdAt).getTime() >=
        new Date(existing.primary.createdAt).getTime()
      ) {
        existing.supersededIds.push(existing.primary.id);
        existing.primary = job;
      } else {
        existing.supersededIds.push(job.id);
      }
    }

    return Array.from(groups.values());
  }

  private createRelayCoalescingKey(
    job: OrganizationBlogSearchOutboxRecord,
  ): string | null {
    if (job.operation === "barrier" || !job.blogPostId) {
      return null;
    }

    return [
      job.blogPostId,
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
    job: OrganizationBlogSearchOutboxRecord,
    payload: SearchIndexJobPayload,
    maxAttempts: number,
    error: unknown,
  ): Promise<void> {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown indexing error.";
    const attempt =
      await this.organizationBlogRepository.incrementSearchOutboxAttempt(
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
          "Failed to publish organization blog search index job to the dead-letter queue.",
          {
            outboxId: job.id,
            blogPostId: job.blogPostId,
            attempt,
          },
          publishError,
        );
        throw publishError;
      }

      await this.organizationBlogRepository.markSearchOutboxDeadLettered(
        job.id,
        errorMessage,
      );
      return;
    }

    try {
      await this.searchQueueService.publishRetryJob(nextPayload, attempt);
    } catch (publishError) {
      this.logger.error(
        "Failed to publish organization blog search index job retry.",
        {
          outboxId: job.id,
          blogPostId: job.blogPostId,
          attempt,
        },
        publishError,
      );
      throw publishError;
    }
  }

  private logStaleOutboxJob(job: OrganizationBlogSearchOutboxRecord): void {
    this.logger.info(
      "Skipping stale organization blog search outbox job because a newer job exists.",
      {
        outboxId: job.id,
        blogPostId: job.blogPostId,
        targetIndexName: job.targetIndexName,
      },
    );
  }

  private resolveIndexTargetName(
    job: OrganizationBlogSearchOutboxRecord,
  ): string {
    return (
      job.targetIndexName ??
      this.organizationBlogSearchIndexService.getWriteAliasName()
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
        await this.organizationBlogSearchIndexService.getAliasStatus();
      const activeTargets = new Set([
        ...aliasStatus.readTargets,
        ...aliasStatus.writeTargets,
      ]);

      if (activeTargets.has(previousRetainedIndexName)) {
        return;
      }

      await this.organizationBlogSearchIndexService.deleteConcreteIndex(
        previousRetainedIndexName,
      );
      await this.organizationBlogRepository.clearSearchReindexRunRetainedIndexName(
        previousCompletedRun.id,
      );
    } catch (error) {
      this.logger.warn(
        "Failed to clean up a stale retained organization blog search index.",
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
