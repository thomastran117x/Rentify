import { FeatureFlagCacheService } from "@/features/feature-flags/feature-flag-cache.service";
import type { ResolvedFeatureFlag } from "@/features/feature-flags/feature-flag.model";

function createCacheService(
  overrides: Partial<{
    get: jest.Mock;
    getJson: jest.Mock;
    setJson: jest.Mock;
    delete: jest.Mock;
  }> = {},
) {
  return {
    get: jest.fn(async () => null),
    getJson: jest.fn(async () => null),
    setJson: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    ...overrides,
  };
}

const flag = (name: string, enabled: boolean): ResolvedFeatureFlag => ({
  name,
  enabled,
  source: "db",
  description: null,
  group: null,
});

describe("FeatureFlagCacheService", () => {
  describe("getFlag", () => {
    it("returns a cached flag when present", async () => {
      const cached = flag("test-flag", true);
      const service = new FeatureFlagCacheService(
        createCacheService({ getJson: jest.fn(async () => cached) }) as any,
      );

      await expect(service.getFlag("test-flag")).resolves.toEqual(cached);
    });

    it("returns null on a cache miss", async () => {
      const service = new FeatureFlagCacheService(
        createCacheService({ getJson: jest.fn(async () => null) }) as any,
      );

      await expect(service.getFlag("test-flag")).resolves.toBeNull();
    });

    it("returns null and does not throw when Redis errors", async () => {
      const service = new FeatureFlagCacheService(
        createCacheService({
          getJson: jest.fn().mockRejectedValue(new Error("connection refused")),
        }) as any,
      );

      await expect(service.getFlag("test-flag")).resolves.toBeNull();
    });

    it("reads from the versioned key", async () => {
      const getJson = jest.fn(async () => null);
      const service = new FeatureFlagCacheService(
        createCacheService({ getJson }) as any,
      );

      await service.getFlag("my-flag");

      expect(getJson).toHaveBeenCalledWith("feature-flags:v1:my-flag");
    });
  });

  describe("setFlag", () => {
    it("writes the flag to Redis with the TTL", async () => {
      const setJson = jest.fn(async () => undefined);
      const service = new FeatureFlagCacheService(
        createCacheService({ setJson }) as any,
      );

      await service.setFlag("test-flag", flag("test-flag", true));

      expect(setJson).toHaveBeenCalledWith(
        "feature-flags:v1:test-flag",
        flag("test-flag", true),
        60,
      );
    });

    it("does not throw when Redis errors", async () => {
      const service = new FeatureFlagCacheService(
        createCacheService({
          setJson: jest.fn().mockRejectedValue(new Error("redis down")),
        }) as any,
      );

      await expect(
        service.setFlag("test-flag", flag("test-flag", true)),
      ).resolves.toBeUndefined();
    });
  });

  describe("getList", () => {
    it("returns a cached list when present", async () => {
      const cached = [flag("test-flag", true)];
      const service = new FeatureFlagCacheService(
        createCacheService({ getJson: jest.fn(async () => cached) }) as any,
      );

      await expect(service.getList()).resolves.toEqual(cached);
    });

    it("returns null on a cache miss", async () => {
      const service = new FeatureFlagCacheService(createCacheService() as any);

      await expect(service.getList()).resolves.toBeNull();
    });

    it("returns null and does not throw when Redis errors", async () => {
      const service = new FeatureFlagCacheService(
        createCacheService({
          getJson: jest.fn().mockRejectedValue(new Error("redis down")),
        }) as any,
      );

      await expect(service.getList()).resolves.toBeNull();
    });

    it("reads from the list key", async () => {
      const getJson = jest.fn(async () => null);
      const service = new FeatureFlagCacheService(
        createCacheService({ getJson }) as any,
      );

      await service.getList();

      expect(getJson).toHaveBeenCalledWith("feature-flags:v1:list");
    });
  });

  describe("setList", () => {
    it("writes the list to Redis with the TTL", async () => {
      const setJson = jest.fn(async () => undefined);
      const service = new FeatureFlagCacheService(
        createCacheService({ setJson }) as any,
      );
      const list = [flag("test-flag", true)];

      await service.setList(list);

      expect(setJson).toHaveBeenCalledWith("feature-flags:v1:list", list, 60);
    });

    it("does not throw when Redis errors", async () => {
      const service = new FeatureFlagCacheService(
        createCacheService({
          setJson: jest.fn().mockRejectedValue(new Error("redis down")),
        }) as any,
      );

      await expect(service.setList([])).resolves.toBeUndefined();
    });
  });

  describe("invalidate", () => {
    it("deletes both the flag key and the list key", async () => {
      const del = jest.fn(async () => undefined);
      const service = new FeatureFlagCacheService(
        createCacheService({ delete: del }) as any,
      );

      await service.invalidate("test-flag");

      expect(del).toHaveBeenCalledWith("feature-flags:v1:test-flag");
      expect(del).toHaveBeenCalledWith("feature-flags:v1:list");
    });

    it("does not throw when Redis errors during invalidation", async () => {
      const service = new FeatureFlagCacheService(
        createCacheService({
          delete: jest.fn().mockRejectedValue(new Error("redis down")),
        }) as any,
      );

      await expect(service.invalidate("test-flag")).resolves.toBeUndefined();
    });
  });
});
