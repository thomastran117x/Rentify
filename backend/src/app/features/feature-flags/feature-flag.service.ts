import { loggerFactory, type Logger } from "@/configuration/logging";
import { normalizeFeatureName } from "@/configuration/environment/domains/features";
import type { FeatureFlagCacheService } from "@/features/feature-flags/feature-flag-cache.service";
import type { FeatureFlagRepository } from "@/features/feature-flags/feature-flag.repository";
import type {
  DeleteFlagInput,
  DeleteFlagResult,
  ListFlagsFilter,
  ResolvedFeatureFlag,
  SetFlagInput,
} from "@/features/feature-flags/feature-flag.model";

export class FeatureFlagService {
  private readonly logger: Logger;

  constructor(
    private readonly repository: FeatureFlagRepository,
    private readonly flagCache: FeatureFlagCacheService,
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

    const cached = await this.flagCache.getFlag(name);
    if (cached !== null) {
      return cached;
    }

    const resolved = await this.resolveFromSource(name);
    await this.flagCache.setFlag(name, resolved);
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

  async listAll(filter?: ListFlagsFilter): Promise<ResolvedFeatureFlag[]> {
    const cached = await this.flagCache.getList();
    const full = cached ?? (await this.buildAndCacheList());
    return this.applyFilter(full, filter);
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
      input.group,
    );

    await this.repository.createAuditLog({
      flagName: name,
      action: existing === null ? "created" : "updated",
      oldEnabled: existing?.enabled ?? null,
      newEnabled: row.enabled,
      oldDescription: existing?.description ?? null,
      newDescription: row.description,
      oldGroup: existing?.group ?? null,
      newGroup: row.group,
      actorUserId: input.actorUserId,
    });

    await this.flagCache.invalidate(name);

    return {
      name,
      enabled: row.enabled,
      source: "db",
      description: row.description,
      group: row.group,
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
        oldGroup: existing.group,
        newGroup: null,
        actorUserId: input.actorUserId,
      });

      await this.flagCache.invalidate(name);
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
          group: row.group,
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
        group: null,
      };
    }

    return {
      name,
      enabled: false,
      source: "default",
      description: null,
      group: null,
    };
  }

  private async safeDbFind(name: string) {
    try {
      return await this.repository.findByName(name);
    } catch {
      return null;
    }
  }

  private applyFilter(
    list: ResolvedFeatureFlag[],
    filter?: ListFlagsFilter,
  ): ResolvedFeatureFlag[] {
    if (!filter) return list;

    let result = list;

    if (filter.enabled !== undefined) {
      result = result.filter((f) => f.enabled === filter.enabled);
    }

    if (filter.search) {
      const term = filter.search.toLowerCase().trim();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(term) ||
          (f.description?.toLowerCase().includes(term) ?? false),
      );
    }

    if (filter.group !== undefined) {
      result = result.filter((f) => f.group === filter.group);
    }

    return result;
  }

  private async buildAndCacheList(): Promise<ResolvedFeatureFlag[]> {
    const list = await this.buildMergedList();
    await this.flagCache.setList(list);
    return list;
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
          group: r.group,
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
        group: null,
      }));

    return [...dbMap.values(), ...envEntries].sort((a, b) => {
      const ga = a.group;
      const gb = b.group;
      if (ga !== gb) {
        if (ga === null) return 1;
        if (gb === null) return -1;
        return ga.localeCompare(gb);
      }
      return a.name.localeCompare(b.name);
    });
  }
}
