import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { SAVED_POSTING_IDS_LIMIT } from "@/features/postings/saved/saved-postings.model";
import { SavedPostingsService } from "@/features/postings/saved/saved-postings.service";

function createMetadata(overrides: Record<string, unknown> = {}) {
  return {
    id: "posting-1",
    organizationId: "org-1",
    status: "published",
    archivedAt: undefined,
    ...overrides,
  };
}

function createDependencies(
  overrides: {
    savedPostings?: Record<string, unknown>;
    postings?: Record<string, unknown>;
    publicCache?: Record<string, unknown>;
  } = {},
) {
  const savedPostingsRepository = {
    save: jest.fn(async () => ({
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
    })),
    unsave: jest.fn(async () => true),
    listPage: jest.fn(async () => ({
      entries: [],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })),
    listIds: jest.fn(async () => []),
    ...overrides.savedPostings,
  };
  const postingsRepository = {
    findPublicReadMetadataById: jest.fn(async () => createMetadata()),
    ...overrides.postings,
  };
  const postingsPublicCacheService = {
    getPublicByIds: jest.fn(async () => ({ postings: [], missingIds: [] })),
    ...overrides.publicCache,
  };

  return {
    savedPostingsRepository,
    postingsRepository,
    postingsPublicCacheService,
    service: new SavedPostingsService(
      savedPostingsRepository as any,
      postingsRepository as any,
      postingsPublicCacheService as any,
    ),
  };
}

describe("SavedPostingsService", () => {
  describe("save", () => {
    it("saves a publicly visible posting and returns the save time", async () => {
      const { service, savedPostingsRepository } = createDependencies();

      await expect(service.save("posting-1", "user-1")).resolves.toEqual({
        postingId: "posting-1",
        saved: true,
        savedAt: "2026-08-01T12:00:00.000Z",
      });
      expect(savedPostingsRepository.save).toHaveBeenCalledWith(
        "user-1",
        "posting-1",
      );
    });

    it("rejects saving a posting that does not exist", async () => {
      const { service, savedPostingsRepository } = createDependencies({
        postings: {
          findPublicReadMetadataById: jest.fn(async () => null),
        },
      });

      await expect(service.save("posting-1", "user-1")).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
      expect(savedPostingsRepository.save).not.toHaveBeenCalled();
    });

    it("rejects saving a paused posting", async () => {
      const { service } = createDependencies({
        postings: {
          findPublicReadMetadataById: jest.fn(async () =>
            createMetadata({ status: "paused" }),
          ),
        },
      });

      await expect(service.save("posting-1", "user-1")).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });

    it("rejects saving an archived posting", async () => {
      const { service } = createDependencies({
        postings: {
          findPublicReadMetadataById: jest.fn(async () =>
            createMetadata({ archivedAt: "2026-07-01T00:00:00.000Z" }),
          ),
        },
      });

      await expect(service.save("posting-1", "user-1")).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
    });

    it("is idempotent when the same posting is saved twice", async () => {
      const { service, savedPostingsRepository } = createDependencies();

      const first = await service.save("posting-1", "user-1");
      const second = await service.save("posting-1", "user-1");

      expect(second).toEqual(first);
      expect(savedPostingsRepository.save).toHaveBeenCalledTimes(2);
    });
  });

  describe("unsave", () => {
    it("removes the bookmark and reports the cleared state", async () => {
      const { service, savedPostingsRepository } = createDependencies();

      await expect(service.unsave("posting-1", "user-1")).resolves.toEqual({
        postingId: "posting-1",
        saved: false,
        savedAt: null,
      });
      expect(savedPostingsRepository.unsave).toHaveBeenCalledWith(
        "user-1",
        "posting-1",
      );
    });

    // A posting can be paused or archived after it was saved. Gating the
    // delete on visibility would strand the row in the user's list forever.
    it("still unsaves a posting that is no longer publicly visible", async () => {
      const findPublicReadMetadataById = jest.fn(async () => null);
      const { service, savedPostingsRepository } = createDependencies({
        postings: { findPublicReadMetadataById },
      });

      await expect(service.unsave("posting-1", "user-1")).resolves.toEqual({
        postingId: "posting-1",
        saved: false,
        savedAt: null,
      });
      expect(findPublicReadMetadataById).not.toHaveBeenCalled();
      expect(savedPostingsRepository.unsave).toHaveBeenCalled();
    });

    it("succeeds when nothing was saved", async () => {
      const { service } = createDependencies({
        savedPostings: {
          unsave: jest.fn(async () => false),
        },
      });

      await expect(service.unsave("posting-1", "user-1")).resolves.toEqual({
        postingId: "posting-1",
        saved: false,
        savedAt: null,
      });
    });
  });

  describe("list", () => {
    it("returns an empty page without hydrating postings", async () => {
      const { service, postingsPublicCacheService } = createDependencies();

      const result = await service.list("user-1", 1, 20);

      expect(result.postings).toEqual([]);
      expect(result.unavailablePostingIds).toEqual([]);
      expect(postingsPublicCacheService.getPublicByIds).not.toHaveBeenCalled();
    });

    it("joins the save time onto each hydrated posting in saved order", async () => {
      const { service, postingsPublicCacheService } = createDependencies({
        savedPostings: {
          listPage: jest.fn(async () => ({
            entries: [
              {
                postingId: "posting-2",
                createdAt: new Date("2026-08-02T00:00:00.000Z"),
              },
              {
                postingId: "posting-1",
                createdAt: new Date("2026-08-01T00:00:00.000Z"),
              },
            ],
            pagination: {
              page: 1,
              pageSize: 20,
              total: 2,
              totalPages: 1,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          })),
        },
        publicCache: {
          getPublicByIds: jest.fn(async () => ({
            postings: [
              { id: "posting-2", name: "Second" },
              { id: "posting-1", name: "First" },
            ],
            missingIds: [],
          })),
        },
      });

      const result = await service.list("user-1", 1, 20);

      expect(postingsPublicCacheService.getPublicByIds).toHaveBeenCalledWith([
        "posting-2",
        "posting-1",
      ]);
      expect(result.postings).toEqual([
        {
          id: "posting-2",
          name: "Second",
          savedAt: "2026-08-02T00:00:00.000Z",
        },
        {
          id: "posting-1",
          name: "First",
          savedAt: "2026-08-01T00:00:00.000Z",
        },
      ]);
    });

    it("reports postings that are no longer visible without changing the total", async () => {
      const { service } = createDependencies({
        savedPostings: {
          listPage: jest.fn(async () => ({
            entries: [
              {
                postingId: "posting-1",
                createdAt: new Date("2026-08-01T00:00:00.000Z"),
              },
              {
                postingId: "posting-2",
                createdAt: new Date("2026-07-01T00:00:00.000Z"),
              },
            ],
            pagination: {
              page: 1,
              pageSize: 20,
              total: 2,
              totalPages: 1,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          })),
        },
        publicCache: {
          getPublicByIds: jest.fn(async () => ({
            postings: [{ id: "posting-1", name: "First" }],
            missingIds: ["posting-2"],
          })),
        },
      });

      const result = await service.list("user-1", 1, 20);

      expect(result.postings).toHaveLength(1);
      expect(result.unavailablePostingIds).toEqual(["posting-2"]);
      expect(result.pagination.total).toBe(2);
    });
  });

  describe("listIds", () => {
    it("returns the full set when the caller is under the cap", async () => {
      const postingIds = Array.from(
        { length: SAVED_POSTING_IDS_LIMIT },
        (_value, index) => `posting-${index}`,
      );
      const { service, savedPostingsRepository } = createDependencies({
        savedPostings: {
          listIds: jest.fn(async () => postingIds),
        },
      });

      await expect(service.listIds("user-1")).resolves.toEqual({
        postingIds,
        truncated: false,
      });
      expect(savedPostingsRepository.listIds).toHaveBeenCalledWith(
        "user-1",
        SAVED_POSTING_IDS_LIMIT + 1,
      );
    });

    it("trims and flags the set when the caller is over the cap", async () => {
      const postingIds = Array.from(
        { length: SAVED_POSTING_IDS_LIMIT + 1 },
        (_value, index) => `posting-${index}`,
      );
      const { service } = createDependencies({
        savedPostings: {
          listIds: jest.fn(async () => postingIds),
        },
      });

      const result = await service.listIds("user-1");

      expect(result.postingIds).toHaveLength(SAVED_POSTING_IDS_LIMIT);
      expect(result.truncated).toBe(true);
    });
  });
});
