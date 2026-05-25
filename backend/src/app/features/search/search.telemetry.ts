import type {
  SearchFallbackReason,
  SearchTelemetrySnapshot,
} from "@/features/search/search.model";

const telemetry: SearchTelemetrySnapshot = {
  elasticsearchRequests: {
    total: 0,
    totalLatencyMs: 0,
    serverErrorCount: 0,
    timeoutCount: 0,
    transportErrorCount: 0,
  },
  circuitBreaker: {
    openedCount: 0,
    shortCircuitCount: 0,
  },
  fallbacks: {
    "circuit-open": 0,
    "es-unavailable": 0,
    "index-drift": 0,
  },
  queueInspectionFailures: 0,
  reindexRuns: {
    completed: 0,
    failed: 0,
  },
  aliasActions: {
    createdIndexCount: 0,
    repairedReadAliasCount: 0,
    repairedWriteAliasCount: 0,
  },
};

export function recordElasticsearchRequest(durationMs: number): void {
  telemetry.elasticsearchRequests.total += 1;
  telemetry.elasticsearchRequests.totalLatencyMs += durationMs;
}

export function recordElasticsearchServerError(): void {
  telemetry.elasticsearchRequests.serverErrorCount += 1;
}

export function recordElasticsearchTimeout(): void {
  telemetry.elasticsearchRequests.timeoutCount += 1;
}

export function recordElasticsearchTransportError(): void {
  telemetry.elasticsearchRequests.transportErrorCount += 1;
}

export function recordCircuitBreakerOpened(): void {
  telemetry.circuitBreaker.openedCount += 1;
}

export function recordCircuitBreakerShortCircuit(): void {
  telemetry.circuitBreaker.shortCircuitCount += 1;
}

export function recordSearchFallback(reason: SearchFallbackReason): void {
  telemetry.fallbacks[reason] += 1;
}

export function recordQueueInspectionFailure(): void {
  telemetry.queueInspectionFailures += 1;
}

export function recordReindexRunCompleted(durationMs?: number): void {
  telemetry.reindexRuns.completed += 1;
  if (durationMs !== undefined) {
    telemetry.reindexRuns.lastDurationMs = durationMs;
  }
}

export function recordReindexRunFailed(durationMs?: number): void {
  telemetry.reindexRuns.failed += 1;
  if (durationMs !== undefined) {
    telemetry.reindexRuns.lastDurationMs = durationMs;
  }
}

export function recordAliasAction(
  action: "created_index" | "repaired_read_alias" | "repaired_write_alias",
): void {
  telemetry.aliasActions.lastAction = action;

  switch (action) {
    case "created_index":
      telemetry.aliasActions.createdIndexCount += 1;
      break;
    case "repaired_read_alias":
      telemetry.aliasActions.repairedReadAliasCount += 1;
      break;
    case "repaired_write_alias":
      telemetry.aliasActions.repairedWriteAliasCount += 1;
      break;
  }
}

export function getSearchTelemetrySnapshot(): SearchTelemetrySnapshot {
  return {
    elasticsearchRequests: {
      ...telemetry.elasticsearchRequests,
    },
    circuitBreaker: {
      ...telemetry.circuitBreaker,
    },
    fallbacks: {
      ...telemetry.fallbacks,
    },
    queueInspectionFailures: telemetry.queueInspectionFailures,
    reindexRuns: {
      ...telemetry.reindexRuns,
    },
    aliasActions: {
      ...telemetry.aliasActions,
    },
  };
}

export function resetSearchTelemetry(): void {
  telemetry.elasticsearchRequests.total = 0;
  telemetry.elasticsearchRequests.totalLatencyMs = 0;
  telemetry.elasticsearchRequests.serverErrorCount = 0;
  telemetry.elasticsearchRequests.timeoutCount = 0;
  telemetry.elasticsearchRequests.transportErrorCount = 0;
  telemetry.circuitBreaker.openedCount = 0;
  telemetry.circuitBreaker.shortCircuitCount = 0;
  telemetry.fallbacks["circuit-open"] = 0;
  telemetry.fallbacks["es-unavailable"] = 0;
  telemetry.fallbacks["index-drift"] = 0;
  telemetry.queueInspectionFailures = 0;
  telemetry.reindexRuns.completed = 0;
  telemetry.reindexRuns.failed = 0;
  delete telemetry.reindexRuns.lastDurationMs;
  telemetry.aliasActions.createdIndexCount = 0;
  telemetry.aliasActions.repairedReadAliasCount = 0;
  telemetry.aliasActions.repairedWriteAliasCount = 0;
  delete telemetry.aliasActions.lastAction;
}
