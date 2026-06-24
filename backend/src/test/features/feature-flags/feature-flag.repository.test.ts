import { FeatureFlagRepository } from "@/features/feature-flags/feature-flag.repository";

function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "test-flag",
    enabled: true,
    description: null,
    group: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createPrisma(
  overrides: Partial<{
    featureFlagFindUnique: jest.Mock;
    featureFlagFindMany: jest.Mock;
    featureFlagUpsert: jest.Mock;
    featureFlagDelete: jest.Mock;
    featureFlagAuditLogCreate: jest.Mock;
  }> = {},
) {
  return {
    featureFlag: {
      findUnique: overrides.featureFlagFindUnique ?? jest.fn(async () => null),
      findMany: overrides.featureFlagFindMany ?? jest.fn(async () => []),
      upsert: overrides.featureFlagUpsert ?? jest.fn(async () => makeDbRow()),
      delete: overrides.featureFlagDelete ?? jest.fn(async () => makeDbRow()),
    },
    featureFlagAuditLog: {
      create:
        overrides.featureFlagAuditLogCreate ?? jest.fn(async () => undefined),
    },
  };
}

describe("FeatureFlagRepository", () => {
  describe("findByName", () => {
    it("returns a mapped record when the row exists", async () => {
      const prisma = createPrisma({
        featureFlagFindUnique: jest.fn(async () =>
          makeDbRow({
            name: "test-flag",
            enabled: true,
            description: "desc",
            group: "payments",
          }),
        ),
      });
      const repo = new FeatureFlagRepository(prisma as never);

      const result = await repo.findByName("test-flag");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("test-flag");
      expect(result!.enabled).toBe(true);
      expect(result!.description).toBe("desc");
      expect(result!.group).toBe("payments");
      expect(result!.createdAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("returns null when the row does not exist", async () => {
      const prisma = createPrisma({
        featureFlagFindUnique: jest.fn(async () => null),
      });
      const repo = new FeatureFlagRepository(prisma as never);

      await expect(repo.findByName("unknown")).resolves.toBeNull();
    });

    it("queries by name", async () => {
      const findUnique = jest.fn(async () => makeDbRow());
      const repo = new FeatureFlagRepository(
        createPrisma({ featureFlagFindUnique: findUnique }) as never,
      );

      await repo.findByName("my-flag");

      expect(findUnique).toHaveBeenCalledWith({ where: { name: "my-flag" } });
    });
  });

  describe("listAll", () => {
    it("returns an ordered list of mapped records", async () => {
      const prisma = createPrisma({
        featureFlagFindMany: jest.fn(async () => [
          makeDbRow({ name: "aa-flag" }),
          makeDbRow({ name: "zz-flag" }),
        ]),
      });
      const repo = new FeatureFlagRepository(prisma as never);

      const result = await repo.listAll();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("aa-flag");
      expect(result[1].name).toBe("zz-flag");
    });

    it("orders results by name ascending", async () => {
      const findMany = jest.fn(async () => []);
      const repo = new FeatureFlagRepository(
        createPrisma({ featureFlagFindMany: findMany }) as never,
      );

      await repo.listAll();

      expect(findMany).toHaveBeenCalledWith({ orderBy: { name: "asc" } });
    });
  });

  describe("upsert", () => {
    it("passes all fields to prisma upsert and returns mapped record", async () => {
      const upsert = jest.fn(async () =>
        makeDbRow({
          name: "my-flag",
          enabled: true,
          description: "test desc",
          createdByUserId: "admin-1",
          updatedByUserId: "admin-1",
        }),
      );
      const repo = new FeatureFlagRepository(
        createPrisma({ featureFlagUpsert: upsert }) as never,
      );

      const result = await repo.upsert(
        "my-flag",
        true,
        "test desc",
        "admin-1",
        "admin-1",
      );

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: "my-flag" },
          create: expect.objectContaining({
            name: "my-flag",
            enabled: true,
            description: "test desc",
          }),
          update: expect.objectContaining({
            enabled: true,
            description: "test desc",
          }),
        }),
      );
      expect(result.name).toBe("my-flag");
    });

    it("stores null for omitted description", async () => {
      const upsert = jest.fn(async () => makeDbRow({ description: null }));
      const repo = new FeatureFlagRepository(
        createPrisma({ featureFlagUpsert: upsert }) as never,
      );

      await repo.upsert("my-flag", false);

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ description: null }),
          update: expect.objectContaining({ description: null }),
        }),
      );
    });

    it("persists the group field when provided", async () => {
      const upsert = jest.fn(async () => makeDbRow({ group: "payments" }));
      const repo = new FeatureFlagRepository(
        createPrisma({ featureFlagUpsert: upsert }) as never,
      );

      const result = await repo.upsert(
        "my-flag",
        true,
        null,
        null,
        null,
        "payments",
      );

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ group: "payments" }),
          update: expect.objectContaining({ group: "payments" }),
        }),
      );
      expect(result.group).toBe("payments");
    });
  });

  describe("deleteByName", () => {
    it("deletes the row by name", async () => {
      const del = jest.fn(async () => makeDbRow());
      const repo = new FeatureFlagRepository(
        createPrisma({ featureFlagDelete: del }) as never,
      );

      await repo.deleteByName("test-flag");

      expect(del).toHaveBeenCalledWith({ where: { name: "test-flag" } });
    });
  });

  describe("createAuditLog", () => {
    it("persists the audit log entry", async () => {
      const create = jest.fn(async () => undefined);
      const repo = new FeatureFlagRepository(
        createPrisma({ featureFlagAuditLogCreate: create }) as never,
      );

      await repo.createAuditLog({
        flagName: "test-flag",
        action: "updated",
        oldEnabled: false,
        newEnabled: true,
        oldDescription: null,
        newDescription: "desc",
        actorUserId: "admin-1",
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          flagName: "test-flag",
          action: "updated",
          oldEnabled: false,
          newEnabled: true,
          newDescription: "desc",
          actorUserId: "admin-1",
        }),
      });
    });

    it("coerces undefined audit fields to null", async () => {
      const create = jest.fn(async () => undefined);
      const repo = new FeatureFlagRepository(
        createPrisma({ featureFlagAuditLogCreate: create }) as never,
      );

      await repo.createAuditLog({ flagName: "test-flag", action: "created" });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          oldEnabled: null,
          newEnabled: null,
          oldDescription: null,
          newDescription: null,
          oldGroup: null,
          newGroup: null,
          actorUserId: null,
        }),
      });
    });

    it("persists oldGroup and newGroup in the audit log", async () => {
      const create = jest.fn(async () => undefined);
      const repo = new FeatureFlagRepository(
        createPrisma({ featureFlagAuditLogCreate: create }) as never,
      );

      await repo.createAuditLog({
        flagName: "test-flag",
        action: "updated",
        oldGroup: null,
        newGroup: "payments",
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ oldGroup: null, newGroup: "payments" }),
      });
    });
  });
});
