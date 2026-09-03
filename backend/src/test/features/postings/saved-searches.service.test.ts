import ConflictError from "@/errors/http/conflict.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import UnprocessableEntityError from "@/errors/http/unprocessable-entity.error";
import {
  MAX_SAVED_SEARCHES_PER_USER,
  SAVED_SEARCH_SEEN_CAP,
} from "@/features/postings/saved-searches/saved-searches.model";
import { SavedSearchesService } from "@/features/postings/saved-searches/saved-searches.service";
import { testUuid } from "../../support/uuid";
const USER_2_ID = testUuid(9000, 994258);

const SEARCH_1_ID = testUuid(9000, 215277);
const USER_1_ID = testUuid(9000, 994257);

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SEARCH_1_ID,
    userId: USER_1_ID,
    name: "Kayaks",
    queryParams: { q: "kayak" },
    queryHash: "hash",
    notifyFrequency: "instant" as const,
    nextCheckAt: new Date("2026-08-25T12:01:00.000Z"),
    lastCheckedAt: null,
    lastNotifiedAt: null,
    newMatchCount: 0,
    invalidatedAt: null,
    createdAt: new Date("2026-08-25T12:00:00.000Z"),
    ...overrides,
  };
}

function createSearchResult(
  postingIds: string[],
  hasNextPage = false,
): Record<string, unknown> {
  return {
    postings: postingIds.map((id) => ({ id })),
    pagination: {
      page: 1,
      pageSize: 50,
      total: postingIds.length,
      totalPages: 1,
      hasNextPage,
      hasPreviousPage: false,
    },
    source: "elasticsearch",
  };
}

function createDependencies(
  overrides: {
    repository?: Record<string, unknown>;
    postings?: Record<string, unknown>;
  } = {},
) {
  const savedSearchesRepository = {
    create: jest.fn(async () => createRow()),
    findByHash: jest.fn(async () => null),
    countForUser: jest.fn(async () => 0),
    listPage: jest.fn(async () => ({
      rows: [createRow()],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    update: jest.fn(async () => createRow()),
    remove: jest.fn(async () => true),
    resetNewMatchCount: jest.fn(async () => true),
    recordSeenPostings: jest.fn(async () => 0),
    ...overrides.repository,
  };
  const postingsService = {
    searchPublic: jest.fn(async () => createSearchResult([])),
    ...overrides.postings,
  };

  return {
    savedSearchesRepository,
    postingsService,
    service: new SavedSearchesService(
      savedSearchesRepository as never,
      postingsService as never,
    ),
  };
}

describe("SavedSearchesService", () => {
  describe("create", () => {
    it("saves a search and derives a name when none was given", async () => {
      const { service, savedSearchesRepository } = createDependencies();

      await service.create(USER_1_ID, {
        queryParams: { q: "kayak", family: "equipment" },
        notifyFrequency: "instant",
      } as never);

      expect(savedSearchesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_1_ID,
          name: "kayak · Equipment",
          notifyFrequency: "instant",
        }),
      );
    });

    it("keeps a name the caller supplied", async () => {
      const { service, savedSearchesRepository } = createDependencies();

      await service.create(USER_1_ID, {
        name: "  Weekend kayaks  ",
        queryParams: { q: "kayak" },
        notifyFrequency: "instant",
      } as never);

      expect(savedSearchesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Weekend kayaks" }),
      );
    });

    it("rejects saving the same filters twice", async () => {
      const { service, savedSearchesRepository } = createDependencies({
        repository: { findByHash: jest.fn(async () => createRow()) },
      });

      await expect(
        service.create(USER_1_ID, {
          queryParams: { q: "kayak" },
          notifyFrequency: "instant",
        } as never),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(savedSearchesRepository.create).not.toHaveBeenCalled();
    });

    it("rejects saving past the per-account cap", async () => {
      const { service, savedSearchesRepository } = createDependencies({
        repository: {
          countForUser: jest.fn(async () => MAX_SAVED_SEARCHES_PER_USER),
        },
      });

      await expect(
        service.create(USER_1_ID, {
          queryParams: { q: "kayak" },
          notifyFrequency: "instant",
        } as never),
      ).rejects.toBeInstanceOf(UnprocessableEntityError);
      expect(savedSearchesRepository.create).not.toHaveBeenCalled();
    });

    it("records everything already matching so the first alert is not a backlog", async () => {
      const { service, savedSearchesRepository, postingsService } =
        createDependencies({
          postings: {
            searchPublic: jest.fn(async () =>
              createSearchResult(["posting-1", "posting-2"]),
            ),
          },
        });

      await service.create(USER_1_ID, {
        queryParams: { q: "kayak" },
        notifyFrequency: "instant",
      } as never);

      expect(postingsService.searchPublic).toHaveBeenCalledWith(
        expect.objectContaining({ query: "kayak", sort: "newest" }),
      );
      expect(savedSearchesRepository.recordSeenPostings).toHaveBeenCalledWith(
        SEARCH_1_ID,
        ["posting-1", "posting-2"],
      );
    });

    it("stops baselining at the retention cap rather than paging forever", async () => {
      const page = Array.from({ length: 50 }, (_, index) => `posting-${index}`);
      const { service, savedSearchesRepository, postingsService } =
        createDependencies({
          postings: {
            searchPublic: jest.fn(async () => createSearchResult(page, true)),
          },
        });

      await service.create(USER_1_ID, {
        queryParams: { q: "kayak" },
        notifyFrequency: "instant",
      } as never);

      expect(postingsService.searchPublic).toHaveBeenCalledTimes(
        SAVED_SEARCH_SEEN_CAP / page.length,
      );
      expect(
        (savedSearchesRepository.recordSeenPostings as jest.Mock).mock
          .calls[0][1],
      ).toHaveLength(SAVED_SEARCH_SEEN_CAP);
    });

    it("still returns the saved search when the baseline read fails", async () => {
      // The search is already persisted at this point, so a failed baseline
      // costs one over-eager email, not the save.
      const { service } = createDependencies({
        postings: {
          searchPublic: jest.fn(async () => {
            throw new Error("search is down");
          }),
        },
      });

      await expect(
        service.create(USER_1_ID, {
          queryParams: { q: "kayak" },
          notifyFrequency: "instant",
        } as never),
      ).resolves.toMatchObject({ id: SEARCH_1_ID });
    });

    it("leaves an off search unscheduled", async () => {
      const { service, savedSearchesRepository } = createDependencies();

      await service.create(USER_1_ID, {
        queryParams: { q: "kayak" },
        notifyFrequency: "off",
      } as never);

      expect(savedSearchesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ nextCheckAt: null }),
      );
    });
  });

  describe("list", () => {
    it("returns the searches with the per-account cap", async () => {
      const { service } = createDependencies();

      await expect(service.list(USER_1_ID, 1, 20)).resolves.toMatchObject({
        limit: MAX_SAVED_SEARCHES_PER_USER,
        searches: [expect.objectContaining({ id: SEARCH_1_ID })],
      });
    });
  });

  describe("update", () => {
    it("re-arms the sweep when alerts are turned back on", async () => {
      const { service, savedSearchesRepository } = createDependencies();

      await service.update(SEARCH_1_ID, USER_1_ID, {
        notifyFrequency: "daily",
      } as never);

      const patch = (savedSearchesRepository.update as jest.Mock).mock
        .calls[0][2];

      expect(patch.notifyFrequency).toBe("daily");
      expect(patch.nextCheckAt).toBeInstanceOf(Date);
    });

    it("disarms the sweep when alerts are turned off", async () => {
      const { service, savedSearchesRepository } = createDependencies();

      await service.update(SEARCH_1_ID, USER_1_ID, {
        notifyFrequency: "off",
      } as never);

      expect(
        (savedSearchesRepository.update as jest.Mock).mock.calls[0][2]
          .nextCheckAt,
      ).toBeNull();
    });

    it("leaves the schedule alone for a rename", async () => {
      const { service, savedSearchesRepository } = createDependencies();

      await service.update(SEARCH_1_ID, USER_1_ID, { name: "Kayaks" } as never);

      expect(
        (savedSearchesRepository.update as jest.Mock).mock.calls[0][2],
      ).not.toHaveProperty("nextCheckAt");
    });

    it("reports a search belonging to someone else as missing", async () => {
      const { service } = createDependencies({
        repository: { update: jest.fn(async () => null) },
      });

      await expect(
        service.update(SEARCH_1_ID, USER_2_ID, { name: "Mine now" } as never),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
  });

  describe("remove", () => {
    it("reports a search belonging to someone else as missing", async () => {
      const { service } = createDependencies({
        repository: { remove: jest.fn(async () => false) },
      });

      await expect(
        service.remove(SEARCH_1_ID, USER_2_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("removes the caller's own search", async () => {
      const { service, savedSearchesRepository } = createDependencies();

      await expect(
        service.remove(SEARCH_1_ID, USER_1_ID),
      ).resolves.toBeUndefined();
      expect(savedSearchesRepository.remove).toHaveBeenCalledWith(
        SEARCH_1_ID,
        USER_1_ID,
      );
    });
  });

  describe("markSeen", () => {
    it("clears the badge for the owner", async () => {
      const { service, savedSearchesRepository } = createDependencies();

      await service.markSeen(SEARCH_1_ID, USER_1_ID);

      expect(savedSearchesRepository.resetNewMatchCount).toHaveBeenCalledWith(
        SEARCH_1_ID,
        USER_1_ID,
      );
    });

    it("reports a search belonging to someone else as missing", async () => {
      const { service } = createDependencies({
        repository: { resetNewMatchCount: jest.fn(async () => false) },
      });

      await expect(
        service.markSeen(SEARCH_1_ID, USER_2_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
  });
});
