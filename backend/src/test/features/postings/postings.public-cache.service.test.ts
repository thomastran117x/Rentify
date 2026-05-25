import type { CacheService, RedisLock } from "@/features/cache/cache.service";
import {
  PostingsPublicCacheService,
  type PostingsPublicCacheConfig,
} from "@/features/postings/postings.public-cache.service";
import type {
  BatchPostingsResult,
  PublicPostingRecord,
} from "@/features/postings/postings.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";

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

function createPublicPosting(
  overrides: Partial<PublicPostingRecord> = {},
): PublicPostingRecord {
  return {
    id: "posting-1",
    ownerId: "owner-1",
    status: "published",
    variant: {
      family: "place",
      subtype: "entire_place",
    },
    name: "Sunny loft",
    description: "Bright loft with workspace",
    pricing: {
      currency: "CAD",
      daily: {
        amount: 150,
      },
    },
    pricingCurrency: "CAD",
    photos: [
      {
        id: "photo-1",
        blobUrl: "https://example.blob.core.windows.net/postings/photo-1.jpg",
        blobName: "postings/photo-1.jpg",
        position: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ],
    tags: ["loft"],
    details: {
      guest_capacity: 4,
      property_type: "loft",
      amenities: [],
    },
    availabilityStatus: "available",
    effectiveMaxBookingDurationDays: 30,
    availabilityBlocks: [],
    location: {
      city: "Toronto",
      region: "Ontario",
      country: "Canada",
      latitude: 43.65,
      longitude: -79.38,
    },
    primaryPhotoUrl:
      "https://example.blob.core.windows.net/postings/photo-1.jpg",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    publishedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function createBatchResult(
  postings: PublicPostingRecord[],
  missingIds: string[] = [],
): BatchPostingsResult<PublicPostingRecord> {
  return {
    postings,
    missingIds,
  };
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

function createEnvelope(
  posting: PublicPostingRecord | null,
  options: {
    freshOffsetMs: number;
    staleOffsetMs: number;
  },
) {
  const now = Date.now();

  return {
    kind: posting ? "hit" : "miss",
    ...(posting ? { value: posting } : {}),
    cachedAt: new Date(now).toISOString(),
    freshUntil: new Date(now + options.freshOffsetMs).toISOString(),
    staleUntil: new Date(now + options.staleOffsetMs).toISOString(),
  };
}

function createService(options?: {
  batchFindPublic?: jest.Mock;
  config?: Partial<PostingsPublicCacheConfig>;
}) {
  const cacheService = new InMemoryCacheService();
  const batchFindPublic =
    options?.batchFindPublic ??
    jest.fn(async ({ ids }: { ids: string[] }) =>
      createBatchResult(ids.map((id) => createPublicPosting({ id }))),
    );
  const repository = {
    batchFindPublic,
  } as unknown as PostingsRepository;
  const service = new PostingsPublicCacheService(
    cacheService as unknown as CacheService,
    repository,
    {
      freshTtlSeconds: 5,
      staleTtlSeconds: 30,
      rebuildLockTtlMs: 5_000,
      followerWaitTimeoutMs: 50,
      followerPollIntervalMs: 5,
      negativeTtlSeconds: 5,
      ttlJitterRatio: 0,
      ...options?.config,
    },
  );

  return {
    cacheService,
    batchFindPublic,
    service,
  };
}

describe("PostingsPublicCacheService", () => {
  it("coalesces concurrent cold misses behind a single rebuild", async () => {
    const deferred = createDeferred<BatchPostingsResult<PublicPostingRecord>>();
    const { batchFindPublic, service } = createService({
      batchFindPublic: jest.fn(() => deferred.promise),
      config: {
        followerWaitTimeoutMs: 100,
      },
    });

    const firstRead = service.getPublicById("posting-1");
    const secondRead = service.getPublicById("posting-1");

    deferred.resolve(createBatchResult([createPublicPosting()]));

    await expect(Promise.all([firstRead, secondRead])).resolves.toEqual([
      createPublicPosting(),
      createPublicPosting(),
    ]);
    expect(batchFindPublic).toHaveBeenCalledTimes(1);
  });

  it("falls back to a direct database read when the leader rebuild does not finish in time", async () => {
    const { batchFindPublic, cacheService, service } = createService({
      batchFindPublic: jest
        .fn()
        .mockResolvedValue(
          createBatchResult([createPublicPosting({ name: "Follower read" })]),
        ),
      config: {
        followerWaitTimeoutMs: 20,
        followerPollIntervalMs: 5,
      },
    });
    const externalLock = await cacheService.acquireLock(
      "postings:public:rebuild:posting-1",
      5_000,
    );

    await expect(service.getPublicById("posting-1")).resolves.toMatchObject({
      name: "Follower read",
    });

    expect(batchFindPublic).toHaveBeenCalledTimes(1);
    await externalLock?.release();
  });

  it("serves stale data while triggering a single background refresh", async () => {
    const stalePosting = createPublicPosting({ name: "Stale name" });
    const refreshedPosting = createPublicPosting({ name: "Fresh name" });
    const { batchFindPublic, cacheService, service } = createService({
      batchFindPublic: jest.fn(async () =>
        createBatchResult([refreshedPosting]),
      ),
    });

    await cacheService.setJson(
      "postings:public:data:posting-1:0",
      createEnvelope(stalePosting, {
        freshOffsetMs: -1_000,
        staleOffsetMs: 10_000,
      }),
    );

    await expect(service.getPublicById("posting-1")).resolves.toMatchObject({
      name: "Stale name",
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    await expect(service.getPublicById("posting-1")).resolves.toMatchObject({
      name: "Fresh name",
    });
    expect(batchFindPublic).toHaveBeenCalledTimes(1);
  });

  it("keeps an old-generation refresh from becoming visible after invalidation", async () => {
    const stalePosting = createPublicPosting({ name: "Stale name" });
    const oldGenerationRefresh = createPublicPosting({
      name: "Old generation refresh",
    });
    const newGenerationPosting = createPublicPosting({
      name: "New generation posting",
    });
    const refreshDeferred =
      createDeferred<BatchPostingsResult<PublicPostingRecord>>();
    const { batchFindPublic, cacheService, service } = createService({
      batchFindPublic: jest
        .fn()
        .mockImplementationOnce(() => refreshDeferred.promise)
        .mockResolvedValueOnce(createBatchResult([newGenerationPosting])),
    });

    await cacheService.setJson(
      "postings:public:data:posting-1:0",
      createEnvelope(stalePosting, {
        freshOffsetMs: -1_000,
        staleOffsetMs: 10_000,
      }),
    );

    await expect(service.getPublicById("posting-1")).resolves.toMatchObject({
      name: "Stale name",
    });

    await service.invalidatePublic("posting-1");
    refreshDeferred.resolve(createBatchResult([oldGenerationRefresh]));
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    await expect(service.getPublicById("posting-1")).resolves.toMatchObject({
      name: "New generation posting",
    });
    expect(batchFindPublic).toHaveBeenCalledTimes(2);
  });

  it("caches misses briefly and invalidates them cleanly when a posting becomes public", async () => {
    const { batchFindPublic, service } = createService({
      batchFindPublic: jest
        .fn()
        .mockResolvedValueOnce(createBatchResult([], ["posting-1"]))
        .mockResolvedValueOnce(createBatchResult([createPublicPosting()])),
    });

    await expect(service.getPublicById("posting-1")).resolves.toBeNull();
    await expect(service.getPublicById("posting-1")).resolves.toBeNull();

    await service.invalidatePublic("posting-1");

    await expect(service.getPublicById("posting-1")).resolves.toMatchObject({
      id: "posting-1",
    });
    expect(batchFindPublic).toHaveBeenCalledTimes(2);
  });

  it("hydrates batches from a mix of cache hits and misses while preserving order", async () => {
    const cachedPosting = createPublicPosting({
      id: "posting-1",
      name: "Cached",
    });
    const fetchedPosting = createPublicPosting({
      id: "posting-2",
      name: "Fetched",
    });
    const { batchFindPublic, cacheService, service } = createService({
      batchFindPublic: jest
        .fn()
        .mockResolvedValueOnce(createBatchResult([fetchedPosting]))
        .mockResolvedValueOnce(createBatchResult([], ["posting-3"])),
    });

    await cacheService.setJson(
      "postings:public:data:posting-1:0",
      createEnvelope(cachedPosting, {
        freshOffsetMs: 10_000,
        staleOffsetMs: 20_000,
      }),
    );

    await expect(
      service.getPublicByIds(["posting-1", "posting-2", "posting-3"]),
    ).resolves.toEqual({
      postings: [cachedPosting, fetchedPosting],
      missingIds: ["posting-3"],
    });
    expect(batchFindPublic).toHaveBeenCalledTimes(2);
  });
});
