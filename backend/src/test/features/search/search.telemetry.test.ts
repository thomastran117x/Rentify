import {
  getSearchTelemetrySnapshot,
  recordAliasAction,
  recordCircuitBreakerOpened,
  recordCircuitBreakerShortCircuit,
  recordElasticsearchRequest,
  recordElasticsearchServerError,
  recordElasticsearchTimeout,
  recordElasticsearchTransportError,
  recordQueueInspectionFailure,
  recordReindexRunCompleted,
  recordReindexRunFailed,
  recordSearchFallback,
  resetSearchTelemetry,
} from "@/features/search/search.telemetry";

describe("search.telemetry", () => {
  beforeEach(() => {
    resetSearchTelemetry();
  });

  it("records all telemetry counters and exposes them via snapshots", () => {
    recordElasticsearchRequest(25);
    recordElasticsearchRequest(35);
    recordElasticsearchServerError();
    recordElasticsearchTimeout();
    recordElasticsearchTransportError();
    recordCircuitBreakerOpened();
    recordCircuitBreakerShortCircuit();
    recordSearchFallback("circuit-open");
    recordSearchFallback("es-unavailable");
    recordSearchFallback("index-drift");
    recordQueueInspectionFailure();
    recordReindexRunCompleted(1200);
    recordReindexRunFailed(2400);
    recordAliasAction("created_index");
    recordAliasAction("repaired_read_alias");
    recordAliasAction("repaired_write_alias");

    expect(getSearchTelemetrySnapshot()).toEqual({
      elasticsearchRequests: {
        total: 2,
        totalLatencyMs: 60,
        serverErrorCount: 1,
        timeoutCount: 1,
        transportErrorCount: 1,
      },
      circuitBreaker: {
        openedCount: 1,
        shortCircuitCount: 1,
      },
      fallbacks: {
        "circuit-open": 1,
        "es-unavailable": 1,
        "index-drift": 1,
      },
      queueInspectionFailures: 1,
      reindexRuns: {
        completed: 1,
        failed: 1,
        lastDurationMs: 2400,
      },
      aliasActions: {
        createdIndexCount: 1,
        repairedReadAliasCount: 1,
        repairedWriteAliasCount: 1,
        lastAction: "repaired_write_alias",
      },
    });
  });

  it("returns defensive copies and reset clears optional telemetry fields", () => {
    recordElasticsearchRequest(10);
    recordReindexRunCompleted();
    recordAliasAction("created_index");

    const snapshot = getSearchTelemetrySnapshot();
    snapshot.elasticsearchRequests.total = 999;
    snapshot.reindexRuns.completed = 999;
    snapshot.aliasActions.createdIndexCount = 999;

    expect(getSearchTelemetrySnapshot()).toMatchObject({
      elasticsearchRequests: {
        total: 1,
        totalLatencyMs: 10,
      },
      reindexRuns: {
        completed: 1,
      },
      aliasActions: {
        createdIndexCount: 1,
        lastAction: "created_index",
      },
    });

    resetSearchTelemetry();

    expect(getSearchTelemetrySnapshot()).toEqual({
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
    });
  });
});
