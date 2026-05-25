import type { CacheService } from "@/features/cache/cache.service";

export interface ReadThroughCachePolicy {
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  rebuildLockTtlMs: number;
  followerWaitTimeoutMs: number;
  followerPollIntervalMs: number;
  negativeTtlSeconds: number;
  ttlJitterRatio: number;
}

export interface ReadThroughCacheEnvelope<T> {
  kind: "hit" | "miss";
  value?: T;
  freshUntil: string;
  staleUntil: string;
  cachedAt: string;
}

type PendingLoadMode = "rebuild" | "refresh";

interface ReadThroughSwrCacheServiceOptions {
  onBackgroundRefreshError?: (context: {
    namespace: string;
    key: string;
    error: unknown;
  }) => void;
}

export class ReadThroughSwrCacheService {
  private readonly pendingLoads = new Map<
    string,
    Promise<ReadThroughCacheEnvelope<unknown>>
  >();
  private readonly onBackgroundRefreshError?: ReadThroughSwrCacheServiceOptions["onBackgroundRefreshError"];

  constructor(
    private readonly cacheService: Pick<
      CacheService,
      "acquireLock" | "get" | "getJson" | "increment" | "setJson"
    >,
    private readonly random: () => number = Math.random,
    options?: ReadThroughSwrCacheServiceOptions,
  ) {
    this.onBackgroundRefreshError = options?.onBackgroundRefreshError;
  }

  async get<T>(
    namespace: string,
    key: string,
    loader: () => Promise<T | null>,
    policy: ReadThroughCachePolicy,
  ): Promise<T | null> {
    const normalizedKey = this.normalizeKey(key);

    if (!normalizedKey) {
      return null;
    }

    const normalizedNamespace = this.normalizeNamespace(namespace);
    const generation = await this.readGeneration(
      normalizedNamespace,
      normalizedKey,
    );
    const entry = await this.readEntry<T>(
      normalizedNamespace,
      normalizedKey,
      generation,
    );
    const now = Date.now();

    if (entry) {
      if (Date.parse(entry.freshUntil) > now) {
        return this.toValue(entry);
      }

      if (Date.parse(entry.staleUntil) > now) {
        this.refreshInBackground(
          normalizedNamespace,
          normalizedKey,
          generation,
          loader,
          policy,
        );
        return this.toValue(entry);
      }
    }

    return this.rebuildWithSingleFlight(
      normalizedNamespace,
      normalizedKey,
      loader,
      policy,
    );
  }

  async invalidate(namespace: string, key: string): Promise<number> {
    const normalizedKey = this.normalizeKey(key);

    if (!normalizedKey) {
      return 0;
    }

    return this.cacheService.increment(
      this.getGenerationKey(this.normalizeNamespace(namespace), normalizedKey),
    );
  }

  private refreshInBackground<T>(
    namespace: string,
    key: string,
    expectedGeneration: number,
    loader: () => Promise<T | null>,
    policy: ReadThroughCachePolicy,
  ): void {
    void this.refreshIfLeader(
      namespace,
      key,
      expectedGeneration,
      loader,
      policy,
    ).catch((error) => {
      this.onBackgroundRefreshError?.({
        namespace,
        key,
        error,
      });
    });
  }

  private async refreshIfLeader<T>(
    namespace: string,
    key: string,
    expectedGeneration: number,
    loader: () => Promise<T | null>,
    policy: ReadThroughCachePolicy,
  ): Promise<void> {
    if (
      this.findPendingPromise<T>(namespace, key, expectedGeneration, [
        "refresh",
        "rebuild",
      ])
    ) {
      return;
    }

    const lock = await this.cacheService.acquireLock(
      this.getRebuildLockKey(namespace, key),
      policy.rebuildLockTtlMs,
    );

    if (!lock) {
      return;
    }

    try {
      const lockedGeneration = await this.readGeneration(namespace, key);

      if (lockedGeneration !== expectedGeneration) {
        return;
      }

      const entry = await this.readEntry<T>(namespace, key, expectedGeneration);

      if (entry && Date.parse(entry.freshUntil) > Date.now()) {
        return;
      }

      await this.withPendingLoad(
        namespace,
        key,
        expectedGeneration,
        "refresh",
        () =>
          this.fetchAndCacheValue(
            namespace,
            key,
            expectedGeneration,
            loader,
            policy,
          ),
      );
    } finally {
      await lock.release();
    }
  }

  private async rebuildWithSingleFlight<T>(
    namespace: string,
    key: string,
    loader: () => Promise<T | null>,
    policy: ReadThroughCachePolicy,
  ): Promise<T | null> {
    const initialGeneration = await this.readGeneration(namespace, key);
    const localPending = this.findPendingPromise<T>(
      namespace,
      key,
      initialGeneration,
      ["rebuild", "refresh"],
    );

    if (localPending) {
      return this.toValue(await localPending);
    }

    const lock = await this.cacheService.acquireLock(
      this.getRebuildLockKey(namespace, key),
      policy.rebuildLockTtlMs,
    );

    if (lock) {
      try {
        const lockedGeneration = await this.readGeneration(namespace, key);
        const entry = await this.readEntry<T>(namespace, key, lockedGeneration);

        if (entry && Date.parse(entry.freshUntil) > Date.now()) {
          return this.toValue(entry);
        }

        const rebuilt = await this.withPendingLoad(
          namespace,
          key,
          lockedGeneration,
          "rebuild",
          () =>
            this.fetchAndCacheValue(
              namespace,
              key,
              lockedGeneration,
              loader,
              policy,
            ),
        );

        return this.toValue(rebuilt);
      } finally {
        await lock.release();
      }
    }

    const pendingAfterLockMiss = this.findPendingPromise<T>(
      namespace,
      key,
      initialGeneration,
      ["rebuild", "refresh"],
    );

    if (pendingAfterLockMiss) {
      return this.toValue(await pendingAfterLockMiss);
    }

    const deadline = Date.now() + policy.followerWaitTimeoutMs;

    while (Date.now() < deadline) {
      await this.sleep(policy.followerPollIntervalMs);

      const generation = await this.readGeneration(namespace, key);
      const pending = this.findPendingPromise<T>(namespace, key, generation, [
        "rebuild",
        "refresh",
      ]);

      if (pending) {
        return this.toValue(await pending);
      }

      const entry = await this.readEntry<T>(namespace, key, generation);

      if (!entry) {
        continue;
      }

      if (
        Date.parse(entry.freshUntil) > Date.now() ||
        Date.parse(entry.staleUntil) > Date.now()
      ) {
        return this.toValue(entry);
      }
    }

    const timedOutGeneration = await this.readGeneration(namespace, key);
    const rebuilt = await this.withPendingLoad(
      namespace,
      key,
      timedOutGeneration,
      "rebuild",
      () => this.loadDirectAndCacheIfMissing(namespace, key, loader, policy),
    );

    return this.toValue(rebuilt);
  }

  private async fetchAndCacheValue<T>(
    namespace: string,
    key: string,
    generation: number,
    loader: () => Promise<T | null>,
    policy: ReadThroughCachePolicy,
  ): Promise<ReadThroughCacheEnvelope<T>> {
    const value = await loader();
    return this.writeEntry(namespace, key, generation, value, policy);
  }

  private async loadDirectAndCacheIfMissing<T>(
    namespace: string,
    key: string,
    loader: () => Promise<T | null>,
    policy: ReadThroughCachePolicy,
  ): Promise<ReadThroughCacheEnvelope<T>> {
    const value = await loader();
    const generation = await this.readGeneration(namespace, key);
    const entry = await this.readEntry<T>(namespace, key, generation);

    if (entry) {
      return entry;
    }

    return this.writeEntry(namespace, key, generation, value, policy);
  }

  private async withPendingLoad<T>(
    namespace: string,
    key: string,
    generation: number,
    mode: PendingLoadMode,
    factory: () => Promise<ReadThroughCacheEnvelope<T>>,
  ): Promise<ReadThroughCacheEnvelope<T>> {
    const pendingKey = this.getPendingLoadKey(namespace, key, generation, mode);
    const existing = this.pendingLoads.get(pendingKey) as
      | Promise<ReadThroughCacheEnvelope<T>>
      | undefined;

    if (existing) {
      return existing;
    }

    const promise = Promise.resolve().then(factory);
    this.pendingLoads.set(
      pendingKey,
      promise as Promise<ReadThroughCacheEnvelope<unknown>>,
    );

    try {
      return await promise;
    } finally {
      if (this.pendingLoads.get(pendingKey) === promise) {
        this.pendingLoads.delete(pendingKey);
      }
    }
  }

  private findPendingPromise<T>(
    namespace: string,
    key: string,
    generation: number,
    modes: PendingLoadMode[],
  ): Promise<ReadThroughCacheEnvelope<T>> | null {
    for (const mode of modes) {
      const pending = this.pendingLoads.get(
        this.getPendingLoadKey(namespace, key, generation, mode),
      );

      if (pending) {
        return pending as Promise<ReadThroughCacheEnvelope<T>>;
      }
    }

    return null;
  }

  private async writeEntry<T>(
    namespace: string,
    key: string,
    generation: number,
    value: T | null,
    policy: ReadThroughCachePolicy,
  ): Promise<ReadThroughCacheEnvelope<T>> {
    const now = Date.now();
    const ttlFactor =
      value === null ? 1 : this.getTtlFactor(policy.ttlJitterRatio);
    const freshTtlMs =
      value === null
        ? policy.negativeTtlSeconds * 1000
        : Math.max(1, Math.round(policy.freshTtlSeconds * 1000 * ttlFactor));
    const staleTtlMs =
      value === null
        ? policy.negativeTtlSeconds * 1000
        : Math.max(
            freshTtlMs,
            Math.round(policy.staleTtlSeconds * 1000 * ttlFactor),
          );
    const envelope: ReadThroughCacheEnvelope<T> = {
      kind: value === null ? "miss" : "hit",
      ...(value === null ? {} : { value }),
      freshUntil: new Date(now + freshTtlMs).toISOString(),
      staleUntil: new Date(now + staleTtlMs).toISOString(),
      cachedAt: new Date(now).toISOString(),
    };

    await this.cacheService.setJson(
      this.getDataKey(namespace, key, generation),
      envelope,
      Math.max(1, Math.ceil(staleTtlMs / 1000)),
    );

    return envelope;
  }

  private async readGeneration(
    namespace: string,
    key: string,
  ): Promise<number> {
    const raw = await this.cacheService.get(
      this.getGenerationKey(namespace, key),
    );

    if (!raw) {
      return 0;
    }

    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  private async readEntry<T>(
    namespace: string,
    key: string,
    generation: number,
  ): Promise<ReadThroughCacheEnvelope<T> | null> {
    return this.cacheService.getJson<ReadThroughCacheEnvelope<T>>(
      this.getDataKey(namespace, key, generation),
    );
  }

  private toValue<T>(entry: ReadThroughCacheEnvelope<T>): T | null {
    return entry.kind === "hit" ? (entry.value ?? null) : null;
  }

  private getTtlFactor(ttlJitterRatio: number): number {
    if (ttlJitterRatio <= 0) {
      return 1;
    }

    const boundedRandom = Math.min(1, Math.max(0, this.random()));
    return 1 - ttlJitterRatio + boundedRandom * (ttlJitterRatio * 2);
  }

  private getGenerationKey(namespace: string, key: string): string {
    return `${namespace}:gen:${key}`;
  }

  private getDataKey(
    namespace: string,
    key: string,
    generation: number,
  ): string {
    return `${namespace}:data:${key}:${generation}`;
  }

  private getRebuildLockKey(namespace: string, key: string): string {
    return `${namespace}:rebuild:${key}`;
  }

  private getPendingLoadKey(
    namespace: string,
    key: string,
    generation: number,
    mode: PendingLoadMode,
  ): string {
    return `${namespace}:${key}:${generation}:${mode}`;
  }

  private normalizeNamespace(namespace: string): string {
    const normalizedNamespace = namespace.trim();

    if (!normalizedNamespace) {
      throw new Error("Cache namespace must not be empty.");
    }

    return normalizedNamespace;
  }

  private normalizeKey(key: string): string {
    return key.trim();
  }

  private async sleep(durationMs: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    });
  }
}
