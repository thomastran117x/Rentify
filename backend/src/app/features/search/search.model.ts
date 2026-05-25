export type SearchIndexJobOperation = "upsert" | "delete" | "barrier";
export type SearchFallbackReason =
  | "circuit-open"
  | "es-unavailable"
  | "index-drift";
export type SearchReindexStatus =
  | "pending"
  | "running"
  | "waiting_for_catchup"
  | "completed"
  | "failed";

export interface SearchIndexJobPayload {
  outboxId: string;
  eventId: string;
  dedupeKey: string;
  operation: SearchIndexJobOperation;
  jobType: SearchIndexJobOperation;
  postingId?: string;
  reindexRunId?: string;
  targetIndexScope: "live" | "reindex";
  targetIndexName?: string;
  occurredAt: string;
  attempt: number;
}

export interface SearchReindexRunRecord {
  id: string;
  status: SearchReindexStatus;
  targetIndexName: string;
  retainedIndexName?: string;
  sourceSnapshotAt: string;
  barrierOutboxId?: string;
  totalPostings: number;
  indexedPostings: number;
  failedPostings: number;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  processingAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchQueueCounts {
  ready: number;
  consumers: number;
}

export interface SearchQueueInspectionResult {
  ok: boolean;
  error?: string;
}

export interface SearchOutboxLagMetrics {
  unpublishedCount: number;
  unpublishedOldestAgeMs?: number;
  publishedNotIndexedCount: number;
  publishedNotIndexedOldestAgeMs?: number;
  deadLetteredByOperation: Record<SearchIndexJobOperation, number>;
}

export interface SearchAliasStatus {
  state:
    | "disabled"
    | "missing"
    | "missing_read_alias"
    | "missing_write_alias"
    | "ready"
    | "inconsistent";
  readAlias: string;
  writeAlias: string;
  readTargets: string[];
  writeTargets: string[];
  message?: string;
}

export interface SearchTelemetrySnapshot {
  elasticsearchRequests: {
    total: number;
    totalLatencyMs: number;
    serverErrorCount: number;
    timeoutCount: number;
    transportErrorCount: number;
  };
  circuitBreaker: {
    openedCount: number;
    shortCircuitCount: number;
  };
  fallbacks: Record<SearchFallbackReason, number>;
  queueInspectionFailures: number;
  reindexRuns: {
    completed: number;
    failed: number;
    lastDurationMs?: number;
  };
  aliasActions: {
    createdIndexCount: number;
    repairedReadAliasCount: number;
    repairedWriteAliasCount: number;
    lastAction?:
      | "created_index"
      | "repaired_read_alias"
      | "repaired_write_alias";
  };
}

export interface SearchStatusResult {
  aliases: {
    read: string;
    write: string;
    readTargets: string[];
    writeTargets: string[];
    health: SearchAliasStatus;
  };
  elasticsearch: {
    enabled: boolean;
    circuitBreaker: {
      state: "closed" | "open" | "half_open";
      consecutiveFailures: number;
      failureThreshold: number;
      cooldownMs: number;
      openedUntil?: string;
    };
    telemetry: SearchTelemetrySnapshot["elasticsearchRequests"] &
      SearchTelemetrySnapshot["circuitBreaker"];
  };
  currentReindexRun?: SearchReindexRunRecord;
  latestReindexRun?: SearchReindexRunRecord;
  pendingOutboxCount: number;
  pendingOutboxOldestAgeMs?: number;
  lag: SearchOutboxLagMetrics;
  queueInspection: SearchQueueInspectionResult;
  queueCounts?: {
    main: SearchQueueCounts;
    retry1: SearchQueueCounts;
    retry2: SearchQueueCounts;
    retry3: SearchQueueCounts;
    deadLetter: SearchQueueCounts;
  };
  telemetry: Omit<
    SearchTelemetrySnapshot,
    "elasticsearchRequests" | "circuitBreaker"
  >;
}

export interface ReplayDeadLetteredSearchOutboxResult {
  revived: number;
}

export interface CleanupRetainedSearchIndicesResult {
  deleted: number;
}
