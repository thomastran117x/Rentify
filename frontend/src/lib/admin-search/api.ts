import { authenticatedJson } from "@/lib/api/client";

export type SearchReindexStatus =
  | "pending"
  | "running"
  | "waiting_for_catchup"
  | "completed"
  | "failed";

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

export interface SearchStatusResult {
  aliases: {
    read: string;
    write: string;
    readTargets: string[];
    writeTargets: string[];
    health: {
      state: string;
      readAlias: string;
      writeAlias: string;
      readTargets: string[];
      writeTargets: string[];
      message?: string;
    };
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
    telemetry: Record<string, number>;
  };
  currentReindexRun?: SearchReindexRunRecord;
  latestReindexRun?: SearchReindexRunRecord;
  pendingOutboxCount: number;
  pendingOutboxOldestAgeMs?: number;
  lag: Record<string, unknown>;
  queueInspection: {
    ok: boolean;
    error?: string;
  };
  queueCounts?: Record<string, { ready: number; consumers: number }>;
  telemetry: Record<string, unknown>;
}

export interface ReplayDeadLetteredSearchOutboxResult {
  revived: number;
}

export interface CleanupRetainedSearchIndicesResult {
  deleted: number;
}

export const adminSearchApi = {
  startReindex(): Promise<SearchReindexRunRecord> {
    return authenticatedJson<SearchReindexRunRecord, Record<string, never>>(
      "POST",
      "/admin/search/reindex",
      {},
    );
  },
  getReindexRun(runId: string): Promise<SearchReindexRunRecord> {
    return authenticatedJson<SearchReindexRunRecord>(
      "GET",
      `/admin/search/reindex/${encodeURIComponent(runId)}`,
    );
  },
  getStatus(): Promise<SearchStatusResult> {
    return authenticatedJson<SearchStatusResult>("GET", "/admin/search/status");
  },
  replayDeadLetteredOutbox(): Promise<ReplayDeadLetteredSearchOutboxResult> {
    return authenticatedJson<
      ReplayDeadLetteredSearchOutboxResult,
      Record<string, never>
    >("POST", "/admin/search/outbox/replay-dead-lettered", {});
  },
  cleanupRetainedIndices(): Promise<CleanupRetainedSearchIndicesResult> {
    return authenticatedJson<
      CleanupRetainedSearchIndicesResult,
      Record<string, never>
    >("POST", "/admin/search/cleanup-retained-indices", {});
  },
};
