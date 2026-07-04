import { SavedSearchesRepository } from "@/features/saved-searches/saved-searches.repository";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ss-1",
    userId: "user-1",
    name: "Camera Search",
    searchParams: { family: "equipment", city: "Vancouver" },
    alertEnabled: true,
    lastAlertSentAt: null,
    createdAt: new Date("2026-06-15T10:00:00.000Z"),
    updatedAt: new Date("2026-06-15T10:00:00.000Z"),
    ...overrides,
  };
}

function makeRepository(prismaOverrides: Record<string, unknown> = {}) {
  return new SavedSearchesRepository({
    savedSearch: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    posting: {
      findMany: jest.fn(),
    },
    ...prismaOverrides,
  } as never);
}

describe("SavedSearchesRepository", () => {
  describe("create", () => {
    it("persists a new saved search and maps the row", async () => {
      const row = makeRow();
      const prismaCreate = jest.fn(async () => row);
      const repository = makeRepository({ savedSearch: { create: prismaCreate } });

      const result = await repository.create("user-1", {
        name: "Camera Search",
        searchParams: { family: "equipment", city: "Vancouver" },
        alertEnabled: true,
      });

      expect(prismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          userId: "user-1",
          name: "Camera Search",
          searchParams: { family: "equipment", city: "Vancouver" },
          alertEnabled: true,
        }),
      });
      expect(result).toEqual({
        id: "ss-1",
        userId: "user-1",
        name: "Camera Search",
        searchParams: { family: "equipment", city: "Vancouver" },
        alertEnabled: true,
        lastAlertSentAt: undefined,
        createdAt: "2026-06-15T10:00:00.000Z",
        updatedAt: "2026-06-15T10:00:00.000Z",
      });
    });
  });

  describe("findByUser", () => {
    it("queries by userId ordered by createdAt ascending", async () => {
      const rows = [makeRow(), makeRow({ id: "ss-2", name: "Workspace Search" })];
      const prismaFindMany = jest.fn(async () => rows);
      const repository = makeRepository({ savedSearch: { findMany: prismaFindMany } });

      const result = await repository.findByUser("user-1");

      expect(prismaFindMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe("ss-1");
    });
  });

  describe("findById", () => {
    it("returns the mapped record when found", async () => {
      const prismaFindUnique = jest.fn(async () => makeRow());
      const repository = makeRepository({ savedSearch: { findUnique: prismaFindUnique } });

      const result = await repository.findById("ss-1");

      expect(prismaFindUnique).toHaveBeenCalledWith({ where: { id: "ss-1" } });
      expect(result?.id).toBe("ss-1");
    });

    it("returns null when record does not exist", async () => {
      const prismaFindUnique = jest.fn(async () => null);
      const repository = makeRepository({ savedSearch: { findUnique: prismaFindUnique } });

      const result = await repository.findById("missing");

      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("sends only provided fields and maps the updated row", async () => {
      const updated = makeRow({ name: "Renamed Search", alertEnabled: false });
      const prismaUpdate = jest.fn(async () => updated);
      const repository = makeRepository({ savedSearch: { update: prismaUpdate } });

      const result = await repository.update("ss-1", {
        name: "Renamed Search",
        alertEnabled: false,
      });

      expect(prismaUpdate).toHaveBeenCalledWith({
        where: { id: "ss-1" },
        data: { name: "Renamed Search", alertEnabled: false },
      });
      expect(result.name).toBe("Renamed Search");
      expect(result.alertEnabled).toBe(false);
    });

    it("omits undefined fields from the data payload", async () => {
      const prismaUpdate = jest.fn(async () => makeRow());
      const repository = makeRepository({ savedSearch: { update: prismaUpdate } });

      await repository.update("ss-1", { alertEnabled: false });

      const callData = (prismaUpdate.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(callData).not.toHaveProperty("name");
      expect(callData).not.toHaveProperty("searchParams");
      expect(callData).toHaveProperty("alertEnabled", false);
    });
  });

  describe("delete", () => {
    it("calls prisma delete with the correct id", async () => {
      const prismaDelete = jest.fn(async () => makeRow());
      const repository = makeRepository({ savedSearch: { delete: prismaDelete } });

      await repository.delete("ss-1");

      expect(prismaDelete).toHaveBeenCalledWith({ where: { id: "ss-1" } });
    });
  });

  describe("countByUser", () => {
    it("returns the count from prisma", async () => {
      const prismaCount = jest.fn(async () => 7);
      const repository = makeRepository({ savedSearch: { count: prismaCount } });

      const result = await repository.countByUser("user-1");

      expect(prismaCount).toHaveBeenCalledWith({ where: { userId: "user-1" } });
      expect(result).toBe(7);
    });
  });

  describe("markAlertSent", () => {
    it("updates lastAlertSentAt to the provided date", async () => {
      const prismaUpdate = jest.fn(async () => makeRow());
      const repository = makeRepository({ savedSearch: { update: prismaUpdate } });
      const sentAt = new Date("2026-06-30T00:00:00.000Z");

      await repository.markAlertSent("ss-1", sentAt);

      expect(prismaUpdate).toHaveBeenCalledWith({
        where: { id: "ss-1" },
        data: { lastAlertSentAt: sentAt },
      });
    });
  });

  describe("findAlertBatch", () => {
    it("queries alert-enabled rows ordered by id with user included", async () => {
      const prismaFindMany = jest.fn(async () => []);
      const repository = makeRepository({ savedSearch: { findMany: prismaFindMany } });

      await repository.findAlertBatch(null, 50);

      expect(prismaFindMany).toHaveBeenCalledWith({
        where: { alertEnabled: true },
        take: 50,
        orderBy: { id: "asc" },
        include: {
          user: { select: { email: true, firstName: true } },
        },
      });
    });

    it("applies cursor when afterId is provided", async () => {
      const prismaFindMany = jest.fn(async () => []);
      const repository = makeRepository({ savedSearch: { findMany: prismaFindMany } });

      await repository.findAlertBatch("ss-5", 50);

      expect(prismaFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { alertEnabled: true, id: { gt: "ss-5" } },
        }),
      );
    });
  });

  describe("findNewMatchingPostings", () => {
    it("queries published postings since the given date", async () => {
      const prismaFindMany = jest.fn(async () => []);
      const repository = makeRepository({ posting: { findMany: prismaFindMany } });
      const since = new Date("2026-06-01T00:00:00.000Z");

      await repository.findNewMatchingPostings({ family: "equipment" }, since, 20);

      expect(prismaFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "published",
            publishedAt: { gt: since },
            family: "equipment",
          }),
          take: 20,
          orderBy: { publishedAt: "desc" },
        }),
      );
    });

    it("applies city filter case-insensitively when provided", async () => {
      const prismaFindMany = jest.fn(async () => []);
      const repository = makeRepository({ posting: { findMany: prismaFindMany } });

      await repository.findNewMatchingPostings(
        { city: "Vancouver" },
        new Date(),
        10,
      );

      const callWhere = (
        prismaFindMany.mock.calls[0] as [{ where: Record<string, unknown> }]
      )[0].where;
      expect(callWhere["city"]).toEqual({
        equals: "Vancouver",
        mode: "insensitive",
      });
    });

    it("omits optional filters when they are not in params", async () => {
      const prismaFindMany = jest.fn(async () => []);
      const repository = makeRepository({ posting: { findMany: prismaFindMany } });

      await repository.findNewMatchingPostings({}, new Date(), 10);

      const callWhere = (
        prismaFindMany.mock.calls[0] as [{ where: Record<string, unknown> }]
      )[0].where;
      expect(callWhere).not.toHaveProperty("family");
      expect(callWhere).not.toHaveProperty("subtype");
      expect(callWhere).not.toHaveProperty("city");
    });
  });

  describe("row mapping", () => {
    it("maps lastAlertSentAt to ISO string when set", async () => {
      const sentAt = new Date("2026-06-20T00:00:00.000Z");
      const row = makeRow({ lastAlertSentAt: sentAt });
      const prismaFindUnique = jest.fn(async () => row);
      const repository = makeRepository({ savedSearch: { findUnique: prismaFindUnique } });

      const result = await repository.findById("ss-1");

      expect(result?.lastAlertSentAt).toBe("2026-06-20T00:00:00.000Z");
    });

    it("maps lastAlertSentAt to undefined when null", async () => {
      const prismaFindUnique = jest.fn(async () => makeRow({ lastAlertSentAt: null }));
      const repository = makeRepository({ savedSearch: { findUnique: prismaFindUnique } });

      const result = await repository.findById("ss-1");

      expect(result?.lastAlertSentAt).toBeUndefined();
    });
  });
});
