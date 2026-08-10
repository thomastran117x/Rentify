import { randomUUID } from "node:crypto";
import { connect } from "amqplib";
import {
  assertRabbitMqEndpointsShareBroker,
  assertRabbitMqManagementAvailable,
  createLiveRabbitMqConfig,
  createRabbitMqTestVhost,
  deleteRabbitMqTestVhost,
  listRabbitMqQueues,
  listRabbitMqTestVhosts,
  peekRabbitMqMessages,
  purgeRabbitMqQueues,
  sweepStaleRabbitMqTestVhosts,
  type LiveRabbitMqConfig,
} from "./live-rabbitmq";

/**
 * Guards the RabbitMQ test-vhost lifecycle the persistence harness depends on.
 *
 * The whole persistence suite fails at setup if any step here breaks, so this
 * runs the create/connect/publish/peek/purge/delete cycle in isolation and gives
 * a precise failure instead of an opaque driver error inside an unrelated suite.
 */
describe("Live RabbitMQ test vhost lifecycle", () => {
  const createdVhosts: LiveRabbitMqConfig[] = [];

  afterAll(async () => {
    await Promise.allSettled(
      createdVhosts.map((config) => deleteRabbitMqTestVhost(config)),
    );
  }, 60_000);

  function trackVhost(config: LiveRabbitMqConfig): LiveRabbitMqConfig {
    createdVhosts.push(config);
    return config;
  }

  it("creates a vhost, publishes and reads a message, then deletes it", async () => {
    const config = trackVhost(createLiveRabbitMqConfig(randomUUID()));
    const queueName = "lifecycle-probe";

    await assertRabbitMqManagementAvailable(config);
    await createRabbitMqTestVhost(config);

    expect(await listRabbitMqTestVhosts(config)).toContain(config.vhost);

    const connection = await connect(config.amqpUrl);
    const channel = await connection.createChannel();
    await channel.assertQueue(queueName, { durable: false });
    channel.sendToQueue(
      queueName,
      Buffer.from(JSON.stringify({ probe: "lifecycle" })),
      { contentType: "application/json" },
    );
    await channel.close();
    await connection.close();

    const messages = await peekRabbitMqMessages<{ probe: string }>(
      config,
      queueName,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.payload).toEqual({ probe: "lifecycle" });

    await purgeRabbitMqQueues(config);

    const queues = await listRabbitMqQueues(config);
    expect(queues.find((queue) => queue.name === queueName)?.ready ?? 0).toBe(
      0,
    );

    await deleteRabbitMqTestVhost(config);

    expect(await listRabbitMqTestVhosts(config)).not.toContain(config.vhost);
  }, 120_000);

  it("confirms the management API and AMQP endpoint are the same broker", async () => {
    const config = trackVhost(createLiveRabbitMqConfig(randomUUID()));

    await createRabbitMqTestVhost(config);
    await expect(
      assertRabbitMqEndpointsShareBroker(config),
    ).resolves.toBeUndefined();

    await deleteRabbitMqTestVhost(config);
  }, 120_000);

  it("sweeps leaked test vhosts while preserving the current session", async () => {
    const activeConfig = trackVhost(createLiveRabbitMqConfig(randomUUID()));
    const leakedConfig = trackVhost(createLiveRabbitMqConfig(randomUUID()));

    await createRabbitMqTestVhost(activeConfig);
    await createRabbitMqTestVhost(leakedConfig);

    const swept = await sweepStaleRabbitMqTestVhosts(activeConfig);

    expect(swept).toContain(leakedConfig.vhost);
    expect(swept).not.toContain(activeConfig.vhost);

    const remaining = await listRabbitMqTestVhosts(activeConfig);
    expect(remaining).toContain(activeConfig.vhost);
    expect(remaining).not.toContain(leakedConfig.vhost);

    await deleteRabbitMqTestVhost(activeConfig);
  }, 120_000);
});
