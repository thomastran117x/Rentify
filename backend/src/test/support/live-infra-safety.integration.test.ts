import {
  assertSafeElasticsearchTarget,
  type LiveElasticsearchConfig,
} from "./live-elasticsearch";
import {
  assertSafeRabbitMqTarget,
  createLiveRabbitMqConfig,
  type LiveRabbitMqConfig,
} from "./live-rabbitmq";

describe("Live infrastructure safety guards", () => {
  it("rejects non-test or non-local Elasticsearch targets", () => {
    const nonLocalConfig: LiveElasticsearchConfig = {
      url: "http://elasticsearch.internal:9201",
      indexPrefix: "rent-test-unsafe",
      postingsIndexName: "rent-test-unsafe-postings",
      reportsIndexName: "rent-test-unsafe-reports",
    };
    const nonTestPrefixConfig: LiveElasticsearchConfig = {
      url: "http://127.0.0.1:9201",
      indexPrefix: "postings",
      postingsIndexName: "postings",
      reportsIndexName: "postings-reports",
    };

    expect(() => assertSafeElasticsearchTarget(nonLocalConfig)).toThrow(
      /Refusing to manage Elasticsearch at non-local host/,
    );
    expect(() => assertSafeElasticsearchTarget(nonTestPrefixConfig)).toThrow(
      /Refusing to manage non-test Elasticsearch prefix/,
    );
  });

  it("rejects non-test or non-local RabbitMQ targets", () => {
    const nonLocalConfig: LiveRabbitMqConfig = {
      amqpUrl: "amqp://guest:guest@rabbitmq.internal:5673/rent-test-unsafe",
      managementUrl: "http://127.0.0.1:15673/api",
      username: "guest",
      password: "guest",
      vhost: "rent-test-unsafe",
    };
    const nonTestVhostConfig: LiveRabbitMqConfig = {
      amqpUrl: "amqp://guest:guest@127.0.0.1:5673/production",
      managementUrl: "http://127.0.0.1:15673/api",
      username: "guest",
      password: "guest",
      vhost: "production",
    };

    expect(() => assertSafeRabbitMqTarget(nonLocalConfig)).toThrow(
      /Refusing to manage RabbitMQ at non-local host/,
    );
    expect(() => assertSafeRabbitMqTarget(nonTestVhostConfig)).toThrow(
      /Refusing to manage non-test RabbitMQ vhost/,
    );
  });

  it("rejects RabbitMQ ports that were not configured for tests", () => {
    const defaultBrokerConfig: LiveRabbitMqConfig = {
      amqpUrl: "amqp://guest:guest@127.0.0.1:5672/rent-test-unsafe",
      managementUrl: "http://127.0.0.1:15673/api",
      username: "guest",
      password: "guest",
      vhost: "rent-test-unsafe",
    };

    expect(() => assertSafeRabbitMqTarget(defaultBrokerConfig)).toThrow(
      /Refusing to manage RabbitMQ on unexpected AMQP port '5672'/,
    );
  });

  it("accepts the ports named by the test URL overrides", () => {
    const previousAmqpUrl = process.env.RABBITMQ_TEST_AMQP_URL;
    const previousManagementUrl = process.env.RABBITMQ_TEST_MANAGEMENT_URL;

    process.env.RABBITMQ_TEST_AMQP_URL = "amqp://guest:guest@127.0.0.1:5672";
    process.env.RABBITMQ_TEST_MANAGEMENT_URL = "http://127.0.0.1:15672/api";

    try {
      const config = createLiveRabbitMqConfig("session-override");

      expect(config.amqpUrl).toBe(
        "amqp://guest:guest@127.0.0.1:5672/rent-test-session-override",
      );
      expect(config.managementUrl).toBe("http://127.0.0.1:15672/api");
      expect(() => assertSafeRabbitMqTarget(config)).not.toThrow();
    } finally {
      restoreEnvironmentVariable("RABBITMQ_TEST_AMQP_URL", previousAmqpUrl);
      restoreEnvironmentVariable(
        "RABBITMQ_TEST_MANAGEMENT_URL",
        previousManagementUrl,
      );
    }
  });
});

function restoreEnvironmentVariable(
  name: string,
  previousValue: string | undefined,
): void {
  if (previousValue === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = previousValue;
}
