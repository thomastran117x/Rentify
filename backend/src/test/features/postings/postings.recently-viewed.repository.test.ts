import { Prisma } from "@/generated/prisma/client";
import { RecentlyViewedPostingsRepository } from "@/features/postings/recently-viewed/recently-viewed.repository";
import { testUuid } from "../../support/uuid";

const POSTING_1_ID = testUuid(9000, 254272);
const POSTING_2_ID = testUuid(9000, 254273);
const USER_1_ID = testUuid(9000, 994257);

const VIEWED_AT = new Date("2026-09-08T12:00:00.000Z");

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.10.0",
  });
}

describe("RecentlyViewedPostingsRepository", () => {
  describe("recordView", () => {
    it("settles a re-view in a single update, without attempting an insert", async () => {
      const updateMany = jest.fn(async () => ({ count: 1 }));
      const create = jest.fn();
      const repository = new RecentlyViewedPostingsRepository({
        recentlyViewedPosting: { updateMany, create },
      } as any);

      await expect(
        repository.recordView(USER_1_ID, POSTING_1_ID, VIEWED_AT),
      ).resolves.toBe("updated");

      expect(updateMany).toHaveBeenCalledWith({
        where: { userId: USER_1_ID, postingId: POSTING_1_ID },
        data: { viewedAt: VIEWED_AT },
      });
      expect(create).not.toHaveBeenCalled();
    });

    it("inserts a first view and stamps createdAt with the same instant", async () => {
      const updateMany = jest.fn(async () => ({ count: 0 }));
      const create = jest.fn(async () => ({ id: "row-1" }));
      const repository = new RecentlyViewedPostingsRepository({
        recentlyViewedPosting: { updateMany, create },
      } as any);

      await expect(
        repository.recordView(USER_1_ID, POSTING_1_ID, VIEWED_AT),
      ).resolves.toBe("created");

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: expect.any(String),
            userId: USER_1_ID,
            postingId: POSTING_1_ID,
            viewedAt: VIEWED_AT,
            createdAt: VIEWED_AT,
          }),
        }),
      );
    });

    it("falls back to an update when a concurrent first view wins the insert", async () => {
      const updateMany = jest
        .fn()
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      const create = jest.fn(async () => {
        throw uniqueConstraintError();
      });
      const repository = new RecentlyViewedPostingsRepository({
        recentlyViewedPosting: { updateMany, create },
      } as any);

      await expect(
        repository.recordView(USER_1_ID, POSTING_1_ID, VIEWED_AT),
      ).resolves.toBe("updated");

      expect(updateMany).toHaveBeenCalledTimes(2);
    });

    it("rethrows anything that is not a unique-constraint violation", async () => {
      const updateMany = jest.fn(async () => ({ count: 0 }));
      const create = jest.fn(async () => {
        throw new Error("column went missing");
      });
      const repository = new RecentlyViewedPostingsRepository({
        recentlyViewedPosting: { updateMany, create },
      } as any);

      await expect(
        repository.recordView(USER_1_ID, POSTING_1_ID, VIEWED_AT),
      ).rejects.toThrow("column went missing");
    });
  });

  describe("syncMany", () => {
    it("merges a batch in one statement, keeping the later timestamp", async () => {
      // Declared with a parameter so `mock.calls[0][0]` is indexable --
      // tsconfig.test.json infers an empty tuple for a bare `jest.fn()`.
      const executeRaw = jest.fn(async (_statement: Prisma.Sql) => 2);
      const repository = new RecentlyViewedPostingsRepository({
        $executeRaw: executeRaw,
      } as any);

      await repository.syncMany(USER_1_ID, [
        { postingId: POSTING_1_ID, viewedAt: VIEWED_AT },
        { postingId: POSTING_2_ID, viewedAt: VIEWED_AT },
      ]);

      expect(executeRaw).toHaveBeenCalledTimes(1);
      const statement = executeRaw.mock.calls[0][0];
      expect(statement.sql).toContain("INSERT INTO recently_viewed_postings");
      expect(statement.sql).toContain("ON DUPLICATE KEY UPDATE");
      expect(statement.sql).toContain("GREATEST");
      // Five bound values per row: id, user, posting, viewedAt, createdAt.
      expect(statement.values).toHaveLength(10);
    });

    it("issues no statement for an empty batch", async () => {
      const executeRaw = jest.fn(async () => 0);
      const repository = new RecentlyViewedPostingsRepository({
        $executeRaw: executeRaw,
      } as any);

      await repository.syncMany(USER_1_ID, []);

      expect(executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("listRecent", () => {
    it("orders newest first with a stable tiebreak", async () => {
      const findMany = jest.fn(async () => [
        { postingId: POSTING_1_ID, viewedAt: VIEWED_AT },
      ]);
      const repository = new RecentlyViewedPostingsRepository({
        recentlyViewedPosting: { findMany },
      } as any);

      await expect(repository.listRecent(USER_1_ID, 24)).resolves.toEqual([
        { postingId: POSTING_1_ID, viewedAt: VIEWED_AT },
      ]);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_1_ID },
          take: 24,
          orderBy: [{ viewedAt: "desc" }, { postingId: "asc" }],
        }),
      );
    });
  });

  describe("prune", () => {
    it("does nothing while the account is at or under the cap", async () => {
      const count = jest.fn(async () => 50);
      const findMany = jest.fn();
      const deleteMany = jest.fn();
      const repository = new RecentlyViewedPostingsRepository({
        recentlyViewedPosting: { count, findMany, deleteMany },
      } as any);

      await expect(repository.prune(USER_1_ID, 50)).resolves.toBe(0);
      expect(findMany).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it("deletes exactly the overflow, oldest first", async () => {
      const count = jest.fn(async () => 53);
      const findMany = jest.fn(async () => [
        { id: "row-1" },
        { id: "row-2" },
        { id: "row-3" },
      ]);
      const deleteMany = jest.fn(async () => ({ count: 3 }));
      const repository = new RecentlyViewedPostingsRepository({
        recentlyViewedPosting: { count, findMany, deleteMany },
      } as any);

      await expect(repository.prune(USER_1_ID, 50)).resolves.toBe(3);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 3,
          orderBy: [{ viewedAt: "asc" }, { id: "asc" }],
        }),
      );
      expect(deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["row-1", "row-2", "row-3"] } },
      });
    });

    it("skips the delete when the overflow rows have already gone", async () => {
      const count = jest.fn(async () => 53);
      const findMany = jest.fn(async () => []);
      const deleteMany = jest.fn();
      const repository = new RecentlyViewedPostingsRepository({
        recentlyViewedPosting: { count, findMany, deleteMany },
      } as any);

      await expect(repository.prune(USER_1_ID, 50)).resolves.toBe(0);
      expect(deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("deletes", () => {
    it("clears every row for the account", async () => {
      const deleteMany = jest.fn(async () => ({ count: 4 }));
      const repository = new RecentlyViewedPostingsRepository({
        recentlyViewedPosting: { deleteMany },
      } as any);

      await expect(repository.deleteAll(USER_1_ID)).resolves.toBe(4);
      expect(deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_1_ID },
      });
    });

    it("reports whether removing one entry actually deleted a row", async () => {
      const deleteMany = jest
        .fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      const repository = new RecentlyViewedPostingsRepository({
        recentlyViewedPosting: { deleteMany },
      } as any);

      await expect(repository.deleteOne(USER_1_ID, POSTING_1_ID)).resolves.toBe(
        true,
      );
      await expect(repository.deleteOne(USER_1_ID, POSTING_1_ID)).resolves.toBe(
        false,
      );
    });
  });
});
