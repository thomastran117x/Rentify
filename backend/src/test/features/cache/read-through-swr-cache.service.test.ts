import type { CacheService, RedisLock } from "@/features/cache/cache.service";
import {
  ReadThroughSwrCacheService,
  type ReadThroughCacheEnvelope,
  type ReadThroughCachePolicy,
} from "@/features/cache/read-through-swr-cache.service";

class InMemoryCacheService
  implements
    Pick<
      CacheService,
      "acquireLock" | "get" | "getJson" | "increment" | "setJson"
    >
{
  private readonly values = new Map<string, string>();
  private readonly locks = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async setJson(
    key: string,
    value: unknown,
    _ttlInSeconds?: number,
  ): Promise<void> {
    this.values.set(key, JSON.stringify(value));
  }

  async increment(key: string, amount = 1): Promise<number> {
    const current = Number(this.values.get(key) ?? "0");
    const next = current + amount;
    this.values.set(key, next.toString());
    return next;
  }

  async acquireLock(key: string, _ttlInMs: number): Promise<RedisLock | null> {
    if (this.locks.has(key)) {
      return null;
    }

    const token = `${key}:${this.locks.size + 1}`;
    this.locks.set(key, token);

    return {
      key,
      token,
      release: async () => {
        if (this.locks.get(key) !== token) {
          return false;
        }

        this.locks.delete(key);
        return true;
      },
      extend: async () => true,
    };
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve,
  };
}

function createEnvelope<T>(
  value: T | null,
  options: {
    freshOffsetMs: number;
    staleOffsetMs: number;
  },
): ReadThroughCacheEnvelope<T> {
  const now = Date.now();

  return {
    kind: value === null ? "miss" : "hit",
    ...(value === null ? {} : { value }),
    cachedAt: new Date(now).toISOString(),
    freshUntil: new Date(now + options.freshOffsetMs).toISOString(),
    staleUntil: new Date(now + options.staleOffsetMs).toISOString(),
  };
}

function createPolicy(
  overrides: Partial<ReadThroughCachePolicy> = {},
): ReadThroughCachePolicy {
  return {
    freshTtlSeconds: 5,
    staleTtlSeconds: 30,
    rebuildLockTtlMs: 5_000,
    followerWaitTimeoutMs: 50,
    followerPollIntervalMs: 5,
    negativeTtlSeconds: 5,
    ttlJitterRatio: 0,
    ...overrides,
  };
}

describe("ReadThroughSwrCacheService", () => {
  it("coalesces concurrent cold misses within a process behind one loader promise", async () => {
    const cacheService = new InMemoryCacheService();
    const service = new ReadThroughSwrCacheService(cacheService);
    const deferred = createDeferred<string | null>();
    const loader = jest.fn(() => deferred.promise);

    const firstRead = service.get("entities", "item-1", loader, createPolicy());
    const secondRead = service.get(
      "entities",
      "item-1",
      loader,
      createPolicy(),
    );

    deferred.resolve("leader-value");

    await expect(Promise.all([firstRead, secondRead])).resolves.toEqual([
      "leader-value",
      "leader-value",
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("serves stale entries while triggering only one background refresh in the process", async () => {
    const cacheService = new InMemoryCacheService();
    const service = new ReadThroughSwrCacheService(cacheService);
    const loader = jest.fn().mockResolvedValue("fresh-value");

    await cacheService.setJson(
      "entities:data:item-1:0",
      createEnvelope("stale-value", {
        freshOffsetMs: -1_000,
        staleOffsetMs: 10_000,
      }),
    );

    await expect(
      Promise.all([
        service.get("entities", "item-1", loader, createPolicy()),
        service.get("entities", "item-1", loader, createPolicy()),
      ]),
    ).resolves.toEqual(["stale-value", "stale-value"]);

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    await expect(
      service.get("entities", "item-1", loader, createPolicy()),
    ).resolves.toBe("fresh-value");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("falls back to a direct load when another instance holds the rebuild lock too long", async () => {
    const cacheService = new InMemoryCacheService();
    const service = new ReadThroughSwrCacheService(cacheService);
    const externalLock = await cacheService.acquireLock(
      "entities:rebuild:item-1",
      5_000,
    );
    const loader = jest.fn().mockResolvedValue("direct-fallback");

    await expect(
      service.get(
        "entities",
        "item-1",
        loader,
        createPolicy({
          followerWaitTimeoutMs: 20,
          followerPollIntervalMs: 5,
        }),
      ),
    ).resolves.toBe("direct-fallback");

    expect(loader).toHaveBeenCalledTimes(1);
    await externalLock?.release();
  });

  it("keeps an old-generation refresh from becoming visible after invalidation", async () => {
    const cacheService = new InMemoryCacheService();
    const service = new ReadThroughSwrCacheService(cacheService);
    const refreshDeferred = createDeferred<string | null>();
    const loader = jest
      .fn()
      .mockImplementationOnce(() => refreshDeferred.promise)
      .mockResolvedValueOnce("new-generation");

    await cacheService.setJson(
      "entities:data:item-1:0",
      createEnvelope("stale-value", {
        freshOffsetMs: -1_000,
        staleOffsetMs: 10_000,
      }),
    );

    await expect(
      service.get("entities", "item-1", loader, createPolicy()),
    ).resolves.toBe("stale-value");

    await service.invalidate("entities", "item-1");
    refreshDeferred.resolve("old-generation");

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    await expect(
      service.get("entities", "item-1", loader, createPolicy()),
    ).resolves.toBe("new-generation");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("caches misses briefly so repeated reads do not re-run the loader", async () => {
    const cacheService = new InMemoryCacheService();
    const service = new ReadThroughSwrCacheService(cacheService);
    const loader = jest.fn().mockResolvedValue(null);

    await expect(
      service.get("entities", "item-1", loader, createPolicy()),
    ).resolves.toBeNull();
    await expect(
      service.get("entities", "item-1", loader, createPolicy()),
    ).resolves.toBeNull();

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("applies jitter only to positive entries and keeps negative entries deterministic", async () => {
    const cacheService = new InMemoryCacheService();
    const service = new ReadThroughSwrCacheService(cacheService, () => 0);
    const positivePolicy = createPolicy({
      freshTtlSeconds: 10,
      staleTtlSeconds: 20,
      ttlJitterRatio: 0.1,
    });

    await expect(
      service.get(
        "entities",
        "item-1",
        async () => "positive-value",
        positivePolicy,
      ),
    ).resolves.toBe("positive-value");

    const positiveEntry = await cacheService.getJson<
      ReadThroughCacheEnvelope<string>
    >("entities:data:item-1:0");

    expect(positiveEntry).not.toBeNull();

    const positiveCachedAt = Date.parse(positiveEntry!.cachedAt);
    const positiveFreshDelta =
      Date.parse(positiveEntry!.freshUntil) - positiveCachedAt;
    const positiveStaleDelta =
      Date.parse(positiveEntry!.staleUntil) - positiveCachedAt;

    expect(positiveFreshDelta).toBeGreaterThanOrEqual(8_900);
    expect(positiveFreshDelta).toBeLessThanOrEqual(9_100);
    expect(positiveStaleDelta).toBeGreaterThanOrEqual(17_900);
    expect(positiveStaleDelta).toBeLessThanOrEqual(18_100);

    await expect(
      service.get(
        "entities",
        "item-2",
        async () => null,
        createPolicy({
          negativeTtlSeconds: 5,
          ttlJitterRatio: 0.5,
        }),
      ),
    ).resolves.toBeNull();

    const negativeEntry = await cacheService.getJson<
      ReadThroughCacheEnvelope<string>
    >("entities:data:item-2:0");

    expect(negativeEntry).not.toBeNull();

    const negativeCachedAt = Date.parse(negativeEntry!.cachedAt);
    const negativeFreshDelta =
      Date.parse(negativeEntry!.freshUntil) - negativeCachedAt;
    const negativeStaleDelta =
      Date.parse(negativeEntry!.staleUntil) - negativeCachedAt;

    expect(negativeFreshDelta).toBeGreaterThanOrEqual(4_900);
    expect(negativeFreshDelta).toBeLessThanOrEqual(5_100);
    expect(negativeStaleDelta).toBeGreaterThanOrEqual(4_900);
    expect(negativeStaleDelta).toBeLessThanOrEqual(5_100);
  });
});
