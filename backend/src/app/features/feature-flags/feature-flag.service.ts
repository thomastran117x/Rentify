import { loggerFactory, type Logger } from "@/configuration/logging";
import { normalizeFeatureName } from "@/configuration/environment/domains/features";
import type { CacheService } from "@/features/cache/cache.service";
import type { FeatureFlagRepository } from "@/features/feature-flags/feature-flag.repository";
import type {
  DeleteFlagInput,
  DeleteFlagResult,
  ResolvedFeatureFlag,
  SetFlagInput,
} from "@/features/feature-flags/feature-flag.model";

const REDIS_FLAG_KEY = (name: string) => `feature-flags:v1:${name}`;
const REDIS_LIST_KEY = "feature-flags:v1:list";
const REDIS_TTL_SECONDS = 60;
const MEMORY_TTL_MS = 5_000;

interface MemoryCacheEntry {
  value: ResolvedFeatureFlag;
  expiresAt: number;
}

export class FeatureFlagService {
  private readonly logger: Logger;
  private readonly memoryCache = new Map<string, MemoryCacheEntry>();

  constructor(
    private readonly repository: FeatureFlagRepository,
    private readonly cacheService: CacheService,
    private readonly envFeatures: Record<string, { enabled: boolean }>,
  ) {
    this.logger = loggerFactory.forClass("FeatureFlagService", "service");
  }

  async isEnabled(rawName: string): Promise<boolean> {
    const resolved = await this.resolveFlag(rawName);
    return resolved.enabled;
  }

  async resolveFlag(rawName: string): Promise<ResolvedFeatureFlag> {
    const name = normalizeFeatureName(rawName);

    const memHit = this.memoryCache.get(name);
    if (memHit && Date.now() < memHit.expiresAt) {
      return memHit.value;
    }

    let resolved: ResolvedFeatureFlag | null = null;

    try {
      resolved = await this.cacheService.getJson<ResolvedFeatureFlag>(
        REDIS_FLAG_KEY(name),
      );
    } catch (error) {
      this.logger.warn(
        "Feature flag Redis read failed, falling through to DB.",
        { name },
        error,
      );
    }

    if (resolved === null) {
      resolved = await this.resolveFromSource(name);

      try {
        await this.cacheService.setJson(
          REDIS_FLAG_KEY(name),
          resolved,
          REDIS_TTL_SECONDS,
        );
      } catch {
        // Redis down — continue without warming the cache
      }
    }

    this.memoryCache.set(name, {
      value: resolved,
      expiresAt: Date.now() + MEMORY_TTL_MS,
    });

    return resolved;
  }

  async getMany(rawNames: string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    await Promise.all(
      rawNames.map(async (raw) => {
        const flag = await this.resolveFlag(raw);
        result[flag.name] = flag.enabled;
      }),
    );
    return result;
  }

  async listAll(): Promise<ResolvedFeatureFlag[]> {
    let cached: ResolvedFeatureFlag[] | null = null;
    try {
      cached =
        await this.cacheService.getJson<ResolvedFeatureFlag[]>(REDIS_LIST_KEY);
    } catch {
      // Redis down — proceed to DB
    }

    if (cached !== null) {
      return cached;
    }

    const list = await this.buildMergedList();

    try {
      await this.cacheService.setJson(REDIS_LIST_KEY, list, REDIS_TTL_SECONDS);
    } catch {
      // Redis down — continue without caching
    }

    return list;
  }

  async setFlag(input: SetFlagInput): Promise<ResolvedFeatureFlag> {
    const name = normalizeFeatureName(input.name);
    const existing = await this.safeDbFind(name);

    const row = await this.repository.upsert(
      name,
      input.enabled,
      input.description,
      existing === null ? input.actorUserId : undefined,
      input.actorUserId,
    );

    await this.repository.createAuditLog({
      flagName: name,
      action: existing === null ? "created" : "updated",
      oldEnabled: existing?.enabled ?? null,
      newEnabled: row.enabled,
      oldDescription: existing?.description ?? null,
      newDescription: row.description,
      actorUserId: input.actorUserId,
    });

    await this.invalidateCache(name);

    return {
      name,
      enabled: row.enabled,
      source: "db",
      description: row.description,
    };
  }

  async deleteFlag(input: DeleteFlagInput): Promise<DeleteFlagResult> {
    const name = normalizeFeatureName(input.name);
    const existing = await this.safeDbFind(name);

    if (existing !== null) {
      await this.repository.deleteByName(name);

      await this.repository.createAuditLog({
        flagName: name,
        action: "deleted",
        oldEnabled: existing.enabled,
        newEnabled: null,
        oldDescription: existing.description,
        newDescription: null,
        actorUserId: input.actorUserId,
      });

      await this.invalidateCache(name);
    }

    const effective = await this.resolveFlag(name);

    return {
      name,
      deletedOverride: existing !== null,
      effectiveEnabled: effective.enabled,
      effectiveSource: effective.source,
    };
  }

  private async resolveFromSource(name: string): Promise<ResolvedFeatureFlag> {
    try {
      const row = await this.repository.findByName(name);
      if (row !== null) {
        return {
          name,
          enabled: row.enabled,
          source: "db",
          description: row.description,
        };
      }
    } catch (error) {
      this.logger.error(
        "Feature flag DB read failed, falling back to env/default.",
        { name },
        error,
      );
    }

    const envEntry = this.envFeatures[name];
    if (envEntry !== undefined) {
      return {
        name,
        enabled: envEntry.enabled,
        source: "env",
        description: null,
      };
    }

    return { name, enabled: false, source: "default", description: null };
  }

  private async safeDbFind(name: string) {
    try {
      return await this.repository.findByName(name);
    } catch {
      return null;
    }
  }

  private async buildMergedList(): Promise<ResolvedFeatureFlag[]> {
    let dbRows: Awaited<ReturnType<FeatureFlagRepository["listAll"]>> = [];
    try {
      dbRows = await this.repository.listAll();
    } catch (error) {
      this.logger.error("Feature flag DB listAll failed.", undefined, error);
    }

    const dbMap = new Map(
      dbRows.map((r) => [
        r.name,
        {
          name: r.name,
          enabled: r.enabled,
          source: "db" as const,
          description: r.description,
        },
      ]),
    );

    const envEntries: ResolvedFeatureFlag[] = Object.entries(this.envFeatures)
      .filter(([name]) => !dbMap.has(name))
      .map(([name, { enabled }]) => ({
        name,
        enabled,
        source: "env" as const,
        description: null,
      }));

    return [...dbMap.values(), ...envEntries].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  private async invalidateCache(name: string): Promise<void> {
    this.memoryCache.delete(name);

    try {
      await Promise.all([
        this.cacheService.delete(REDIS_FLAG_KEY(name)),
        this.cacheService.delete(REDIS_LIST_KEY),
      ]);
    } catch {
      // Redis down — process-memory was already cleared; 5s TTL bounds any staleness
    }
  }
}
