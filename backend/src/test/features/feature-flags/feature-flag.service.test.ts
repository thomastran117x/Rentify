import { FeatureFlagService } from "@/features/feature-flags/feature-flag.service";
import type { FeatureFlagRecord } from "@/features/feature-flags/feature-flag.model";

function makeRecord(overrides: Partial<FeatureFlagRecord> = {}): FeatureFlagRecord {
  return {
    id: 1,
    name: "test-flag",
    enabled: true,
    description: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createRepository(overrides: Partial<{
  findByName: jest.Mock;
  listAll: jest.Mock;
  upsert: jest.Mock;
  deleteByName: jest.Mock;
  createAuditLog: jest.Mock;
}> = {}) {
  return {
    findByName: jest.fn(async () => null),
    listAll: jest.fn(async () => []),
    upsert: jest.fn(async () => makeRecord()),
    deleteByName: jest.fn(async () => undefined),
    createAuditLog: jest.fn(async () => undefined),
    ...overrides,
  };
}

function createCacheService(overrides: Partial<{
  getJson: jest.Mock;
  setJson: jest.Mock;
  delete: jest.Mock;
}> = {}) {
  return {
    getJson: jest.fn(async () => null),
    setJson: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    ...overrides,
  };
}

function createService(
  repositoryOverrides = {},
  cacheOverrides = {},
  env: Record<string, { enabled: boolean }> = {},
) {
  return {
    repository: createRepository(repositoryOverrides),
    cacheService: createCacheService(cacheOverrides),
    service: null as unknown as FeatureFlagService,
    build() {
      this.repository = createRepository(repositoryOverrides);
      this.cacheService = createCacheService(cacheOverrides);
      this.service = new FeatureFlagService(
        this.repository as never,
        this.cacheService as never,
        env,
      );
      return this;
    },
  }.build();
}

describe("FeatureFlagService", () => {
  describe("isEnabled", () => {
    it("returns true when DB row has enabled=true", async () => {
      const { service } = createService({
        findByName: jest.fn(async () => makeRecord({ enabled: true })),
      });

      await expect(service.isEnabled("test-flag")).resolves.toBe(true);
    });

    it("returns false when DB row has enabled=false", async () => {
      const { service } = createService({
        findByName: jest.fn(async () => makeRecord({ enabled: false })),
      });

      await expect(service.isEnabled("test-flag")).resolves.toBe(false);
    });

    it("returns env value when no DB row exists", async () => {
      const { service } = createService(
        { findByName: jest.fn(async () => null) },
        {},
        { "test-flag": { enabled: true } },
      );

      await expect(service.isEnabled("test-flag")).resolves.toBe(true);
    });

    it("returns false when neither DB nor env has the flag", async () => {
      const { service } = createService();

      await expect(service.isEnabled("test-flag")).resolves.toBe(false);
    });

    it("DB false overrides env true", async () => {
      const { service } = createService(
        { findByName: jest.fn(async () => makeRecord({ enabled: false })) },
        {},
        { "test-flag": { enabled: true } },
      );

      await expect(service.isEnabled("test-flag")).resolves.toBe(false);
    });

    it("DB true overrides env false", async () => {
      const { service } = createService(
        { findByName: jest.fn(async () => makeRecord({ enabled: true })) },
        {},
        { "test-flag": { enabled: false } },
      );

      await expect(service.isEnabled("test-flag")).resolves.toBe(true);
    });
  });

  describe("resolveFlag", () => {
    it("returns source=db when row exists in DB", async () => {
      const { service } = createService({
        findByName: jest.fn(async () => makeRecord({ enabled: true })),
      });

      const result = await service.resolveFlag("test-flag");
      expect(result.source).toBe("db");
      expect(result.name).toBe("test-flag");
      expect(result.enabled).toBe(true);
    });

    it("returns source=env when no DB row but env entry exists", async () => {
      const { service } = createService(
        {},
        {},
        { "test-flag": { enabled: true } },
      );

      const result = await service.resolveFlag("test-flag");
      expect(result.source).toBe("env");
    });

    it("returns source=default when flag is unknown", async () => {
      const { service } = createService();

      const result = await service.resolveFlag("unknown-flag");
      expect(result.source).toBe("default");
      expect(result.enabled).toBe(false);
    });

    it("normalizes raw flag names before lookup", async () => {
      const findByName = jest.fn(async () => makeRecord({ name: "test-flag" }));
      const { service } = createService({ findByName });

      await service.resolveFlag("FEATURE_TEST_FLAG_ENABLED");

      expect(findByName).toHaveBeenCalledWith("test-flag");
    });

    it("returns cached Redis value without hitting DB", async () => {
      const cached = {
        name: "test-flag",
        enabled: true,
        source: "db" as const,
        description: null,
      };
      const findByName = jest.fn();
      const { service } = createService(
        { findByName },
        { getJson: jest.fn(async () => cached) },
      );

      const result = await service.resolveFlag("test-flag");
      expect(result).toEqual(cached);
      expect(findByName).not.toHaveBeenCalled();
    });

    it("returns process-memory cached value on second call without hitting Redis", async () => {
      const getJson = jest.fn(async () => null);
      const { service } = createService(
        { findByName: jest.fn(async () => makeRecord({ enabled: true })) },
        { getJson },
      );

      await service.resolveFlag("test-flag");
      await service.resolveFlag("test-flag");

      // Redis checked only once (second call hits process-memory)
      expect(getJson).toHaveBeenCalledTimes(1);
    });

    it("falls through to DB when Redis throws", async () => {
      const findByName = jest.fn(async () => makeRecord({ enabled: true }));
      const { service } = createService(
        { findByName },
        { getJson: jest.fn().mockRejectedValue(new Error("redis down")) },
      );

      const result = await service.resolveFlag("test-flag");
      expect(result.enabled).toBe(true);
      expect(findByName).toHaveBeenCalled();
    });

    it("falls back to env when DB throws", async () => {
      const { service } = createService(
        { findByName: jest.fn().mockRejectedValue(new Error("db down")) },
        {},
        { "test-flag": { enabled: true } },
      );

      const result = await service.resolveFlag("test-flag");
      expect(result.source).toBe("env");
      expect(result.enabled).toBe(true);
    });

    it("returns default when both DB and env are absent and DB throws", async () => {
      const { service } = createService({
        findByName: jest.fn().mockRejectedValue(new Error("db down")),
      });

      const result = await service.resolveFlag("test-flag");
      expect(result.source).toBe("default");
      expect(result.enabled).toBe(false);
    });

    it("continues without error when Redis write fails after DB read", async () => {
      const { service } = createService(
        { findByName: jest.fn(async () => makeRecord()) },
        { setJson: jest.fn().mockRejectedValue(new Error("redis down")) },
      );

      await expect(service.resolveFlag("test-flag")).resolves.toBeDefined();
    });
  });

  describe("getMany", () => {
    it("resolves multiple flags in bulk and returns a name→boolean map", async () => {
      const findByName = jest.fn(async (name: string) => {
        if (name === "flag-a") return makeRecord({ name: "flag-a", enabled: true });
        if (name === "flag-b") return makeRecord({ name: "flag-b", enabled: false });
        return null;
      });
      const { service } = createService({ findByName });

      const result = await service.getMany(["flag-a", "flag-b"]);
      expect(result).toEqual({ "flag-a": true, "flag-b": false });
    });
  });

  describe("listAll", () => {
    it("merges DB rows and env entries, sorted by name", async () => {
      const { service } = createService(
        {
          listAll: jest.fn(async () => [
            makeRecord({ name: "zz-flag", enabled: false }),
          ]),
        },
        {},
        { "aa-flag": { enabled: true } },
      );

      const result = await service.listAll();
      expect(result.map((r) => r.name)).toEqual(["aa-flag", "zz-flag"]);
    });

    it("DB rows take precedence over env entries with the same name", async () => {
      const { service } = createService(
        {
          listAll: jest.fn(async () => [
            makeRecord({ name: "test-flag", enabled: false }),
          ]),
        },
        {},
        { "test-flag": { enabled: true } },
      );

      const result = await service.listAll();
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe("db");
      expect(result[0].enabled).toBe(false);
    });

    it("returns Redis-cached list without hitting DB", async () => {
      const cached = [
        { name: "test-flag", enabled: true, source: "db" as const, description: null },
      ];
      const listAll = jest.fn();
      const { service } = createService(
        { listAll },
        { getJson: jest.fn(async () => cached) },
      );

      const result = await service.listAll();
      expect(result).toEqual(cached);
      expect(listAll).not.toHaveBeenCalled();
    });

    it("continues without error when DB listAll throws and returns env-only entries", async () => {
      const { service } = createService(
        { listAll: jest.fn().mockRejectedValue(new Error("db down")) },
        {},
        { "test-flag": { enabled: true } },
      );

      const result = await service.listAll();
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe("env");
    });
  });

  describe("setFlag", () => {
    it("creates a new DB row and returns source=db", async () => {
      const upsert = jest.fn(async () =>
        makeRecord({ name: "new-flag", enabled: true }),
      );
      const createAuditLog = jest.fn(async () => undefined);
      const { service } = createService({ upsert, createAuditLog });

      const result = await service.setFlag({
        name: "new-flag",
        enabled: true,
        actorUserId: "admin-1",
      });

      expect(result.source).toBe("db");
      expect(result.enabled).toBe(true);
    });

    it("writes an audit log on create with action=created", async () => {
      const createAuditLog = jest.fn(async () => undefined);
      const { service } = createService({
        findByName: jest.fn(async () => null),
        upsert: jest.fn(async () => makeRecord({ enabled: true })),
        createAuditLog,
      });

      await service.setFlag({ name: "test-flag", enabled: true, actorUserId: "admin-1" });

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "created", actorUserId: "admin-1" }),
      );
    });

    it("writes an audit log on update with action=updated", async () => {
      const createAuditLog = jest.fn(async () => undefined);
      const { service } = createService({
        findByName: jest.fn(async () => makeRecord({ enabled: false })),
        upsert: jest.fn(async () => makeRecord({ enabled: true })),
        createAuditLog,
      });

      await service.setFlag({ name: "test-flag", enabled: true, actorUserId: "admin-1" });

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "updated", oldEnabled: false, newEnabled: true }),
      );
    });

    it("invalidates process-memory and Redis after set", async () => {
      const deleteCache = jest.fn(async () => undefined);
      const { service, cacheService } = createService(
        { upsert: jest.fn(async () => makeRecord()) },
        { delete: deleteCache },
      );

      // Warm the process-memory cache first
      await service.resolveFlag("test-flag");
      await service.setFlag({ name: "test-flag", enabled: true });

      expect(deleteCache).toHaveBeenCalledWith("feature-flags:v1:test-flag");
      expect(deleteCache).toHaveBeenCalledWith("feature-flags:v1:list");
    });

    it("normalizes the flag name before writing", async () => {
      const upsert = jest.fn(async () => makeRecord({ name: "test-flag" }));
      const { service } = createService({ upsert });

      await service.setFlag({ name: "FEATURE_TEST_FLAG_ENABLED", enabled: true });

      expect(upsert).toHaveBeenCalledWith("test-flag", true, undefined, undefined, undefined);
    });
  });

  describe("deleteFlag", () => {
    it("deletes an existing DB row and writes an audit log", async () => {
      const deleteByName = jest.fn(async () => undefined);
      const createAuditLog = jest.fn(async () => undefined);
      const { service } = createService({
        findByName: jest.fn(async () => makeRecord({ enabled: true })),
        deleteByName,
        createAuditLog,
      });

      const result = await service.deleteFlag({ name: "test-flag", actorUserId: "admin-1" });

      expect(deleteByName).toHaveBeenCalledWith("test-flag");
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "deleted", oldEnabled: true, actorUserId: "admin-1" }),
      );
      expect(result.deletedOverride).toBe(true);
    });

    it("returns deletedOverride=false when no DB row existed", async () => {
      const deleteByName = jest.fn();
      const { service } = createService({
        findByName: jest.fn(async () => null),
        deleteByName,
      });

      const result = await service.deleteFlag({ name: "test-flag" });

      expect(deleteByName).not.toHaveBeenCalled();
      expect(result.deletedOverride).toBe(false);
    });

    it("returns the effective env value after deleting a DB override", async () => {
      // First call (safeDbFind) returns existing row; second (resolveFlag after delete) returns null
      const findByName = jest.fn()
        .mockResolvedValueOnce(makeRecord({ enabled: false }))
        .mockResolvedValueOnce(null);
      const { service } = createService(
        { findByName },
        {},
        { "test-flag": { enabled: true } },
      );

      const result = await service.deleteFlag({ name: "test-flag" });

      expect(result.effectiveEnabled).toBe(true);
      expect(result.effectiveSource).toBe("env");
    });

    it("returns effectiveSource=default after deleting with no env fallback", async () => {
      // First call (safeDbFind) returns existing row; second (resolveFlag after delete) returns null
      const findByName = jest.fn()
        .mockResolvedValueOnce(makeRecord({ enabled: true }))
        .mockResolvedValueOnce(null);
      const { service } = createService({ findByName });

      const result = await service.deleteFlag({ name: "test-flag" });

      expect(result.effectiveEnabled).toBe(false);
      expect(result.effectiveSource).toBe("default");
    });

    it("invalidates cache after deletion", async () => {
      const deleteCache = jest.fn(async () => undefined);
      const { service } = createService(
        { findByName: jest.fn(async () => makeRecord()) },
        { delete: deleteCache },
      );

      await service.deleteFlag({ name: "test-flag" });

      expect(deleteCache).toHaveBeenCalledWith("feature-flags:v1:test-flag");
    });

    it("continues without error when Redis invalidation throws during delete", async () => {
      const { service } = createService(
        { findByName: jest.fn(async () => makeRecord()) },
        { delete: jest.fn().mockRejectedValue(new Error("redis down")) },
      );

      await expect(service.deleteFlag({ name: "test-flag" })).resolves.toBeDefined();
    });
  });
});
