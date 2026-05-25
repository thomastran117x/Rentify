import {
  ElasticsearchCircuitOpenError,
  ElasticsearchClient,
  ElasticsearchRequestError,
  ElasticsearchUnavailableError,
  type ElasticsearchConfig,
} from "@/configuration/resources/elasticsearch";

function createConfig(
  overrides: Partial<ElasticsearchConfig> = {},
): ElasticsearchConfig {
  return {
    enabled: true,
    url: "http://elasticsearch.test",
    postingsIndexName: "postings-test",
    timeoutMs: 1_000,
    circuitBreakerFailureThreshold: 2,
    circuitBreakerCooldownMs: 60_000,
    ...overrides,
  };
}

describe("ElasticsearchClient circuit breaker", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("opens after repeated failures and short-circuits later requests", async () => {
    const fetchMock = jest.fn(
      async () => new Response("unavailable", { status: 503 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ElasticsearchClient(createConfig());

    await expect(
      client.requestJson("/postings/_search", { method: "GET" }),
    ).rejects.toBeInstanceOf(ElasticsearchUnavailableError);
    await expect(
      client.requestJson("/postings/_search", { method: "GET" }),
    ).rejects.toBeInstanceOf(ElasticsearchUnavailableError);
    await expect(
      client.requestJson("/postings/_search", { method: "GET" }),
    ).rejects.toBeInstanceOf(ElasticsearchCircuitOpenError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.getCircuitBreakerState()).toMatchObject({
      state: "open",
      consecutiveFailures: 2,
      failureThreshold: 2,
    });
  });

  it("does not open the circuit for repeated client-side 4xx failures", async () => {
    const fetchMock = jest.fn(
      async () => new Response("bad request", { status: 400 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ElasticsearchClient(createConfig());

    await expect(
      client.requestJson("/postings/_search", { method: "GET" }),
    ).rejects.toBeInstanceOf(ElasticsearchRequestError);
    await expect(
      client.requestJson("/postings/_search", { method: "GET" }),
    ).rejects.toBeInstanceOf(ElasticsearchRequestError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.getCircuitBreakerState()).toMatchObject({
      state: "closed",
      consecutiveFailures: 0,
    });
  });
});
