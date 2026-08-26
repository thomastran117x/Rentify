import { SAVED_SEARCH_SEEN_CAP } from "@/features/postings/saved-searches/saved-searches.model";
import { SavedSearchAlertService } from "@/features/postings/saved-searches/saved-search-alert.service";

const sweepConfig = {
  batchSize: 25,
  instantIntervalMs: 300_000,
  dailyIntervalMs: 86_400_000,
};

function createDueSearch(overrides: Record<string, unknown> = {}) {
  return {
    id: "search-1",
    userId: "user-1",
    name: "Kayaks",
    queryParams: { q: "kayak" },
    notifyFrequency: "instant" as const,
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
    users?: Record<string, unknown>;
    email?: Record<string, unknown>;
  } = {},
) {
  const savedSearchesRepository = {
    claimDueSearches: jest.fn(async () => [createDueSearch()]),
    update: jest.fn(async () => null),
    markInvalidated: jest.fn(async () => undefined),
    filterUnseenPostingIds: jest.fn(async () => ["posting-1"]),
    recordSeenPostings: jest.fn(async () => 1),
    pruneSeenPostings: jest.fn(async () => 0),
    recordAlert: jest.fn(async () => undefined),
    ...overrides.repository,
  };
  const postingsService = {
    searchPublic: jest.fn(async () => createSearchResult(["posting-1"])),
    ...overrides.postings,
  };
  const usersRepository = {
    findUserById: jest.fn(async () => ({
      id: "user-1",
      email: "renter@example.test",
      emailVerified: true,
    })),
    ...overrides.users,
  };
  const emailService = {
    sendSavedSearchMatchesEmail: jest.fn(async () => undefined),
    ...overrides.email,
  };

  return {
    savedSearchesRepository,
    postingsService,
    usersRepository,
    emailService,
    service: new SavedSearchAlertService(
      savedSearchesRepository as never,
      postingsService as never,
      usersRepository as never,
      emailService as never,
    ),
  };
}

describe("SavedSearchAlertService", () => {
  it("returns zero without touching anything when nothing is due", async () => {
    const { service, postingsService } = createDependencies({
      repository: { claimDueSearches: jest.fn(async () => []) },
    });

    await expect(service.runSweep(sweepConfig)).resolves.toBe(0);
    expect(postingsService.searchPublic).not.toHaveBeenCalled();
  });

  it("replays the saved filters through the live search, newest first", async () => {
    const { service, postingsService } = createDependencies();

    await service.runSweep(sweepConfig);

    expect(postingsService.searchPublic).toHaveBeenCalledWith(
      expect.objectContaining({ query: "kayak", sort: "newest", page: 1 }),
    );
  });

  it("scans past the first page so an older new match is not missed", async () => {
    // An unpaused posting keeps its original publish date, so under
    // newest-first ordering it can sit well beyond page one.
    const searchPublic = jest
      .fn()
      .mockResolvedValueOnce(createSearchResult(["posting-1"], true))
      .mockResolvedValueOnce(createSearchResult(["posting-9"]));
    const { service, savedSearchesRepository } = createDependencies({
      postings: { searchPublic },
      repository: {
        filterUnseenPostingIds: jest.fn(async () => ["posting-9"]),
      },
    });

    await service.runSweep(sweepConfig);

    expect(searchPublic).toHaveBeenCalledTimes(2);
    expect(savedSearchesRepository.filterUnseenPostingIds).toHaveBeenCalledWith(
      "search-1",
      ["posting-1", "posting-9"],
    );
  });

  it("alerts only on matches the search has not reported before", async () => {
    const { service, emailService, savedSearchesRepository } =
      createDependencies({
        postings: {
          searchPublic: jest.fn(async () =>
            createSearchResult(["posting-1", "posting-2"]),
          ),
        },
        repository: {
          filterUnseenPostingIds: jest.fn(async () => ["posting-2"]),
        },
      });

    await service.runSweep(sweepConfig);

    expect(savedSearchesRepository.filterUnseenPostingIds).toHaveBeenCalledWith(
      "search-1",
      ["posting-1", "posting-2"],
    );
    expect(emailService.sendSavedSearchMatchesEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        savedSearchId: "search-1",
        recipientId: "user-1",
        postingIds: ["posting-2"],
      }),
    );
  });

  it("sends nothing when every match has already been reported", async () => {
    const { service, emailService, savedSearchesRepository } =
      createDependencies({
        repository: { filterUnseenPostingIds: jest.fn(async () => []) },
      });

    await service.runSweep(sweepConfig);

    expect(emailService.sendSavedSearchMatchesEmail).not.toHaveBeenCalled();
    expect(savedSearchesRepository.recordAlert).not.toHaveBeenCalled();
  });

  it("enqueues the email before recording the matches as seen", async () => {
    // Deliberate ordering: a crash between the two re-alerts, which is a
    // duplicate email. The other order would drop the alert silently and the
    // visitor would never learn the posting existed.
    const order: string[] = [];
    const { service } = createDependencies({
      email: {
        sendSavedSearchMatchesEmail: jest.fn(async () => {
          order.push("email");
        }),
      },
      repository: {
        recordSeenPostings: jest.fn(async () => {
          order.push("seen");
          return 1;
        }),
      },
    });

    await service.runSweep(sweepConfig);

    expect(order).toEqual(["email", "seen"]);
  });

  it("prunes the seen set back to the retention cap", async () => {
    const { service, savedSearchesRepository } = createDependencies();

    await service.runSweep(sweepConfig);

    expect(savedSearchesRepository.pruneSeenPostings).toHaveBeenCalledWith(
      "search-1",
      SAVED_SEARCH_SEEN_CAP,
    );
  });

  it("retires a search whose stored filters no longer validate", async () => {
    const { service, savedSearchesRepository, postingsService } =
      createDependencies({
        repository: {
          claimDueSearches: jest.fn(async () => [
            createDueSearch({ queryParams: { noSuchFilter: true } }),
          ]),
        },
      });

    await service.runSweep(sweepConfig);

    expect(savedSearchesRepository.markInvalidated).toHaveBeenCalledWith(
      "search-1",
      expect.any(Date),
    );
    expect(postingsService.searchPublic).not.toHaveBeenCalled();
  });

  it("does not email an unverified address but still records the matches", async () => {
    const { service, emailService, savedSearchesRepository } =
      createDependencies({
        users: {
          findUserById: jest.fn(async () => ({
            id: "user-1",
            email: "renter@example.test",
            emailVerified: false,
          })),
        },
      });

    await service.runSweep(sweepConfig);

    expect(emailService.sendSavedSearchMatchesEmail).not.toHaveBeenCalled();
    expect(savedSearchesRepository.recordSeenPostings).toHaveBeenCalledWith(
      "search-1",
      ["posting-1"],
    );
  });

  it("pushes a daily search out by a day rather than by the poll interval", async () => {
    const { service, savedSearchesRepository } = createDependencies({
      repository: {
        claimDueSearches: jest.fn(async () => [
          createDueSearch({ notifyFrequency: "daily" }),
        ]),
      },
    });

    await service.runSweep(sweepConfig);

    const patch = (savedSearchesRepository.update as jest.Mock).mock
      .calls[0][2];

    expect(patch.nextCheckAt.getTime()).toBeGreaterThan(
      Date.now() + sweepConfig.instantIntervalMs,
    );
  });

  it("keeps processing the batch when one search throws", async () => {
    const { service, emailService } = createDependencies({
      repository: {
        claimDueSearches: jest.fn(async () => [
          createDueSearch({ id: "search-1" }),
          createDueSearch({ id: "search-2" }),
        ]),
        filterUnseenPostingIds: jest
          .fn()
          .mockRejectedValueOnce(new Error("database blipped"))
          .mockResolvedValue(["posting-9"]),
      },
    });

    await expect(service.runSweep(sweepConfig)).resolves.toBe(2);
    expect(emailService.sendSavedSearchMatchesEmail).toHaveBeenCalledTimes(1);
  });

  it("returns the claimed count so a backlog keeps draining", async () => {
    // Returning the alerted count would put the runtime to sleep after a batch
    // of searches that all found nothing, with more still due.
    const { service } = createDependencies({
      repository: {
        claimDueSearches: jest.fn(async () => [
          createDueSearch({ id: "search-1" }),
          createDueSearch({ id: "search-2" }),
        ]),
        filterUnseenPostingIds: jest.fn(async () => []),
      },
    });

    await expect(service.runSweep(sweepConfig)).resolves.toBe(2);
  });
});
