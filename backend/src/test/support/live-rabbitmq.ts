import { randomUUID } from "node:crypto";
import { connect } from "amqplib";

const SAFE_RABBITMQ_HOSTS = new Set(["127.0.0.1", "localhost"]);
export const RABBITMQ_TEST_VHOST_PREFIX = "rent-test-";

/**
 * The Compose stack publishes RabbitMQ on non-default host ports so it cannot
 * collide with a broker the developer already runs on 5672/15672. When it does
 * collide, the management API and the AMQP endpoint can resolve to *different*
 * brokers, and the harness creates its vhost on one while connecting to the
 * other. Override these when your stack publishes different ports.
 */
const DEFAULT_AMQP_PORT = "5673";
const DEFAULT_MANAGEMENT_PORT = "15673";
const DEFAULT_USERNAME = "guest";
const DEFAULT_PASSWORD = "guest";
const MANAGEMENT_REQUEST_TIMEOUT_MS = 10_000;

export interface LiveRabbitMqConfig {
  amqpUrl: string;
  managementUrl: string;
  username: string;
  password: string;
  vhost: string;
}

export interface RabbitMqBrokerIdentity {
  node: string;
  version: string;
  clusterName: string;
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

export function createLiveRabbitMqConfig(
  sessionId: string = randomUUID(),
): LiveRabbitMqConfig {
  const normalizedSessionId = sessionId
    .replace(/[^a-z0-9-]/gi, "")
    .toLowerCase();
  const vhost = `${RABBITMQ_TEST_VHOST_PREFIX}${normalizedSessionId}`;

  const baseAmqpUrl =
    process.env.RABBITMQ_TEST_AMQP_URL ??
    `amqp://${DEFAULT_USERNAME}:${DEFAULT_PASSWORD}@127.0.0.1:${DEFAULT_AMQP_PORT}`;
  const managementUrl =
    process.env.RABBITMQ_TEST_MANAGEMENT_URL ??
    `http://127.0.0.1:${DEFAULT_MANAGEMENT_PORT}/api`;

  const parsedAmqpUrl = parseUrl(baseAmqpUrl, "RabbitMQ AMQP URL");
  const username =
    decodeURIComponent(parsedAmqpUrl.username) || DEFAULT_USERNAME;
  const password =
    decodeURIComponent(parsedAmqpUrl.password) || DEFAULT_PASSWORD;

  parsedAmqpUrl.pathname = `/${vhost}`;

  return {
    amqpUrl: parsedAmqpUrl.toString(),
    managementUrl: managementUrl.replace(/\/+$/, ""),
    username,
    password,
    vhost,
  };
}

export function assertSafeRabbitMqTarget(config: LiveRabbitMqConfig): void {
  const amqpUrl = parseUrl(config.amqpUrl, "RabbitMQ AMQP URL");
  const managementUrl = parseUrl(
    config.managementUrl,
    "RabbitMQ management URL",
  );
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

  const expectedAmqpPort = getExpectedPort(
    process.env.RABBITMQ_TEST_AMQP_URL,
    DEFAULT_AMQP_PORT,
  );
  const expectedManagementPort = getExpectedPort(
    process.env.RABBITMQ_TEST_MANAGEMENT_URL,
    DEFAULT_MANAGEMENT_PORT,
  );

  if (amqpUrl.port && amqpUrl.port !== expectedAmqpPort) {
    throw new Error(
      `Refusing to manage RabbitMQ on unexpected AMQP port '${amqpUrl.port}'. ` +
        `Expected '${expectedAmqpPort}'. Set RABBITMQ_TEST_AMQP_URL to target a different broker.`,
    );
  }

  if (managementUrl.port && managementUrl.port !== expectedManagementPort) {
    throw new Error(
      `Refusing to use RabbitMQ management API on unexpected port '${managementUrl.port}'. ` +
        `Expected '${expectedManagementPort}'. Set RABBITMQ_TEST_MANAGEMENT_URL to target a different broker.`,
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
  await readRabbitMqBrokerIdentity(config);
}

export async function readRabbitMqBrokerIdentity(
  config: LiveRabbitMqConfig,
): Promise<RabbitMqBrokerIdentity> {
  const overview = await rabbitMqManagementRequest<{
    node?: string;
    rabbitmq_version?: string;
    cluster_name?: string;
  }>(config, "/overview", { method: "GET" });

  return {
    node: overview.node ?? "unknown",
    version: overview.rabbitmq_version ?? "unknown",
    clusterName: overview.cluster_name ?? "unknown",
  };
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

/**
 * Confirms the management API and the AMQP endpoint are the same broker.
 *
 * When the Compose stack collides with another broker already bound to the
 * default ports, these two URLs can resolve to *different* servers. The vhost is
 * then created on one broker and the connection opened against the other, which
 * surfaces only as an opaque `Expected ConnectionOpenOk; got <ConnectionClose>`
 * once the application tries to connect.
 */
export async function assertRabbitMqEndpointsShareBroker(
  config: LiveRabbitMqConfig,
): Promise<void> {
  assertSafeRabbitMqTarget(config);

  const managementIdentity = await readRabbitMqBrokerIdentity(config);

  let amqpClusterName: string;
  try {
    const connection = await connect(config.amqpUrl);
    const serverProperties = connection.connection.serverProperties;
    amqpClusterName = String(serverProperties.cluster_name ?? "unknown");
    await connection.close();
  } catch (error) {
    throw new Error(
      `Could not open an AMQP connection to vhost '${config.vhost}' after creating it through ` +
        `${config.managementUrl}. The management API reported broker ` +
        `'${managementIdentity.clusterName}' (node ${managementIdentity.node}, version ` +
        `${managementIdentity.version}). If another RabbitMQ broker is bound to the AMQP port, ` +
        `the vhost was created on a different server than the one being connected to. ` +
        `Set RABBITMQ_TEST_AMQP_URL and RABBITMQ_TEST_MANAGEMENT_URL to point at the same broker. ` +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (amqpClusterName !== managementIdentity.clusterName) {
    throw new Error(
      `RabbitMQ management API and AMQP endpoint are different brokers. ` +
        `Management ${config.managementUrl} reports cluster '${managementIdentity.clusterName}' ` +
        `(node ${managementIdentity.node}, version ${managementIdentity.version}), while AMQP ` +
        `reports cluster '${amqpClusterName}'. Test vhosts would be created on one broker and ` +
        `connected to on the other. Set RABBITMQ_TEST_AMQP_URL and RABBITMQ_TEST_MANAGEMENT_URL ` +
        `to point at the same broker.`,
    );
  }
}

export async function listRabbitMqTestVhosts(
  config: LiveRabbitMqConfig,
): Promise<string[]> {
  assertSafeRabbitMqTarget(config);

  const vhosts = await rabbitMqManagementRequest<Array<{ name?: string }>>(
    config,
    "/vhosts",
    { method: "GET" },
  );

  return vhosts
    .map((vhost) => vhost.name ?? "")
    .filter((name) => name.startsWith(RABBITMQ_TEST_VHOST_PREFIX));
}

/**
 * Removes `rent-test-*` vhosts left behind by runs that crashed before
 * teardown. The current session's vhost is always preserved.
 */
export async function sweepStaleRabbitMqTestVhosts(
  config: LiveRabbitMqConfig,
): Promise<string[]> {
  const staleVhosts = (await listRabbitMqTestVhosts(config)).filter(
    (vhost) => vhost !== config.vhost,
  );

  const swept: string[] = [];
  for (const vhost of staleVhosts) {
    try {
      await deleteRabbitMqTestVhost({ ...config, vhost });
      swept.push(vhost);
    } catch {
      // A concurrent run may own this vhost; leaving it behind is safe.
    }
  }

  return swept;
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
    exchange:
      typeof message.exchange === "string" ? message.exchange : undefined,
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
  const method = init.method ?? "GET";
  let response: Response;

  try {
    response = await fetch(`${config.managementUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    throw new Error(
      `RabbitMQ management request ${method} ${path} failed against ${config.managementUrl} ` +
        `(vhost '${config.vhost}'): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (options.allowNotFound && response.status === 404) {
    return {} as TResponse;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `RabbitMQ management request ${method} ${path} failed against ${config.managementUrl} ` +
        `(vhost '${config.vhost}') with status ${response.status}: ${text.slice(0, 500)}`,
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

function getExpectedPort(
  configuredUrl: string | undefined,
  fallbackPort: string,
): string {
  if (!configuredUrl) {
    return fallbackPort;
  }

  const parsedUrl = parseUrl(configuredUrl, "configured RabbitMQ test URL");
  return parsedUrl.port || fallbackPort;
}

function parseUrl(rawValue: string, label: string): URL {
  try {
    return new URL(rawValue);
  } catch {
    throw new Error(`Could not parse ${label} '${rawValue}'.`);
  }
}
