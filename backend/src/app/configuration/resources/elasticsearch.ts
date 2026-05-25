import { getOptionalEnvironmentVariable } from "@/configuration/environment/index";
import {
  recordCircuitBreakerOpened,
  recordCircuitBreakerShortCircuit,
  recordElasticsearchRequest,
  recordElasticsearchServerError,
  recordElasticsearchTimeout,
  recordElasticsearchTransportError,
} from "@/features/search/search.telemetry";
import { loggerFactory } from "@/configuration/logging";

const elasticsearchLogger = loggerFactory.forComponent(
  "elasticsearch",
  "resource",
);

export interface ElasticsearchConfig {
  enabled: boolean;
  url?: string;
  username?: string;
  password?: string;
  postingsIndexName: string;
  timeoutMs: number;
  circuitBreakerFailureThreshold: number;
  circuitBreakerCooldownMs: number;
}

export interface ElasticsearchCircuitBreakerState {
  state: "closed" | "open" | "half_open";
  consecutiveFailures: number;
  failureThreshold: number;
  cooldownMs: number;
  openedUntil?: string;
}

export class ElasticsearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ElasticsearchUnavailableError";
  }
}

export class ElasticsearchRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ElasticsearchRequestError";
  }
}

export class ElasticsearchCircuitOpenError extends ElasticsearchUnavailableError {
  constructor(openedUntil: Date) {
    super(
      `Elasticsearch circuit breaker is open until ${openedUntil.toISOString()}.`,
    );
    this.name = "ElasticsearchCircuitOpenError";
  }
}

export class ElasticsearchClient {
  private consecutiveFailures = 0;
  private openedUntil: Date | null = null;

  constructor(private readonly config: ElasticsearchConfig) {}

  isEnabled(): boolean {
    return Boolean(this.config.enabled && this.config.url);
  }

  isCircuitOpen(): boolean {
    return Boolean(this.openedUntil && this.openedUntil.getTime() > Date.now());
  }

  getCircuitBreakerState(): ElasticsearchCircuitBreakerState {
    const isOpen = this.isCircuitOpen();
    const isHalfOpen =
      Boolean(this.openedUntil) &&
      !isOpen &&
      this.consecutiveFailures >= this.config.circuitBreakerFailureThreshold;

    return {
      state: isOpen ? "open" : isHalfOpen ? "half_open" : "closed",
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.config.circuitBreakerFailureThreshold,
      cooldownMs: this.config.circuitBreakerCooldownMs,
      ...(this.openedUntil
        ? { openedUntil: this.openedUntil.toISOString() }
        : {}),
    };
  }

  getPostingsIndexName(): string {
    return this.config.postingsIndexName;
  }

  async requestJson<TResponse>(
    path: string,
    init: RequestInit,
    options: {
      allowNotFound?: boolean;
      contentType?: string;
    } = {},
  ): Promise<TResponse> {
    const config = this.requireConfig();
    const startedAt = performance.now();

    if (this.isCircuitOpen() && this.openedUntil) {
      recordCircuitBreakerShortCircuit();
      throw new ElasticsearchCircuitOpenError(this.openedUntil);
    }

    const headers = new Headers(init.headers);
    headers.set("content-type", options.contentType ?? "application/json");

    if (config.username && config.password) {
      headers.set(
        "authorization",
        `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      );
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, config.timeoutMs);

    try {
      const response = await fetch(`${config.url}${path}`, {
        ...init,
        headers,
        signal: abortController.signal,
      });

      if (options.allowNotFound && response.status === 404) {
        this.recordSuccess();
        return {} as TResponse;
      }

      if (!response.ok) {
        const text = await response.text();
        if (response.status >= 500) {
          recordElasticsearchServerError();
          this.recordFailure();
        } else {
          elasticsearchLogger.error(
            "Elasticsearch request returned a client error.",
            {
              method: init.method ?? "GET",
              path,
              status: response.status,
              body: text.slice(0, 500),
            },
          );
        }
        throw response.status >= 500
          ? new ElasticsearchUnavailableError(
              `Elasticsearch request failed with status ${response.status}: ${text.slice(0, 500)}`,
            )
          : new ElasticsearchRequestError(
              response.status,
              `Elasticsearch request failed with status ${response.status}: ${text.slice(0, 500)}`,
            );
      }

      if (response.status === 204) {
        this.recordSuccess();
        return {} as TResponse;
      }

      const json = (await response.json()) as TResponse;
      this.recordSuccess();
      return json;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        recordElasticsearchTimeout();
        this.recordFailure();
      } else if (
        !(error instanceof ElasticsearchUnavailableError) &&
        !(error instanceof ElasticsearchRequestError)
      ) {
        recordElasticsearchTransportError();
        this.recordFailure();
      }

      const wrappedError =
        error instanceof ElasticsearchUnavailableError ||
        error instanceof ElasticsearchRequestError
          ? error
          : new ElasticsearchUnavailableError(
              error instanceof Error
                ? error.message
                : "Elasticsearch request failed.",
            );
      throw wrappedError;
    } finally {
      recordElasticsearchRequest(
        Math.round((performance.now() - startedAt) * 100) / 100,
      );
      clearTimeout(timeout);
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedUntil = null;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;

    if (
      this.consecutiveFailures >= this.config.circuitBreakerFailureThreshold &&
      !this.isCircuitOpen()
    ) {
      this.openedUntil = new Date(
        Date.now() + this.config.circuitBreakerCooldownMs,
      );
      recordCircuitBreakerOpened();
    }
  }

  private requireConfig(): ElasticsearchConfig & { url: string } {
    if (!this.config.enabled || !this.config.url) {
      throw new ElasticsearchUnavailableError(
        "Elasticsearch is not configured.",
      );
    }

    return {
      ...this.config,
      url: this.config.url,
    };
  }
}

function readBoolean(name: string, fallback: boolean): boolean {
  const rawValue = getOptionalEnvironmentVariable(name);

  if (!rawValue) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(rawValue.trim().toLowerCase());
}

function readNumber(name: string, fallback: number): number {
  const rawValue = getOptionalEnvironmentVariable(name);

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  if (Number.isNaN(parsedValue)) {
    throw new Error(`${name} must be a valid number.`);
  }

  return parsedValue;
}

function createElasticsearchClient(): ElasticsearchClient {
  return new ElasticsearchClient({
    enabled: readBoolean("ELASTICSEARCH_ENABLED", false),
    url: getOptionalEnvironmentVariable("ELASTICSEARCH_URL")?.replace(
      /\/+$/,
      "",
    ),
    username: getOptionalEnvironmentVariable("ELASTICSEARCH_USERNAME"),
    password: getOptionalEnvironmentVariable("ELASTICSEARCH_PASSWORD"),
    postingsIndexName:
      getOptionalEnvironmentVariable("ELASTICSEARCH_POSTINGS_INDEX") ??
      "postings",
    timeoutMs: readNumber("ELASTICSEARCH_TIMEOUT_MS", 2_000),
    circuitBreakerFailureThreshold: readNumber(
      "ELASTICSEARCH_CIRCUIT_BREAKER_FAILURE_THRESHOLD",
      3,
    ),
    circuitBreakerCooldownMs: readNumber(
      "ELASTICSEARCH_CIRCUIT_BREAKER_COOLDOWN_MS",
      30_000,
    ),
  });
}

let elasticsearch: ElasticsearchClient | null = null;

export let elasticsearchClient: ElasticsearchClient | null = null;

export async function connectElasticsearch(): Promise<ElasticsearchClient> {
  if (!elasticsearch) {
    elasticsearch = createElasticsearchClient();
    elasticsearchClient = elasticsearch;
  }

  return elasticsearch;
}

export function getElasticsearchClient(): ElasticsearchClient {
  if (!elasticsearch) {
    throw new Error(
      "Elasticsearch has not been initialized. Call connectElasticsearch() first.",
    );
  }

  return elasticsearch;
}

export async function disconnectElasticsearch(): Promise<void> {
  elasticsearch = null;
  elasticsearchClient = null;
}
