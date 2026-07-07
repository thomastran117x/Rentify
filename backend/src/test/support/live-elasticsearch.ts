import { randomUUID } from "node:crypto";

const SAFE_ELASTICSEARCH_HOSTS = new Set(["127.0.0.1", "localhost"]);
export const ELASTICSEARCH_TEST_PREFIX = "rent-test-";

export interface LiveElasticsearchConfig {
  url: string;
  indexPrefix: string;
  postingsIndexName: string;
  reportsIndexName: string;
}

export function createLiveElasticsearchConfig(
  sessionId = randomUUID(),
): LiveElasticsearchConfig {
  const normalizedSessionId = sessionId.replace(/[^a-z0-9-]/gi, "").toLowerCase();
  const indexPrefix = `${ELASTICSEARCH_TEST_PREFIX}${normalizedSessionId}`;

  const postingsIndexName = `${indexPrefix}-postings`;

  return {
    url: "http://127.0.0.1:9201",
    indexPrefix,
    postingsIndexName,
    reportsIndexName: `${postingsIndexName}-reports`,
  };
}

export function assertSafeElasticsearchTarget(
  config: LiveElasticsearchConfig,
): void {
  const parsedUrl = parseUrl(config.url, "Elasticsearch URL");

  if (!SAFE_ELASTICSEARCH_HOSTS.has(parsedUrl.hostname)) {
    throw new Error(
      `Refusing to manage Elasticsearch at non-local host '${parsedUrl.hostname}'.`,
    );
  }

  if (parsedUrl.port && parsedUrl.port !== "9201") {
    throw new Error(
      `Refusing to manage Elasticsearch on unexpected port '${parsedUrl.port}'.`,
    );
  }

  if (!config.indexPrefix.startsWith(ELASTICSEARCH_TEST_PREFIX)) {
    throw new Error(
      `Refusing to manage non-test Elasticsearch prefix '${config.indexPrefix}'. Use a '${ELASTICSEARCH_TEST_PREFIX}...' prefix.`,
    );
  }
}

export async function assertElasticsearchAvailable(
  config: LiveElasticsearchConfig,
): Promise<void> {
  assertSafeElasticsearchTarget(config);
  await elasticsearchRequest(config, "/", {
    method: "GET",
  });
}

export async function deleteElasticsearchIndicesByPrefix(
  config: LiveElasticsearchConfig,
): Promise<void> {
  assertSafeElasticsearchTarget(config);

  const indices = await elasticsearchRequest<Array<{ index?: string }>>(
    config,
    `/_cat/indices/${encodeURIComponent(config.indexPrefix)}*?format=json&h=index&expand_wildcards=all&ignore_unavailable=true`,
    {
      method: "GET",
    },
    {
      allowNotFound: true,
    },
  );

  await Promise.all(
    indices
      .map((entry) => entry.index?.trim())
      .filter((indexName): indexName is string => Boolean(indexName))
      .map((indexName) =>
        elasticsearchRequest(
          config,
          `/${encodeURIComponent(indexName)}?ignore_unavailable=true`,
          {
            method: "DELETE",
          },
          {
            allowNotFound: true,
          },
        ),
      ),
  );
}

export async function getElasticsearchDocument<TDocument = unknown>(
  config: LiveElasticsearchConfig,
  indexName: string,
  id: string,
): Promise<TDocument | null> {
  assertSafeElasticsearchTarget(config);

  const response = await elasticsearchRequest<{
    found?: boolean;
    _source?: TDocument;
  }>(
    config,
    `/${encodeURIComponent(indexName)}/_doc/${encodeURIComponent(id)}`,
    {
      method: "GET",
    },
    {
      allowNotFound: true,
    },
  );

  if (!response.found) {
    return null;
  }

  return response._source ?? null;
}

export async function waitForElasticsearchDocument<TDocument = unknown>(
  config: LiveElasticsearchConfig,
  indexName: string,
  id: string,
  timeoutMs = 5_000,
  pollIntervalMs = 100,
): Promise<TDocument> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const document = await getElasticsearchDocument<TDocument>(
      config,
      indexName,
      id,
    );

    if (document) {
      return document;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for Elasticsearch document '${id}' in index '${indexName}'.`,
  );
}

async function elasticsearchRequest<TResponse = unknown>(
  config: LiveElasticsearchConfig,
  path: string,
  init: RequestInit,
  options: {
    allowNotFound?: boolean;
  } = {},
): Promise<TResponse> {
  const response = await fetch(`${config.url}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (options.allowNotFound && response.status === 404) {
    return {} as TResponse;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Elasticsearch request failed with status ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  if (response.status === 204) {
    return {} as TResponse;
  }

  return (await response.json()) as TResponse;
}

function parseUrl(rawValue: string, label: string): URL {
  try {
    return new URL(rawValue);
  } catch {
    throw new Error(`Could not parse ${label} '${rawValue}'.`);
  }
}
