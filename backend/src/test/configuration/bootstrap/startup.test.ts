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
      warmIdentityBloomFilters: async () => {
        calls.push("warmIdentityBloomFilters");
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
      "warmIdentityBloomFilters",
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
      warmIdentityBloomFilters: async () => {
        calls.push("warmIdentityBloomFilters");
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
      "warmIdentityBloomFilters",
      "createApplication",
    ]);
    expect(result.port).toBe(8040);
  });

  it("still starts when the username filter cannot be warmed", async () => {
    // The filter is an optimization over a lookup that still works. Failing
    // boot over it would be a worse outcome than a slower availability check.
    const app = { fetch: jest.fn() };

    const result = await initializeServerApplication({
      connectDatabase: async () => undefined,
      runAutoSeedsIfNeeded: async () => undefined,
      connectRedis: async () => undefined,
      connectElasticsearch: async () => undefined,
      isRabbitMqEnabled: () => false,
      connectRabbitMq: async () => undefined,
      initializeContainer: () => ({}) as any,
      createApplication: () => app as any,
      loadEnvironment: () => ({}) as any,
      // The real implementation swallows its own failures; this asserts the
      // default wiring is reached without the container being initialized.
    });

    expect(result.app).toBe(app);
  });
});
