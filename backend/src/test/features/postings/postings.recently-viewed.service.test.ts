import {
  RECENTLY_VIEWED_CAP,
  RECENTLY_VIEWED_MAX_AGE_MS,
} from "@/features/postings/recently-viewed/recently-viewed.model";
import { RecentlyViewedPostingsService } from "@/features/postings/recently-viewed/recently-viewed.service";
import { testUuid } from "../../support/uuid";

const POSTING_1_ID = testUuid(9000, 254272);
const POSTING_2_ID = testUuid(9000, 254273);
const USER_1_ID = testUuid(9000, 994257);

const NOW = new Date("2026-09-08T12:00:00.000Z");

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
    recentlyViewed?: Record<string, unknown>;
    postings?: Record<string, unknown>;
    publicCache?: Record<string, unknown>;
    profile?: Record<string, unknown>;
    cache?: Record<string, unknown>;
  } = {},
) {
  const recentlyViewedPostingsRepository = {
    recordView: jest.fn(async () => "updated"),
    syncMany: jest.fn(async () => undefined),
    listRecent: jest.fn(async () => []),
    prune: jest.fn(async () => 0),
    deleteAll: jest.fn(async () => 0),
    deleteOne: jest.fn(async () => true),
    ...overrides.recentlyViewed,
  };
  const postingsRepository = {
    findPublicReadMetadataById: jest.fn(async () => createMetadata()),
    ...overrides.postings,
  };
  const postingsPublicCacheService = {
    getPublicByIds: jest.fn(async () => ({ postings: [], missingIds: [] })),
    ...overrides.publicCache,
  };
  const profileRepository = {
    findRecentlyViewedTrackingEnabledByUserId: jest.fn(async () => true),
    ...overrides.profile,
  };
  const cacheService = {
    getJson: jest.fn(async () => null),
    setJson: jest.fn(async () => undefined),
    ...overrides.cache,
  };

  return {
    recentlyViewedPostingsRepository,
    postingsRepository,
    postingsPublicCacheService,
    profileRepository,
    cacheService,
    service: new RecentlyViewedPostingsService(
      recentlyViewedPostingsRepository as any,
      postingsRepository as any,
      postingsPublicCacheService as any,
      profileRepository as any,
      cacheService as any,
    ),
  };
}

describe("RecentlyViewedPostingsService", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("recordView", () => {
    it("records a view and skips the prune when the row already existed", async () => {
      const { service, recentlyViewedPostingsRepository } =
        createDependencies();

      await service.recordView(POSTING_1_ID, USER_1_ID, { isBot: false });

      expect(recentlyViewedPostingsRepository.recordView).toHaveBeenCalledWith(
        USER_1_ID,
        POSTING_1_ID,
        NOW,
      );
      // The count query stays off the hot path: only an insert can push the
      // account over the cap.
      expect(recentlyViewedPostingsRepository.prune).not.toHaveBeenCalled();
    });

    it("prunes to the cap after inserting a new row", async () => {
      const { service, recentlyViewedPostingsRepository } = createDependencies({
        recentlyViewed: { recordView: jest.fn(async () => "created") },
      });

      await service.recordView(POSTING_1_ID, USER_1_ID, { isBot: false });

      expect(recentlyViewedPostingsRepository.prune).toHaveBeenCalledWith(
        USER_1_ID,
        RECENTLY_VIEWED_CAP,
      );
    });

    it("writes nothing for a signed-out visitor", async () => {
      const { service, recentlyViewedPostingsRepository, profileRepository } =
        createDependencies();

      await service.recordView(POSTING_1_ID, undefined, { isBot: false });

      expect(
        recentlyViewedPostingsRepository.recordView,
      ).not.toHaveBeenCalled();
      expect(
        profileRepository.findRecentlyViewedTrackingEnabledByUserId,
      ).not.toHaveBeenCalled();
    });

    it("writes nothing for a bot", async () => {
      const { service, recentlyViewedPostingsRepository } =
        createDependencies();

      await service.recordView(POSTING_1_ID, USER_1_ID, { isBot: true });

      expect(
        recentlyViewedPostingsRepository.recordView,
      ).not.toHaveBeenCalled();
    });

    it("writes nothing when the caller has turned tracking off", async () => {
      const { service, recentlyViewedPostingsRepository } = createDependencies({
        profile: {
          findRecentlyViewedTrackingEnabledByUserId: jest.fn(async () => false),
        },
      });

      await service.recordView(POSTING_1_ID, USER_1_ID, { isBot: false });

      expect(
        recentlyViewedPostingsRepository.recordView,
      ).not.toHaveBeenCalled();
    });

    it("writes nothing for a posting that is not publicly visible", async () => {
      const { service, recentlyViewedPostingsRepository } = createDependencies({
        postings: {
          findPublicReadMetadataById: jest.fn(async () =>
            createMetadata({ status: "paused" }),
          ),
        },
      });

      await service.recordView(POSTING_1_ID, USER_1_ID, { isBot: false });

      expect(
        recentlyViewedPostingsRepository.recordView,
      ).not.toHaveBeenCalled();
    });

    it("writes nothing for a posting that no longer exists", async () => {
      const { service, recentlyViewedPostingsRepository } = createDependencies({
        postings: {
          findPublicReadMetadataById: jest.fn(async () => null),
        },
      });

      await service.recordView(POSTING_1_ID, USER_1_ID, { isBot: false });

      expect(
        recentlyViewedPostingsRepository.recordView,
      ).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("returns an empty list without hydrating anything", async () => {
      const { service, postingsPublicCacheService } = createDependencies();

      await expect(service.list(USER_1_ID, 24)).resolves.toEqual({
        postings: [],
        trackingEnabled: true,
      });
      expect(postingsPublicCacheService.getPublicByIds).not.toHaveBeenCalled();
    });

    it("stamps each hydrated posting with when it was viewed", async () => {
      const viewedAt = new Date("2026-09-07T18:42:00.000Z");
      const { service } = createDependencies({
        recentlyViewed: {
          listRecent: jest.fn(async () => [
            { postingId: POSTING_1_ID, viewedAt },
          ]),
        },
        publicCache: {
          getPublicByIds: jest.fn(async () => ({
            postings: [{ id: POSTING_1_ID, name: "Kayak" }],
            missingIds: [],
          })),
        },
      });

      await expect(service.list(USER_1_ID, 24)).resolves.toEqual({
        postings: [
          {
            id: POSTING_1_ID,
            name: "Kayak",
            viewedAt: viewedAt.toISOString(),
          },
        ],
        trackingEnabled: true,
      });
    });

    it("drops entries whose posting is no longer publicly viewable", async () => {
      const viewedAt = new Date("2026-09-07T18:42:00.000Z");
      const { service } = createDependencies({
        recentlyViewed: {
          listRecent: jest.fn(async () => [
            { postingId: POSTING_1_ID, viewedAt },
            { postingId: POSTING_2_ID, viewedAt },
          ]),
        },
        publicCache: {
          getPublicByIds: jest.fn(async () => ({
            postings: [{ id: POSTING_1_ID, name: "Kayak" }],
            missingIds: [POSTING_2_ID],
          })),
        },
      });

      const result = await service.list(USER_1_ID, 24);

      // Unlike saved postings, a vanished entry gets no tombstone.
      expect(result.postings).toHaveLength(1);
      expect(result.postings[0].id).toBe(POSTING_1_ID);
    });

    it("reports that tracking is off so the client stops recording locally", async () => {
      const { service } = createDependencies({
        profile: {
          findRecentlyViewedTrackingEnabledByUserId: jest.fn(async () => false),
        },
      });

      await expect(service.list(USER_1_ID, 24)).resolves.toEqual({
        postings: [],
        trackingEnabled: false,
      });
    });
  });

  describe("sync", () => {
    function withVisiblePosting(overrides: Record<string, unknown> = {}) {
      return createDependencies({
        publicCache: {
          getPublicByIds: jest.fn(async () => ({
            postings: [{ id: POSTING_1_ID }],
            missingIds: [],
          })),
        },
        ...overrides,
      });
    }

    it("merges entries and prunes back to the cap", async () => {
      const { service, recentlyViewedPostingsRepository } =
        withVisiblePosting();

      await service.sync(
        USER_1_ID,
        {
          entries: [
            { postingId: POSTING_1_ID, viewedAt: "2026-09-07T18:42:00.000Z" },
          ],
        },
        24,
      );

      expect(recentlyViewedPostingsRepository.syncMany).toHaveBeenCalledWith(
        USER_1_ID,
        [
          {
            postingId: POSTING_1_ID,
            viewedAt: new Date("2026-09-07T18:42:00.000Z"),
          },
        ],
      );
      expect(recentlyViewedPostingsRepository.prune).toHaveBeenCalledWith(
        USER_1_ID,
        RECENTLY_VIEWED_CAP,
      );
    });

    it("collapses a future timestamp to now rather than rejecting it", async () => {
      const { service, recentlyViewedPostingsRepository } =
        withVisiblePosting();

      await service.sync(
        USER_1_ID,
        {
          entries: [
            { postingId: POSTING_1_ID, viewedAt: "2027-01-01T00:00:00.000Z" },
          ],
        },
        24,
      );

      expect(recentlyViewedPostingsRepository.syncMany).toHaveBeenCalledWith(
        USER_1_ID,
        [{ postingId: POSTING_1_ID, viewedAt: NOW }],
      );
    });

    it("raises a very old timestamp to the age floor", async () => {
      const { service, recentlyViewedPostingsRepository } =
        withVisiblePosting();

      await service.sync(
        USER_1_ID,
        {
          entries: [
            { postingId: POSTING_1_ID, viewedAt: "2020-01-01T00:00:00.000Z" },
          ],
        },
        24,
      );

      expect(recentlyViewedPostingsRepository.syncMany).toHaveBeenCalledWith(
        USER_1_ID,
        [
          {
            postingId: POSTING_1_ID,
            viewedAt: new Date(NOW.getTime() - RECENTLY_VIEWED_MAX_AGE_MS),
          },
        ],
      );
    });

    it("keeps the latest claim when one batch names a posting twice", async () => {
      const { service, recentlyViewedPostingsRepository } =
        withVisiblePosting();

      await service.sync(
        USER_1_ID,
        {
          entries: [
            { postingId: POSTING_1_ID, viewedAt: "2026-09-01T00:00:00.000Z" },
            { postingId: POSTING_1_ID, viewedAt: "2026-09-05T00:00:00.000Z" },
            { postingId: POSTING_1_ID, viewedAt: "2026-09-03T00:00:00.000Z" },
          ],
        },
        24,
      );

      expect(recentlyViewedPostingsRepository.syncMany).toHaveBeenCalledWith(
        USER_1_ID,
        [
          {
            postingId: POSTING_1_ID,
            viewedAt: new Date("2026-09-05T00:00:00.000Z"),
          },
        ],
      );
    });

    it("writes nothing when every entry names an unavailable posting", async () => {
      const { service, recentlyViewedPostingsRepository } = createDependencies({
        publicCache: {
          getPublicByIds: jest.fn(async () => ({
            postings: [],
            missingIds: [POSTING_1_ID],
          })),
        },
      });

      await service.sync(
        USER_1_ID,
        {
          entries: [
            { postingId: POSTING_1_ID, viewedAt: "2026-09-07T18:42:00.000Z" },
          ],
        },
        24,
      );

      expect(recentlyViewedPostingsRepository.syncMany).not.toHaveBeenCalled();
      expect(recentlyViewedPostingsRepository.prune).not.toHaveBeenCalled();
    });

    it("skips the merge entirely when the caller has turned tracking off", async () => {
      const { service, recentlyViewedPostingsRepository } = createDependencies({
        profile: {
          findRecentlyViewedTrackingEnabledByUserId: jest.fn(async () => false),
        },
      });

      const result = await service.sync(
        USER_1_ID,
        {
          entries: [
            { postingId: POSTING_1_ID, viewedAt: "2026-09-07T18:42:00.000Z" },
          ],
        },
        24,
      );

      expect(recentlyViewedPostingsRepository.syncMany).not.toHaveBeenCalled();
      expect(result.trackingEnabled).toBe(false);
    });
  });

  describe("clear and remove", () => {
    it("clears the whole history", async () => {
      const { service, recentlyViewedPostingsRepository } =
        createDependencies();

      await service.clear(USER_1_ID);

      expect(recentlyViewedPostingsRepository.deleteAll).toHaveBeenCalledWith(
        USER_1_ID,
      );
    });

    it("removes one entry without checking whether the posting is still visible", async () => {
      const { service, recentlyViewedPostingsRepository, postingsRepository } =
        createDependencies();

      await service.remove(USER_1_ID, POSTING_1_ID);

      expect(recentlyViewedPostingsRepository.deleteOne).toHaveBeenCalledWith(
        USER_1_ID,
        POSTING_1_ID,
      );
      // An entry whose posting was archived must still be removable.
      expect(
        postingsRepository.findPublicReadMetadataById,
      ).not.toHaveBeenCalled();
    });
  });

  describe("tracking-enabled cache", () => {
    it("consults the same cache key on every check within one request", async () => {
      const { service, cacheService } = createDependencies({
        publicCache: {
          getPublicByIds: jest.fn(async () => ({
            postings: [{ id: POSTING_1_ID }],
            missingIds: [],
          })),
        },
      });

      // `sync` checks the flag directly, then again through its trailing
      // `list()` call -- both must address the same cache entry, or the two
      // reads within one request could disagree.
      await service.sync(
        USER_1_ID,
        { entries: [{ postingId: POSTING_1_ID, viewedAt: NOW.toISOString() }] },
        24,
      );

      const keys = (cacheService.getJson as jest.Mock).mock.calls.map(
        (call) => call[0],
      );

      expect(keys).toHaveLength(2);
      expect(new Set(keys).size).toBe(1);
    });

    it("writes the cache with the documented TTL", async () => {
      const { service, cacheService } = createDependencies();

      await service.list(USER_1_ID, 24);

      expect(cacheService.setJson).toHaveBeenCalledWith(
        expect.stringContaining(USER_1_ID),
        true,
        60,
      );
    });

    it("trusts a cached false without touching the database", async () => {
      const { service, profileRepository, cacheService } = createDependencies({
        cache: { getJson: jest.fn(async () => false) },
      });

      await service.recordView(POSTING_1_ID, USER_1_ID, { isBot: false });

      expect(
        profileRepository.findRecentlyViewedTrackingEnabledByUserId,
      ).not.toHaveBeenCalled();
      expect(cacheService.setJson).not.toHaveBeenCalled();
    });

    it("falls back to the database when the cache read fails", async () => {
      const { service, profileRepository } = createDependencies({
        cache: {
          getJson: jest.fn(async () => {
            throw new Error("redis down");
          }),
        },
      });

      await expect(service.list(USER_1_ID, 24)).resolves.toEqual({
        postings: [],
        trackingEnabled: true,
      });
      expect(
        profileRepository.findRecentlyViewedTrackingEnabledByUserId,
      ).toHaveBeenCalledTimes(1);
    });

    it("does not fail the request when the cache write fails", async () => {
      const { service } = createDependencies({
        cache: {
          setJson: jest.fn(async () => {
            throw new Error("redis down");
          }),
        },
      });

      await expect(service.list(USER_1_ID, 24)).resolves.toEqual({
        postings: [],
        trackingEnabled: true,
      });
    });
  });
});
