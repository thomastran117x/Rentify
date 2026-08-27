import { MAX_ALERT_MATCHES_PER_EMAIL } from "@/features/postings/saved-searches/saved-searches.model";
import { SavedSearchEmailComposer } from "@/features/postings/saved-searches/saved-search-email.composer";

const composeInput = {
  savedSearchId: "search-1",
  recipientId: "user-1",
  postingIds: ["posting-1"],
  occurredAt: "2026-08-25T12:00:00.000Z",
};

function createPosting(id: string) {
  return {
    id,
    name: `Sea kayak ${id}`,
    pricing: { currency: "AUD", daily: { amount: 45 } },
    organization: { id: "org-1", name: "Harbour Rentals", slug: "harbour" },
  };
}

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "search-1",
    userId: "user-1",
    name: "Kayaks",
    queryParams: { q: "kayak" },
    queryHash: "hash",
    notifyFrequency: "instant" as const,
    nextCheckAt: null,
    lastCheckedAt: null,
    lastNotifiedAt: null,
    newMatchCount: 1,
    invalidatedAt: null,
    createdAt: new Date("2026-08-20T12:00:00.000Z"),
    ...overrides,
  };
}

function createDependencies(
  overrides: {
    repository?: Record<string, unknown>;
    publicCache?: Record<string, unknown>;
    users?: Record<string, unknown>;
    postings?: Record<string, unknown>;
  } = {},
) {
  const savedSearchesRepository = {
    findById: jest.fn(async () => createRow()),
    ...overrides.repository,
  };
  const postingsPublicCacheService = {
    getPublicByIds: jest.fn(async () => ({
      postings: [createPosting("posting-1")],
      missingIds: [],
    })),
    ...overrides.publicCache,
  };
  const postingsService = {
    searchPublic: jest.fn(async () => ({
      postings: [createPosting("posting-1")],
      pagination: { hasNextPage: false },
    })),
    ...overrides.postings,
  };
  const usersRepository = {
    findUserById: jest.fn(async () => ({
      id: "user-1",
      email: "renter@example.test",
      firstName: "Ada",
      emailVerified: true,
    })),
    ...overrides.users,
  };

  return {
    savedSearchesRepository,
    postingsPublicCacheService,
    usersRepository,
    postingsService,
    composer: new SavedSearchEmailComposer(
      savedSearchesRepository as never,
      postingsPublicCacheService as never,
      usersRepository as never,
      postingsService as never,
    ),
  };
}

describe("SavedSearchEmailComposer", () => {
  it("hydrates the alert from the identifiers on the job", async () => {
    const { composer } = createDependencies();

    await expect(composer.compose(composeInput)).resolves.toMatchObject({
      to: "renter@example.test",
      firstName: "Ada",
      savedSearchId: "search-1",
      savedSearchName: "Kayaks",
      queryParams: { q: "kayak" },
      additionalMatchCount: 0,
      matches: [
        {
          id: "posting-1",
          dailyPrice: 45,
          currency: "AUD",
          organizationName: "Harbour Rentals",
        },
      ],
    });
  });

  it("skips a search that was deleted while the job waited", async () => {
    const { composer } = createDependencies({
      repository: { findById: jest.fn(async () => null) },
    });

    await expect(composer.compose(composeInput)).resolves.toBeNull();
  });

  it("skips a search whose alerts were turned off while the job waited", async () => {
    const { composer } = createDependencies({
      repository: {
        findById: jest.fn(async () => createRow({ notifyFrequency: "off" })),
      },
    });

    await expect(composer.compose(composeInput)).resolves.toBeNull();
  });

  it("refuses to send someone else's search to the job recipient", async () => {
    const { composer } = createDependencies({
      repository: {
        findById: jest.fn(async () => createRow({ userId: "user-2" })),
      },
    });

    await expect(composer.compose(composeInput)).resolves.toBeNull();
  });

  it("skips a search whose stored filters no longer validate", async () => {
    const { composer } = createDependencies({
      repository: {
        findById: jest.fn(async () =>
          createRow({ queryParams: { noSuchFilter: true } }),
        ),
      },
    });

    await expect(composer.compose(composeInput)).resolves.toBeNull();
  });

  it("skips when every carried posting has stopped being visible", async () => {
    // The sweep enqueues before it records the matches, so a duplicate job can
    // arrive after the postings were paused. Announcing them would be wrong.
    const { composer } = createDependencies({
      publicCache: {
        getPublicByIds: jest.fn(async () => ({
          postings: [],
          missingIds: ["posting-1"],
        })),
      },
    });

    await expect(composer.compose(composeInput)).resolves.toBeNull();
  });

  it("skips a recipient whose address is no longer verified", async () => {
    const { composer } = createDependencies({
      users: {
        findUserById: jest.fn(async () => ({
          id: "user-1",
          email: "renter@example.test",
          emailVerified: false,
        })),
      },
    });

    await expect(composer.compose(composeInput)).resolves.toBeNull();
  });

  it("drops a posting that is still public but no longer matches the filters", async () => {
    // A job waiting behind a retry has had time for a posting to change price,
    // tags or policy. Still visible is not the same as still matching.
    const { composer } = createDependencies({
      publicCache: {
        getPublicByIds: jest.fn(async () => ({
          postings: [createPosting("posting-1"), createPosting("posting-2")],
          missingIds: [],
        })),
      },
      postings: {
        searchPublic: jest.fn(async () => ({
          postings: [{ id: "posting-2" }],
          pagination: { hasNextPage: false },
        })),
      },
    });

    const content = await composer.compose(composeInput);

    expect(content?.matches.map((match) => match.id)).toEqual(["posting-2"]);
  });

  it("skips the email when nothing carried by the job still matches", async () => {
    const { composer } = createDependencies({
      postings: {
        searchPublic: jest.fn(async () => ({
          postings: [],
          pagination: { hasNextPage: false },
        })),
      },
    });

    await expect(composer.compose(composeInput)).resolves.toBeNull();
  });

  it("caps the named matches and counts the rest", async () => {
    const postings = Array.from(
      { length: MAX_ALERT_MATCHES_PER_EMAIL + 3 },
      (_, index) => createPosting(`posting-${index}`),
    );
    const { composer } = createDependencies({
      publicCache: {
        getPublicByIds: jest.fn(async () => ({ postings, missingIds: [] })),
      },
      postings: {
        searchPublic: jest.fn(async () => ({
          postings: postings.map((posting) => ({ id: posting.id })),
          pagination: { hasNextPage: false },
        })),
      },
    });

    const content = await composer.compose(composeInput);

    expect(content?.matches).toHaveLength(MAX_ALERT_MATCHES_PER_EMAIL);
    expect(content?.additionalMatchCount).toBe(3);
  });

  it("omits the greeting name when the account has none", async () => {
    const { composer } = createDependencies({
      users: {
        findUserById: jest.fn(async () => ({
          id: "user-1",
          email: "renter@example.test",
          firstName: null,
          emailVerified: true,
        })),
      },
    });

    await expect(composer.compose(composeInput)).resolves.not.toHaveProperty(
      "firstName",
    );
  });
});
