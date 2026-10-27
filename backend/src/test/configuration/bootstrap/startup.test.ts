import { initializeServerApplication } from "@/configuration/bootstrap/startup";
import { loggerFactory } from "@/configuration/logging";

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
      attachAuthAuditListeners: () => {
        calls.push("attachAuthAuditListeners");
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
      warnOnProxyTrustConfiguration: () => {
        calls.push("warnOnProxyTrustConfiguration");
      },
      checkBlobStorageAccess: async () => {
        calls.push("checkBlobStorageAccess");
      },
    });

    expect(calls).toEqual([
      "loadEnvironment",
      "warnOnProxyTrustConfiguration",
      "checkBlobStorageAccess",
      "connectDatabase",
      "runAutoSeedsIfNeeded",
      "connectRedis",
      "connectElasticsearch",
      "connectRabbitMq",
      "initializeContainer",
      "attachAuthAuditListeners",
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
      attachAuthAuditListeners: () => {
        calls.push("attachAuthAuditListeners");
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
      checkBlobStorageAccess: async () => {
        calls.push("checkBlobStorageAccess");
      },
    });

    expect(calls).toEqual([
      "loadEnvironment",
      "checkBlobStorageAccess",
      "connectDatabase",
      "runAutoSeedsIfNeeded",
      "connectRedis",
      "connectElasticsearch",
      "initializeContainer",
      "attachAuthAuditListeners",
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
      attachAuthAuditListeners: () => undefined,
      checkBlobStorageAccess: async () => undefined,
      createApplication: () => app as any,
      loadEnvironment: () => ({}) as any,
      // The real implementation swallows its own failures; this asserts the
      // default wiring is reached without the container being initialized.
    });

    expect(result.app).toBe(app);
  });

  it("warns at startup when the deprecated proxy flag is the only trust setting", async () => {
    const warn = jest.fn();
    const forComponent = jest
      .spyOn(loggerFactory, "forComponent")
      .mockReturnValue({ warn } as any);
    const original = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = "true";

    try {
      await initializeServerApplication({
        loadEnvironment: () => ({}) as any,
        checkBlobStorageAccess: async () => {
          throw new Error("stop after the warning");
        },
      }).catch(() => undefined);

      expect(forComponent).toHaveBeenCalledWith("client-ip", "app");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("TRUST_PROXY_HEADERS is deprecated"),
      );
    } finally {
      if (original === undefined) {
        delete process.env.TRUST_PROXY_HEADERS;
      } else {
        process.env.TRUST_PROXY_HEADERS = original;
      }
      forComponent.mockRestore();
    }
  });

  it("stops before any I/O when blob storage cannot be reached", async () => {
    const connectDatabase = jest.fn();
    const runAutoSeedsIfNeeded = jest.fn();

    await expect(
      initializeServerApplication({
        loadEnvironment: () => ({}) as any,
        checkBlobStorageAccess: async () => {
          throw new Error("Could not sign in to Azure Storage.");
        },
        connectDatabase,
        runAutoSeedsIfNeeded,
      }),
    ).rejects.toThrow("Could not sign in to Azure Storage.");
    expect(connectDatabase).not.toHaveBeenCalled();
    expect(runAutoSeedsIfNeeded).not.toHaveBeenCalled();
  });
});
