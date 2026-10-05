import * as containerModule from "@/configuration/bootstrap/container";
import { initializeServerApplication } from "@/configuration/bootstrap/startup";
import { containerTokens } from "@/configuration/container/tokens";

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
      initializeBlobStorage: () => {
        calls.push("initializeBlobStorage");
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
      "initializeBlobStorage",
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
      initializeBlobStorage: () => {
        calls.push("initializeBlobStorage");
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
      "initializeBlobStorage",
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
      initializeBlobStorage: () => undefined,
      createApplication: () => app as any,
      loadEnvironment: () => ({}) as any,
      // The real implementation swallows its own failures; this asserts the
      // default wiring is reached without the container being initialized.
    });

    expect(result.app).toBe(app);
  });

  it("builds the blob storage adapter at boot, so its configuration is checked before traffic", async () => {
    const resolve = jest.fn();
    const getContainer = jest
      .spyOn(containerModule, "getContainer")
      .mockReturnValue({ resolve } as unknown as ReturnType<
        typeof containerModule.getContainer
      >);

    try {
      await initializeServerApplication({
        connectDatabase: async () => undefined,
        runAutoSeedsIfNeeded: async () => undefined,
        connectRedis: async () => undefined,
        connectElasticsearch: async () => undefined,
        isRabbitMqEnabled: () => false,
        connectRabbitMq: async () => undefined,
        initializeContainer: () => ({}) as any,
        warmIdentityBloomFilters: async () => undefined,
        createApplication: () => ({ fetch: jest.fn() }) as any,
        loadEnvironment: () => ({}) as any,
      });

      expect(resolve).toHaveBeenCalledWith(containerTokens.blobService);
    } finally {
      getContainer.mockRestore();
    }
  });
});
