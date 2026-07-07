import { randomUUID } from "node:crypto";

const SAFE_RABBITMQ_HOSTS = new Set(["127.0.0.1", "localhost"]);
export const RABBITMQ_TEST_VHOST_PREFIX = "rent-test-";
const DEFAULT_MANAGEMENT_PORT = "15672";

export interface LiveRabbitMqConfig {
  amqpUrl: string;
  managementUrl: string;
  username: string;
  password: string;
  vhost: string;
}

interface RabbitMqQueueResponse {
  name?: string;
  consumers?: number;
  messages?: number;
  messages_ready?: number;
}

interface RabbitMqGetResponse {
  payload?: unknown;
  payload_bytes?: number;
  routing_key?: string;
  exchange?: string;
  properties?: Record<string, unknown>;
}

export interface RabbitMqQueueSnapshot {
  name: string;
  consumers: number;
  messages: number;
  ready: number;
}

export interface PeekedRabbitMqMessage<TPayload = unknown> {
  payload: TPayload;
  routingKey?: string;
  exchange?: string;
  properties: Record<string, unknown>;
}

export function createLiveRabbitMqConfig(sessionId = randomUUID()): LiveRabbitMqConfig {
  const normalizedSessionId = sessionId.replace(/[^a-z0-9-]/gi, "").toLowerCase();
  const vhost = `${RABBITMQ_TEST_VHOST_PREFIX}${normalizedSessionId}`;

  return {
    amqpUrl: `amqp://guest:guest@127.0.0.1:5672/${vhost}`,
    managementUrl: `http://127.0.0.1:${DEFAULT_MANAGEMENT_PORT}/api`,
    username: "guest",
    password: "guest",
    vhost,
  };
}

export function assertSafeRabbitMqTarget(config: LiveRabbitMqConfig): void {
  const amqpUrl = parseUrl(config.amqpUrl, "RabbitMQ AMQP URL");
  const managementUrl = parseUrl(config.managementUrl, "RabbitMQ management URL");
  const vhost = config.vhost.trim();

  if (!SAFE_RABBITMQ_HOSTS.has(amqpUrl.hostname)) {
    throw new Error(
      `Refusing to manage RabbitMQ at non-local host '${amqpUrl.hostname}'.`,
    );
  }

  if (!SAFE_RABBITMQ_HOSTS.has(managementUrl.hostname)) {
    throw new Error(
      `Refusing to use RabbitMQ management API at non-local host '${managementUrl.hostname}'.`,
    );
  }

  if (amqpUrl.port && amqpUrl.port !== "5672") {
    throw new Error(
      `Refusing to manage RabbitMQ on unexpected AMQP port '${amqpUrl.port}'.`,
    );
  }

  if (managementUrl.port && managementUrl.port !== DEFAULT_MANAGEMENT_PORT) {
    throw new Error(
      `Refusing to use RabbitMQ management API on unexpected port '${managementUrl.port}'.`,
    );
  }

  if (!vhost.startsWith(RABBITMQ_TEST_VHOST_PREFIX)) {
    throw new Error(
      `Refusing to manage non-test RabbitMQ vhost '${vhost}'. Use a '${RABBITMQ_TEST_VHOST_PREFIX}...' vhost.`,
    );
  }
}

export async function assertRabbitMqManagementAvailable(
  config: LiveRabbitMqConfig,
): Promise<void> {
  assertSafeRabbitMqTarget(config);
  await rabbitMqManagementRequest(config, "/overview", {
    method: "GET",
  });
}

export async function createRabbitMqTestVhost(
  config: LiveRabbitMqConfig,
): Promise<void> {
  assertSafeRabbitMqTarget(config);
  await rabbitMqManagementRequest(
    config,
    `/vhosts/${encodeURIComponent(config.vhost)}`,
    {
      method: "PUT",
    },
  );
  await rabbitMqManagementRequest(
    config,
    `/permissions/${encodeURIComponent(config.vhost)}/${encodeURIComponent(config.username)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        configure: ".*",
        write: ".*",
        read: ".*",
      }),
    },
  );
}

export async function deleteRabbitMqTestVhost(
  config: LiveRabbitMqConfig,
): Promise<void> {
  assertSafeRabbitMqTarget(config);
  await rabbitMqManagementRequest(
    config,
    `/vhosts/${encodeURIComponent(config.vhost)}`,
    {
      method: "DELETE",
    },
    {
      allowNotFound: true,
    },
  );
}

export async function listRabbitMqQueues(
  config: LiveRabbitMqConfig,
): Promise<RabbitMqQueueSnapshot[]> {
  assertSafeRabbitMqTarget(config);

  const queues = await rabbitMqManagementRequest<RabbitMqQueueResponse[]>(
    config,
    `/queues/${encodeURIComponent(config.vhost)}`,
    {
      method: "GET",
    },
  );

  return queues.map((queue) => ({
    name: queue.name ?? "",
    consumers: queue.consumers ?? 0,
    messages: queue.messages ?? 0,
    ready: queue.messages_ready ?? queue.messages ?? 0,
  }));
}

export async function purgeRabbitMqQueues(
  config: LiveRabbitMqConfig,
): Promise<void> {
  const queues = await listRabbitMqQueues(config);

  await Promise.all(
    queues.map((queue) =>
      rabbitMqManagementRequest(
        config,
        `/queues/${encodeURIComponent(config.vhost)}/${encodeURIComponent(queue.name)}/contents`,
        {
          method: "DELETE",
        },
      ),
    ),
  );
}

export async function peekRabbitMqMessages<TPayload = unknown>(
  config: LiveRabbitMqConfig,
  queueName: string,
  count = 100,
): Promise<Array<PeekedRabbitMqMessage<TPayload>>> {
  assertSafeRabbitMqTarget(config);

  const messages = await rabbitMqManagementRequest<RabbitMqGetResponse[]>(
    config,
    `/queues/${encodeURIComponent(config.vhost)}/${encodeURIComponent(queueName)}/get`,
    {
      method: "POST",
      body: JSON.stringify({
        count,
        ackmode: "ack_requeue_true",
        encoding: "auto",
        truncate: 50_000,
      }),
    },
  );

  return messages.map((message) => ({
    payload: normalizeRabbitMqPayload<TPayload>(message.payload),
    routingKey:
      typeof message.routing_key === "string" ? message.routing_key : undefined,
    exchange: typeof message.exchange === "string" ? message.exchange : undefined,
    properties: message.properties ?? {},
  }));
}

async function rabbitMqManagementRequest<TResponse = unknown>(
  config: LiveRabbitMqConfig,
  path: string,
  init: RequestInit,
  options: {
    allowNotFound?: boolean;
  } = {},
): Promise<TResponse> {
  const response = await fetch(`${config.managementUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
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
      `RabbitMQ management request failed with status ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  if (response.status === 204) {
    return {} as TResponse;
  }

  const responseText = await response.text();
  if (!responseText.trim()) {
    return {} as TResponse;
  }

  return JSON.parse(responseText) as TResponse;
}

function normalizeRabbitMqPayload<TPayload>(payload: unknown): TPayload {
  if (typeof payload !== "string") {
    return payload as TPayload;
  }

  try {
    return JSON.parse(payload) as TPayload;
  } catch {
    return payload as TPayload;
  }
}

function parseUrl(rawValue: string, label: string): URL {
  try {
    return new URL(rawValue);
  } catch {
    throw new Error(`Could not parse ${label} '${rawValue}'.`);
  }
}
