import { loggerFactory, type Logger } from "@/configuration/logging";
import type { CacheService } from "@/features/cache/cache.service";
import type { ResolvedFeatureFlag } from "@/features/feature-flags/feature-flag.model";

const FLAG_KEY = (name: string) => `feature-flags:v1:${name}`;
const LIST_KEY = "feature-flags:v1:list";
const TTL_SECONDS = 60;

export class FeatureFlagCacheService {
  private readonly logger: Logger;

  constructor(private readonly cacheService: CacheService) {
    this.logger = loggerFactory.forClass("FeatureFlagCacheService", "service");
  }

  async getFlag(name: string): Promise<ResolvedFeatureFlag | null> {
    try {
      return await this.cacheService.getJson<ResolvedFeatureFlag>(
        FLAG_KEY(name),
      );
    } catch (error) {
      this.logger.warn("Feature flag Redis read failed.", { name }, error);
      return null;
    }
  }

  async setFlag(name: string, flag: ResolvedFeatureFlag): Promise<void> {
    try {
      await this.cacheService.setJson(FLAG_KEY(name), flag, TTL_SECONDS);
    } catch {
      // Redis down — caller proceeds without a warm cache
    }
  }

  async getList(): Promise<ResolvedFeatureFlag[] | null> {
    try {
      return await this.cacheService.getJson<ResolvedFeatureFlag[]>(LIST_KEY);
    } catch (error) {
      this.logger.warn(
        "Feature flag list Redis read failed.",
        undefined,
        error,
      );
      return null;
    }
  }

  async setList(flags: ResolvedFeatureFlag[]): Promise<void> {
    try {
      await this.cacheService.setJson(LIST_KEY, flags, TTL_SECONDS);
    } catch {
      // Redis down — caller proceeds without a warm cache
    }
  }

  async invalidate(name: string): Promise<void> {
    try {
      await Promise.all([
        this.cacheService.delete(FLAG_KEY(name)),
        this.cacheService.delete(LIST_KEY),
      ]);
    } catch {
      // Redis down — TTL will expire the stale entries naturally
    }
  }
}
