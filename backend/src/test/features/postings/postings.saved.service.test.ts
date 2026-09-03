import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import { SAVED_POSTING_IDS_LIMIT } from "@/features/postings/saved/saved-postings.model";
import { SavedPostingsService } from "@/features/postings/saved/saved-postings.service";
import { testUuid } from "../../support/uuid";
const POSTING_1_ID = testUuid(9000, 254272);

const USER_1_ID = testUuid(9000, 994257);

function createMetadata(overrides: Record<string, unknown> = {}) {
  return {
    id: POSTING_1_ID,
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
    cache?: Record<string, unknown>;
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
    findLifecycleSummariesByIds: jest.fn(async () => []),
    ...overrides.postings,
  };
  const postingsPublicCacheService = {
    getPublicByIds: jest.fn(async () => ({ postings: [], missingIds: [] })),
    ...overrides.publicCache,
  };
  const cacheService = {
    getJson: jest.fn(async () => null),
    setJson: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    ...overrides.cache,
  };

  return {
    savedPostingsRepository,
    postingsRepository,
    postingsPublicCacheService,
    cacheService,
    service: new SavedPostingsService(
      savedPostingsRepository as any,
      postingsRepository as any,
      postingsPublicCacheService as any,
      cacheService as any,
    ),
  };
}

describe("SavedPostingsService", () => {
  describe("save", () => {
    it("saves a publicly visible posting and returns the save time", async () => {
      const { service, savedPostingsRepository } = createDependencies();

      await expect(service.save(POSTING_1_ID, USER_1_ID)).resolves.toEqual({
        postingId: POSTING_1_ID,
        saved: true,
        savedAt: "2026-08-01T12:00:00.000Z",
      });
      expect(savedPostingsRepository.save).toHaveBeenCalledWith(
        USER_1_ID,
        POSTING_1_ID,
      );
    });

    it("rejects saving a posting that does not exist", async () => {
      const { service, savedPostingsRepository } = createDependencies({
        postings: {
          findPublicReadMetadataById: jest.fn(async () => null),
        },
      });

      await expect(
        service.save(POSTING_1_ID, USER_1_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
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

      await expect(
        service.save(POSTING_1_ID, USER_1_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("rejects saving an archived posting", async () => {
      const { service } = createDependencies({
        postings: {
          findPublicReadMetadataById: jest.fn(async () =>
            createMetadata({ archivedAt: "2026-07-01T00:00:00.000Z" }),
          ),
        },
      });

      await expect(
        service.save(POSTING_1_ID, USER_1_ID),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it("is idempotent when the same posting is saved twice", async () => {
      const { service, savedPostingsRepository } = createDependencies();

      const first = await service.save(POSTING_1_ID, USER_1_ID);
      const second = await service.save(POSTING_1_ID, USER_1_ID);

      expect(second).toEqual(first);
      expect(savedPostingsRepository.save).toHaveBeenCalledTimes(2);
    });
  });

  describe("unsave", () => {
    it("removes the bookmark and reports the cleared state", async () => {
      const { service, savedPostingsRepository } = createDependencies();

      await expect(service.unsave(POSTING_1_ID, USER_1_ID)).resolves.toEqual({
        postingId: POSTING_1_ID,
        saved: false,
        savedAt: null,
      });
      expect(savedPostingsRepository.unsave).toHaveBeenCalledWith(
        USER_1_ID,
        POSTING_1_ID,
      );
    });

    // A posting can be paused or archived after it was saved. Gating the
    // delete on visibility would strand the row in the user's list forever.
    it("still unsaves a posting that is no longer publicly visible", async () => {
      const findPublicReadMetadataById = jest.fn(async () => null);
      const { service, savedPostingsRepository } = createDependencies({
        postings: { findPublicReadMetadataById },
      });

      await expect(service.unsave(POSTING_1_ID, USER_1_ID)).resolves.toEqual({
        postingId: POSTING_1_ID,
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

      await expect(service.unsave(POSTING_1_ID, USER_1_ID)).resolves.toEqual({
        postingId: POSTING_1_ID,
        saved: false,
        savedAt: null,
      });
    });
  });

  describe("list", () => {
    it("returns an empty page without hydrating postings", async () => {
      const { service, postingsPublicCacheService } = createDependencies();

      const result = await service.list(USER_1_ID, 1, 20);

      expect(result.postings).toEqual([]);
      expect(result.unavailablePostings).toEqual([]);
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
                postingId: POSTING_1_ID,
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
              { id: POSTING_1_ID, name: "First" },
            ],
            missingIds: [],
          })),
        },
      });

      const result = await service.list(USER_1_ID, 1, 20);

      expect(postingsPublicCacheService.getPublicByIds).toHaveBeenCalledWith([
        "posting-2",
        POSTING_1_ID,
      ]);
      expect(result.postings).toEqual([
        {
          id: "posting-2",
          name: "Second",
          savedAt: "2026-08-02T00:00:00.000Z",
        },
        {
          id: POSTING_1_ID,
          name: "First",
          savedAt: "2026-08-01T00:00:00.000Z",
        },
      ]);
    });

    it("describes postings that are no longer viewable without changing the total", async () => {
      const { service } = createDependencies({
        savedPostings: {
          listPage: jest.fn(async () => ({
            entries: [
              {
                postingId: POSTING_1_ID,
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
        postings: {
          findLifecycleSummariesByIds: jest.fn(async () => [
            {
              id: "posting-2",
              name: "Paused loft",
              status: "paused",
            },
          ]),
        },
        publicCache: {
          getPublicByIds: jest.fn(async () => ({
            postings: [{ id: POSTING_1_ID, name: "First" }],
            missingIds: ["posting-2"],
          })),
        },
      });

      const result = await service.list(USER_1_ID, 1, 20);

      expect(result.postings).toHaveLength(1);
      expect(result.unavailablePostings).toEqual([
        {
          postingId: "posting-2",
          name: "Paused loft",
          reason: "paused",
          savedAt: "2026-07-01T00:00:00.000Z",
        },
      ]);
      expect(result.pagination.total).toBe(2);
    });

    // An archived or unpublished posting is not coming back on its own, so it
    // is reported differently from a paused one.
    it("separates archived postings from paused ones", async () => {
      const { service } = createDependencies({
        savedPostings: {
          listPage: jest.fn(async () => ({
            entries: [
              {
                postingId: "posting-2",
                createdAt: new Date("2026-07-01T00:00:00.000Z"),
              },
            ],
            pagination: {
              page: 1,
              pageSize: 20,
              total: 1,
              totalPages: 1,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          })),
        },
        postings: {
          findLifecycleSummariesByIds: jest.fn(async () => [
            {
              id: "posting-2",
              name: "Archived loft",
              status: "published",
              archivedAt: "2026-07-15T00:00:00.000Z",
            },
          ]),
        },
        publicCache: {
          getPublicByIds: jest.fn(async () => ({
            postings: [],
            missingIds: ["posting-2"],
          })),
        },
      });

      const result = await service.list(USER_1_ID, 1, 20);

      expect(result.unavailablePostings).toEqual([
        {
          postingId: "posting-2",
          name: "Archived loft",
          reason: "unavailable",
          savedAt: "2026-07-01T00:00:00.000Z",
        },
      ]);
    });

    // The posting row can disappear between the saved-row read and the
    // hydrate. The entry still has to be reported so the count stays honest.
    it("reports a vanished posting with a null name", async () => {
      const { service } = createDependencies({
        savedPostings: {
          listPage: jest.fn(async () => ({
            entries: [
              {
                postingId: "posting-2",
                createdAt: new Date("2026-07-01T00:00:00.000Z"),
              },
            ],
            pagination: {
              page: 1,
              pageSize: 20,
              total: 1,
              totalPages: 1,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          })),
        },
        postings: {
          findLifecycleSummariesByIds: jest.fn(async () => []),
        },
        publicCache: {
          getPublicByIds: jest.fn(async () => ({
            postings: [],
            missingIds: ["posting-2"],
          })),
        },
      });

      const result = await service.list(USER_1_ID, 1, 20);

      expect(result.unavailablePostings).toEqual([
        {
          postingId: "posting-2",
          name: null,
          reason: "unavailable",
          savedAt: "2026-07-01T00:00:00.000Z",
        },
      ]);
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

      await expect(service.listIds(USER_1_ID)).resolves.toEqual({
        postingIds,
        truncated: false,
      });
      expect(savedPostingsRepository.listIds).toHaveBeenCalledWith(
        USER_1_ID,
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

      const result = await service.listIds(USER_1_ID);

      expect(result.postingIds).toHaveLength(SAVED_POSTING_IDS_LIMIT);
      expect(result.truncated).toBe(true);
    });
  });

  describe("identifier caching", () => {
    it("serves a cached set without touching the database", async () => {
      const cached = { postingIds: [POSTING_1_ID], truncated: false };
      const { service, savedPostingsRepository } = createDependencies({
        cache: {
          getJson: jest.fn(async () => cached),
        },
      });

      await expect(service.listIds(USER_1_ID)).resolves.toEqual(cached);
      expect(savedPostingsRepository.listIds).not.toHaveBeenCalled();
    });

    it("caches the set it reads with a bounded lifetime", async () => {
      const { service, cacheService } = createDependencies({
        savedPostings: {
          listIds: jest.fn(async () => [POSTING_1_ID]),
        },
      });

      await service.listIds(USER_1_ID);

      expect(cacheService.setJson).toHaveBeenCalledWith(
        `postings:saved:ids:${USER_1_ID}`,
        { postingIds: [POSTING_1_ID], truncated: false },
        expect.any(Number),
      );
      const [, , ttl] = (cacheService.setJson as jest.Mock).mock.calls[0]!;
      expect(ttl).toBeGreaterThan(0);
    });

    it.each([
      ["save", (service: any) => service.save(POSTING_1_ID, USER_1_ID)],
      ["unsave", (service: any) => service.unsave(POSTING_1_ID, USER_1_ID)],
    ])("invalidates the cached set on %s", async (_label, act) => {
      const { service, cacheService } = createDependencies();

      await act(service);

      expect(cacheService.delete).toHaveBeenCalledWith(
        `postings:saved:ids:${USER_1_ID}`,
      );
    });

    // A Redis outage must degrade to a database read, never a failed request.
    it("falls back to the database when the cache read throws", async () => {
      const { service, savedPostingsRepository } = createDependencies({
        savedPostings: {
          listIds: jest.fn(async () => [POSTING_1_ID]),
        },
        cache: {
          getJson: jest.fn(async () => {
            throw new Error("redis down");
          }),
        },
      });

      await expect(service.listIds(USER_1_ID)).resolves.toEqual({
        postingIds: [POSTING_1_ID],
        truncated: false,
      });
      expect(savedPostingsRepository.listIds).toHaveBeenCalled();
    });

    it("still saves when the cache write throws", async () => {
      const { service } = createDependencies({
        cache: {
          setJson: jest.fn(async () => {
            throw new Error("redis down");
          }),
          delete: jest.fn(async () => {
            throw new Error("redis down");
          }),
        },
      });

      await expect(service.save(POSTING_1_ID, USER_1_ID)).resolves.toEqual(
        expect.objectContaining({ saved: true }),
      );
    });
  });
});
