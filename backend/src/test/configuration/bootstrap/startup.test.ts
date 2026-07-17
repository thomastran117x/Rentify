import { initializeServerApplication } from "@/configuration/bootstrap/startup";

describe("initializeServerApplication", () => {
  it("runs auto-seeds after the database connects and before the container initializes", async () => {
    const calls: string[] = [];
    const app = { fetch: jest.fn() };

    const result = await initializeServerApplication({
      connectDatabase: async () => {
        calls.push("connectDatabase");
      },
      runAutoSeedsIfNeeded: async () => {
        calls.push("runAutoSeedsIfNeeded");
      },
      connectRedis: async () => {
        calls.push("connectRedis");
      },
      connectElasticsearch: async () => {
        calls.push("connectElasticsearch");
      },
      isRabbitMqEnabled: () => true,
      connectRabbitMq: async () => {
        calls.push("connectRabbitMq");
      },
      initializeContainer: () => {
        calls.push("initializeContainer");
        return {} as any;
      },
      createApplication: () => {
        calls.push("createApplication");
        return app as any;
      },
      loadEnvironment: () => {
        calls.push("loadEnvironment");
        return {} as any;
      },
    });

    expect(calls).toEqual([
      "loadEnvironment",
      "connectDatabase",
      "runAutoSeedsIfNeeded",
      "connectRedis",
      "connectElasticsearch",
      "connectRabbitMq",
      "initializeContainer",
      "createApplication",
    ]);
    expect(result).toEqual({
      app,
      port: 8040,
    });
  });

  it("skips RabbitMQ connection when the broker is disabled", async () => {
    const calls: string[] = [];

    const result = await initializeServerApplication({
      connectDatabase: async () => {
        calls.push("connectDatabase");
      },
      runAutoSeedsIfNeeded: async () => {
        calls.push("runAutoSeedsIfNeeded");
      },
      connectRedis: async () => {
        calls.push("connectRedis");
      },
      connectElasticsearch: async () => {
        calls.push("connectElasticsearch");
      },
      isRabbitMqEnabled: () => false,
      connectRabbitMq: async () => {
        calls.push("connectRabbitMq");
      },
      initializeContainer: () => {
        calls.push("initializeContainer");
        return {} as any;
      },
      createApplication: () => {
        calls.push("createApplication");
        return { fetch: jest.fn() } as any;
      },
      loadEnvironment: () => {
        calls.push("loadEnvironment");
        return {} as any;
      },
    });

    expect(calls).toEqual([
      "loadEnvironment",
      "connectDatabase",
      "runAutoSeedsIfNeeded",
      "connectRedis",
      "connectElasticsearch",
      "initializeContainer",
      "createApplication",
    ]);
    expect(result.port).toBe(8040);
  });
});
