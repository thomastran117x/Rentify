import {
  assertSafeElasticsearchTarget,
  type LiveElasticsearchConfig,
} from "./live-elasticsearch";
import {
  assertSafeRabbitMqTarget,
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
      amqpUrl: "amqp://guest:guest@rabbitmq.internal:5672/rent-test-unsafe",
      managementUrl: "http://127.0.0.1:15672/api",
      username: "guest",
      password: "guest",
      vhost: "rent-test-unsafe",
    };
    const nonTestVhostConfig: LiveRabbitMqConfig = {
      amqpUrl: "amqp://guest:guest@127.0.0.1:5672/production",
      managementUrl: "http://127.0.0.1:15672/api",
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
});
