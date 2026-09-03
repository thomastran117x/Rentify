import { SavedSearchesRepository } from "@/features/postings/saved-searches/saved-searches.repository";
import { testUuid } from "../../support/uuid";
const POSTING_1_ID = testUuid(9000, 254272);
const POSTING_2_ID = testUuid(9000, 254273);
const POSTING_3_ID = testUuid(9000, 254274);

const SEARCH_1_ID = testUuid(9000, 215277);
const USER_1_ID = testUuid(9000, 994257);
const USER_2_ID = testUuid(9000, 994258);

function createRepository(prisma: Record<string, unknown>) {
  return new SavedSearchesRepository(prisma as never);
}

describe("SavedSearchesRepository", () => {
  describe("create", () => {
    it("generates an identifier and stores the filters as JSON", async () => {
      const create = jest.fn(async () => ({ id: SEARCH_1_ID }));
      const repository = createRepository({ savedSearch: { create } });

      await repository.create({
        userId: USER_1_ID,
        name: "Kayaks",
        queryParams: { q: "kayak" } as never,
        queryHash: "hash",
        notifyFrequency: "instant",
        nextCheckAt: null,
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: expect.any(String),
            userId: USER_1_ID,
            queryParams: { q: "kayak" },
            queryHash: "hash",
            nextCheckAt: null,
          }),
        }),
      );
    });
  });

  describe("findByHash", () => {
    it("looks the search up on the per-user uniqueness key", async () => {
      const findUnique = jest.fn(async () => null);
      const repository = createRepository({ savedSearch: { findUnique } });

      await repository.findByHash(USER_1_ID, "hash");

      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_queryHash: { userId: USER_1_ID, queryHash: "hash" } },
        }),
      );
    });
  });

  describe("listPage", () => {
    it("orders newest first with a tie-break so pages stay stable", async () => {
      const findMany = jest.fn(async () => []);
      const count = jest.fn(async () => 0);
      const repository = createRepository({
        savedSearch: { findMany, count },
      });

      await repository.listPage(USER_1_ID, 3, 20);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_1_ID },
          skip: 40,
          take: 20,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        }),
      );
    });

    it("reports at least one page even when the caller has saved nothing", async () => {
      const repository = createRepository({
        savedSearch: {
          findMany: jest.fn(async () => []),
          count: jest.fn(async () => 0),
        },
      });

      await expect(
        repository.listPage(USER_1_ID, 1, 20),
      ).resolves.toMatchObject({
        pagination: { total: 0, totalPages: 1, hasNextPage: false },
      });
    });
  });

  describe("update", () => {
    it("scopes the write to the owner so a mismatch changes nothing", async () => {
      const updateMany = jest.fn(async () => ({ count: 0 }));
      const findUnique = jest.fn(async () => null);
      const repository = createRepository({
        savedSearch: { updateMany, findUnique },
      });

      await expect(
        repository.update(SEARCH_1_ID, USER_2_ID, { name: "Mine now" }),
      ).resolves.toBeNull();
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: SEARCH_1_ID, userId: USER_2_ID },
        data: { name: "Mine now" },
      });
      expect(findUnique).not.toHaveBeenCalled();
    });

    it("re-reads the row after a successful write", async () => {
      const repository = createRepository({
        savedSearch: {
          updateMany: jest.fn(async () => ({ count: 1 })),
          findUnique: jest.fn(async () => ({ id: SEARCH_1_ID })),
        },
      });

      await expect(
        repository.update(SEARCH_1_ID, USER_1_ID, { name: "Kayaks" }),
      ).resolves.toMatchObject({ id: SEARCH_1_ID });
    });
  });

  describe("remove and resetNewMatchCount", () => {
    it("reports whether the owner-scoped write matched a row", async () => {
      const repository = createRepository({
        savedSearch: {
          deleteMany: jest
            .fn()
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 }),
          updateMany: jest
            .fn()
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 }),
        },
      });

      await expect(repository.remove(SEARCH_1_ID, USER_1_ID)).resolves.toBe(
        true,
      );
      await expect(repository.remove(SEARCH_1_ID, USER_2_ID)).resolves.toBe(
        false,
      );
      await expect(
        repository.resetNewMatchCount(SEARCH_1_ID, USER_1_ID),
      ).resolves.toBe(true);
      await expect(
        repository.resetNewMatchCount(SEARCH_1_ID, USER_2_ID),
      ).resolves.toBe(false);
    });
  });

  describe("claimDueSearches", () => {
    const claimedAt = new Date("2026-08-25T12:00:00.000Z");
    const nextCheckAt = new Date("2026-08-25T12:05:00.000Z");

    it("only considers searches that alert and are actually due", async () => {
      const findMany = jest.fn(async () => []);
      const repository = createRepository({
        savedSearch: { findMany, updateMany: jest.fn() },
      });

      await repository.claimDueSearches(claimedAt, nextCheckAt, 25);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            notifyFrequency: { not: "off" },
            nextCheckAt: { lte: claimedAt },
            invalidatedAt: null,
          },
          take: 25,
          orderBy: [{ nextCheckAt: "asc" }, { id: "asc" }],
        }),
      );
    });

    it("moves the due time forward in the same guarded write it claims on", async () => {
      // Reading and then updating would let two replicas claim the same search
      // and send the visitor the same alert twice.
      const updateMany = jest.fn(async () => ({ count: 1 }));
      const repository = createRepository({
        savedSearch: {
          findMany: jest.fn(async () => [{ id: SEARCH_1_ID }]),
          updateMany,
        },
      });

      await repository.claimDueSearches(claimedAt, nextCheckAt, 25);

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: SEARCH_1_ID, nextCheckAt: { lte: claimedAt } },
        data: { nextCheckAt, lastCheckedAt: claimedAt },
      });
    });

    it("drops a candidate another replica claimed first", async () => {
      const repository = createRepository({
        savedSearch: {
          findMany: jest.fn(async () => [
            { id: SEARCH_1_ID },
            { id: "search-2" },
          ]),
          updateMany: jest
            .fn()
            .mockResolvedValueOnce({ count: 0 })
            .mockResolvedValueOnce({ count: 1 }),
        },
      });

      await expect(
        repository.claimDueSearches(claimedAt, nextCheckAt, 25),
      ).resolves.toEqual([{ id: "search-2" }]);
    });

    it("skips the claim round-trip entirely when nothing is due", async () => {
      const updateMany = jest.fn();
      const repository = createRepository({
        savedSearch: { findMany: jest.fn(async () => []), updateMany },
      });

      await expect(
        repository.claimDueSearches(claimedAt, nextCheckAt, 25),
      ).resolves.toEqual([]);
      expect(updateMany).not.toHaveBeenCalled();
    });
  });

  describe("markInvalidated", () => {
    it("takes the search off the sweep as well as flagging it", async () => {
      const updateMany = jest.fn(async () => ({ count: 1 }));
      const repository = createRepository({ savedSearch: { updateMany } });
      const invalidatedAt = new Date("2026-08-25T12:00:00.000Z");

      await repository.markInvalidated(SEARCH_1_ID, invalidatedAt);

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: SEARCH_1_ID },
        data: { invalidatedAt, nextCheckAt: null },
      });
    });
  });

  describe("recordAlert", () => {
    it("increments rather than overwrites the badge count", async () => {
      const update = jest.fn(async () => ({}));
      const repository = createRepository({ savedSearch: { update } });
      const notifiedAt = new Date("2026-08-25T12:00:00.000Z");

      await repository.recordAlert(SEARCH_1_ID, notifiedAt, 3);

      expect(update).toHaveBeenCalledWith({
        where: { id: SEARCH_1_ID },
        data: { lastNotifiedAt: notifiedAt, newMatchCount: { increment: 3 } },
      });
    });
  });

  describe("filterUnseenPostingIds", () => {
    it("keeps the caller ordering so the newest match still leads", async () => {
      const repository = createRepository({
        savedSearchSeenPosting: {
          findMany: jest.fn(async () => [{ postingId: POSTING_2_ID }]),
        },
      });

      await expect(
        repository.filterUnseenPostingIds(SEARCH_1_ID, [
          POSTING_1_ID,
          POSTING_2_ID,
          POSTING_3_ID,
        ]),
      ).resolves.toEqual([POSTING_1_ID, POSTING_3_ID]);
    });

    it("short-circuits on an empty match set", async () => {
      const findMany = jest.fn();
      const repository = createRepository({
        savedSearchSeenPosting: { findMany },
      });

      await expect(
        repository.filterUnseenPostingIds(SEARCH_1_ID, []),
      ).resolves.toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe("recordSeenPostings", () => {
    it("tolerates a concurrent sweep having recorded the same match", async () => {
      const createMany = jest.fn(async () => ({ count: 1 }));
      const repository = createRepository({
        savedSearchSeenPosting: { createMany },
      });

      await repository.recordSeenPostings(SEARCH_1_ID, [POSTING_1_ID]);

      expect(createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
    });

    it("writes nothing for an empty set", async () => {
      const createMany = jest.fn();
      const repository = createRepository({
        savedSearchSeenPosting: { createMany },
      });

      await expect(
        repository.recordSeenPostings(SEARCH_1_ID, []),
      ).resolves.toBe(0);
      expect(createMany).not.toHaveBeenCalled();
    });
  });

  describe("pruneSeenPostings", () => {
    it("leaves a search under the cap alone", async () => {
      const deleteMany = jest.fn();
      const repository = createRepository({
        savedSearchSeenPosting: {
          count: jest.fn(async () => 10),
          findMany: jest.fn(),
          deleteMany,
        },
      });

      await expect(
        repository.pruneSeenPostings(SEARCH_1_ID, 500),
      ).resolves.toBe(0);
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it("drops exactly the overflow, oldest first", async () => {
      const findMany = jest.fn(async () => [
        { id: "seen-1" },
        { id: "seen-2" },
      ]);
      const deleteMany = jest.fn(async () => ({ count: 2 }));
      const repository = createRepository({
        savedSearchSeenPosting: {
          count: jest.fn(async () => 502),
          findMany,
          deleteMany,
        },
      });

      await expect(
        repository.pruneSeenPostings(SEARCH_1_ID, 500),
      ).resolves.toBe(2);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 2,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      );
      expect(deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["seen-1", "seen-2"] } },
      });
    });
  });
});
