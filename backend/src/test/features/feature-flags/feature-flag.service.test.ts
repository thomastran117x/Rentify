import { FeatureFlagService } from "@/features/feature-flags/feature-flag.service";
import type { FeatureFlagRecord } from "@/features/feature-flags/feature-flag.model";

function makeRecord(
  overrides: Partial<FeatureFlagRecord> = {},
): FeatureFlagRecord {
  return {
    id: 1,
    name: "test-flag",
    enabled: true,
    description: null,
    group: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createRepository(
  overrides: Partial<{
    findByName: jest.Mock;
    listAll: jest.Mock;
    upsert: jest.Mock;
    deleteByName: jest.Mock;
    createAuditLog: jest.Mock;
  }> = {},
) {
  return {
    findByName: jest.fn(async () => null),
    listAll: jest.fn(async () => []),
    upsert: jest.fn(async () => makeRecord()),
    deleteByName: jest.fn(async () => undefined),
    createAuditLog: jest.fn(async () => undefined),
    ...overrides,
  };
}

function createFlagCache(
  overrides: Partial<{
    getFlag: jest.Mock;
    setFlag: jest.Mock;
    getList: jest.Mock;
    setList: jest.Mock;
    invalidate: jest.Mock;
  }> = {},
) {
  return {
    getFlag: jest.fn(async () => null),
    setFlag: jest.fn(async () => undefined),
    getList: jest.fn(async () => null),
    setList: jest.fn(async () => undefined),
    invalidate: jest.fn(async () => undefined),
    ...overrides,
  };
}

function createService(
  repositoryOverrides: Parameters<typeof createRepository>[0] = {},
  cacheOverrides: Parameters<typeof createFlagCache>[0] = {},
  env: Record<string, { enabled: boolean }> = {},
) {
  const repository = createRepository(repositoryOverrides);
  const flagCache = createFlagCache(cacheOverrides);
  const service = new FeatureFlagService(
    repository as never,
    flagCache as never,
    env,
  );
  return { repository, flagCache, service };
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
        {},
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

    it("returns cached value without hitting DB", async () => {
      const cached = {
        name: "test-flag",
        enabled: true,
        source: "db" as const,
        description: null,
        group: null,
      };
      const findByName = jest.fn();
      const { service } = createService(
        { findByName },
        { getFlag: jest.fn(async () => cached) },
      );

      const result = await service.resolveFlag("test-flag");
      expect(result).toEqual(cached);
      expect(findByName).not.toHaveBeenCalled();
    });

    it("warms the cache after a DB hit", async () => {
      const setFlag = jest.fn(async () => undefined);
      const { service } = createService(
        { findByName: jest.fn(async () => makeRecord({ enabled: true })) },
        { setFlag },
      );

      await service.resolveFlag("test-flag");

      expect(setFlag).toHaveBeenCalledWith(
        "test-flag",
        expect.objectContaining({ enabled: true, source: "db" }),
      );
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
  });

  describe("getMany", () => {
    it("resolves multiple flags in bulk and returns a name→boolean map", async () => {
      const findByName = jest.fn(async (name: string) => {
        if (name === "flag-a")
          return makeRecord({ name: "flag-a", enabled: true });
        if (name === "flag-b")
          return makeRecord({ name: "flag-b", enabled: false });
        return null;
      });
      const { service } = createService({ findByName });

      const result = await service.getMany(["flag-a", "flag-b"]);
      expect(result).toEqual({ "flag-a": true, "flag-b": false });
    });
  });

  describe("listAll", () => {
    it("merges DB rows and env entries; ungrouped sorted by name, grouped first", async () => {
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

    it("sorts grouped flags before ungrouped, then alphabetically within each group", async () => {
      const { service } = createService({
        listAll: jest.fn(async () => [
          makeRecord({ name: "ungrouped-b", group: null }),
          makeRecord({ name: "payments-flag", group: "payments" }),
          makeRecord({ name: "ungrouped-a", group: null }),
          makeRecord({ name: "auth-flag", group: "auth" }),
          makeRecord({ name: "payments-v2", group: "payments" }),
        ]),
      });

      const result = await service.listAll();
      expect(result.map((r) => r.name)).toEqual([
        "auth-flag",
        "payments-flag",
        "payments-v2",
        "ungrouped-a",
        "ungrouped-b",
      ]);
    });

    it("filters by group", async () => {
      const { service } = createService({
        listAll: jest.fn(async () => [
          makeRecord({ name: "payments-flag", group: "payments" }),
          makeRecord({ name: "auth-flag", group: "auth" }),
          makeRecord({ name: "ungrouped", group: null }),
        ]),
      });

      const result = await service.listAll({ group: "payments" });
      expect(result.map((r) => r.name)).toEqual(["payments-flag"]);
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

    it("returns cached list without hitting DB", async () => {
      const cached = [
        {
          name: "test-flag",
          enabled: true,
          source: "db" as const,
          description: null,
          group: null,
        },
      ];
      const listAll = jest.fn();
      const { service } = createService(
        { listAll },
        { getList: jest.fn(async () => cached) },
      );

      const result = await service.listAll();
      expect(result).toEqual(cached);
      expect(listAll).not.toHaveBeenCalled();
    });

    it("warms the list cache after a DB read", async () => {
      const setList = jest.fn(async () => undefined);
      const { service } = createService(
        { listAll: jest.fn(async () => [makeRecord({ name: "test-flag" })]) },
        { setList },
      );

      await service.listAll();

      expect(setList).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "test-flag" }),
        ]),
      );
    });

    it("filters by enabled=true", async () => {
      const { service } = createService({
        listAll: jest.fn(async () => [
          makeRecord({ name: "on-flag", enabled: true }),
          makeRecord({ name: "off-flag", enabled: false }),
        ]),
      });

      const result = await service.listAll({ enabled: true });
      expect(result.map((r) => r.name)).toEqual(["on-flag"]);
    });

    it("filters by enabled=false", async () => {
      const { service } = createService({
        listAll: jest.fn(async () => [
          makeRecord({ name: "on-flag", enabled: true }),
          makeRecord({ name: "off-flag", enabled: false }),
        ]),
      });

      const result = await service.listAll({ enabled: false });
      expect(result.map((r) => r.name)).toEqual(["off-flag"]);
    });

    it("filters by search term matching name", async () => {
      const { service } = createService({
        listAll: jest.fn(async () => [
          makeRecord({ name: "payments-v2", enabled: true }),
          makeRecord({ name: "search-ui", enabled: true }),
        ]),
      });

      const result = await service.listAll({ search: "pay" });
      expect(result.map((r) => r.name)).toEqual(["payments-v2"]);
    });

    it("filters by search term matching description", async () => {
      const { service } = createService({
        listAll: jest.fn(async () => [
          makeRecord({
            name: "flag-a",
            enabled: true,
            description: "enable new checkout flow",
          }),
          makeRecord({ name: "flag-b", enabled: true, description: null }),
        ]),
      });

      const result = await service.listAll({ search: "checkout" });
      expect(result.map((r) => r.name)).toEqual(["flag-a"]);
    });

    it("search is case-insensitive", async () => {
      const { service } = createService({
        listAll: jest.fn(async () => [
          makeRecord({ name: "Payments-Flag", enabled: true }),
        ]),
      });

      const result = await service.listAll({ search: "PAYMENTS" });
      expect(result).toHaveLength(1);
    });

    it("combines enabled and search filters", async () => {
      const { service } = createService({
        listAll: jest.fn(async () => [
          makeRecord({ name: "payments-on", enabled: true }),
          makeRecord({ name: "payments-off", enabled: false }),
          makeRecord({ name: "search-on", enabled: true }),
        ]),
      });

      const result = await service.listAll({
        enabled: true,
        search: "payments",
      });
      expect(result.map((r) => r.name)).toEqual(["payments-on"]);
    });

    it("returns env-only entries when DB listAll throws", async () => {
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
      const { service } = createService({ upsert });

      const result = await service.setFlag({
        name: "new-flag",
        enabled: true,
        actorUserId: "admin-1",
      });

      expect(result.source).toBe("db");
      expect(result.enabled).toBe(true);
    });

    it("writes an audit log with action=created for new flags", async () => {
      const createAuditLog = jest.fn(async () => undefined);
      const { service } = createService({
        findByName: jest.fn(async () => null),
        upsert: jest.fn(async () => makeRecord({ enabled: true })),
        createAuditLog,
      });

      await service.setFlag({
        name: "test-flag",
        enabled: true,
        actorUserId: "admin-1",
      });

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "created", actorUserId: "admin-1" }),
      );
    });

    it("writes an audit log with action=updated and old/new values", async () => {
      const createAuditLog = jest.fn(async () => undefined);
      const { service } = createService({
        findByName: jest.fn(async () => makeRecord({ enabled: false })),
        upsert: jest.fn(async () => makeRecord({ enabled: true })),
        createAuditLog,
      });

      await service.setFlag({
        name: "test-flag",
        enabled: true,
        actorUserId: "admin-1",
      });

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "updated",
          oldEnabled: false,
          newEnabled: true,
        }),
      );
    });

    it("invalidates the cache after write", async () => {
      const invalidate = jest.fn(async () => undefined);
      const { service } = createService(
        { upsert: jest.fn(async () => makeRecord()) },
        { invalidate },
      );

      await service.setFlag({ name: "test-flag", enabled: true });

      expect(invalidate).toHaveBeenCalledWith("test-flag");
    });

    it("normalizes the flag name before writing", async () => {
      const upsert = jest.fn(async () => makeRecord({ name: "test-flag" }));
      const { service } = createService({ upsert });

      await service.setFlag({
        name: "FEATURE_TEST_FLAG_ENABLED",
        enabled: true,
      });

      expect(upsert).toHaveBeenCalledWith(
        "test-flag",
        true,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it("persists the group and returns it on the resolved flag", async () => {
      const upsert = jest.fn(async () =>
        makeRecord({ name: "payments-flag", group: "payments" }),
      );
      const { service } = createService({ upsert });

      const result = await service.setFlag({
        name: "payments-flag",
        enabled: true,
        group: "payments",
      });

      expect(result.group).toBe("payments");
      expect(upsert).toHaveBeenCalledWith(
        "payments-flag",
        true,
        undefined,
        undefined,
        undefined,
        "payments",
      );
    });

    it("includes group change in the audit log", async () => {
      const createAuditLog = jest.fn(async () => undefined);
      const { service } = createService({
        findByName: jest.fn(async () => makeRecord({ group: null })),
        upsert: jest.fn(async () => makeRecord({ group: "payments" })),
        createAuditLog,
      });

      await service.setFlag({
        name: "test-flag",
        enabled: true,
        group: "payments",
      });

      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ oldGroup: null, newGroup: "payments" }),
      );
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

      const result = await service.deleteFlag({
        name: "test-flag",
        actorUserId: "admin-1",
      });

      expect(deleteByName).toHaveBeenCalledWith("test-flag");
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "deleted",
          oldEnabled: true,
          actorUserId: "admin-1",
        }),
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
      const findByName = jest
        .fn()
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
      const findByName = jest
        .fn()
        .mockResolvedValueOnce(makeRecord({ enabled: true }))
        .mockResolvedValueOnce(null);
      const { service } = createService({ findByName });

      const result = await service.deleteFlag({ name: "test-flag" });

      expect(result.effectiveEnabled).toBe(false);
      expect(result.effectiveSource).toBe("default");
    });

    it("invalidates the cache after deletion", async () => {
      const invalidate = jest.fn(async () => undefined);
      const { service } = createService(
        { findByName: jest.fn(async () => makeRecord()) },
        { invalidate },
      );

      await service.deleteFlag({ name: "test-flag" });

      expect(invalidate).toHaveBeenCalledWith("test-flag");
    });
  });
});
