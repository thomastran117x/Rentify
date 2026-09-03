const mockRandomUUID = jest.fn();

jest.mock("node:crypto", () => {
  const actual = jest.requireActual("node:crypto");
  return {
    ...actual,
    randomUUID: () => mockRandomUUID(),
  };
});

import { RecommendationActivityRepository } from "@/features/recommendations/recommendation-activity.repository";
import type {
  PersistRecommendationActivityInput,
  UpsertRecommendationRefreshJobInput,
} from "@/features/recommendations/recommendation-activity.model";
import { testUuid } from "../../support/uuid";
const MISSING_ID = testUuid(9000, 394917);
const POSTING_1_ID = testUuid(9000, 254272);

const ACTIVITY_1_ID = testUuid(9000, 215442);
const ORG_1_ID = testUuid(9000, 9234);
const USER_1_ID = testUuid(9000, 994257);
const USER_2_ID = testUuid(9000, 994258);

describe("RecommendationActivityRepository", () => {
  beforeEach(() => {
    mockRandomUUID.mockReset();
    mockRandomUUID.mockReturnValue("refresh-job-1");
  });

  it("maps posting summaries when a posting exists", async () => {
    const findUnique = jest.fn(async () => ({
      id: POSTING_1_ID,
      organizationId: ORG_1_ID,
      family: "place",
      subtype: "studio",
    }));
    const repository = new RecommendationActivityRepository(
      createDatabaseMock({
        posting: {
          findUnique,
        },
      }) as any,
    );

    await expect(repository.findPostingSummary(POSTING_1_ID)).resolves.toEqual({
      id: POSTING_1_ID,
      organizationId: ORG_1_ID,
      family: "place",
      subtype: "studio",
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        id: POSTING_1_ID,
      },
      select: {
        id: true,
        organizationId: true,
        family: true,
        subtype: true,
      },
    });
  });

  it("returns null when a posting summary cannot be found", async () => {
    const repository = new RecommendationActivityRepository(
      createDatabaseMock({
        posting: {
          findUnique: jest.fn(async () => null),
        },
      }) as any,
    );

    await expect(repository.findPostingSummary(MISSING_ID)).resolves.toBeNull();
  });

  it("coalesces activity records and creates or updates refresh jobs in one transaction", async () => {
    const activityUpsert = jest.fn(async () => undefined);
    const jobFindUnique = jest
      .fn(async () => null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        dedupeKey: `user:${USER_1_ID}`,
        processedAt: null,
        availableAt: new Date("2026-06-01T08:00:00.000Z"),
      } as any)
      .mockResolvedValueOnce({
        dedupeKey: "popular:global",
        processedAt: new Date("2026-05-31T08:00:00.000Z"),
        availableAt: new Date("2026-05-31T08:00:00.000Z"),
      } as any);
    const jobCreate = jest.fn(async () => undefined);
    const jobUpdate = jest.fn(async () => undefined);
    const repository = new RecommendationActivityRepository(
      createDatabaseMock({
        recommendationActivity: {
          upsert: activityUpsert,
        },
        recommendationRefreshJob: {
          findUnique: jobFindUnique,
          create: jobCreate,
          update: jobUpdate,
        },
      }) as any,
    );

    await repository.persistActivityAndRefreshJobs(createActivity(), [
      createRefreshJob({
        dedupeKey: `user:${USER_2_ID}`,
        userId: USER_2_ID,
      }),
      createRefreshJob({
        dedupeKey: `user:${USER_1_ID}`,
        userId: USER_1_ID,
        availableAt: new Date("2026-06-01T09:00:00.000Z"),
      }),
      createRefreshJob({
        dedupeKey: "popular:global",
        jobType: "popular_refresh",
        segmentType: "global",
        availableAt: new Date("2026-06-01T10:00:00.000Z"),
      }),
    ]);

    expect(activityUpsert).toHaveBeenCalledWith({
      where: {
        aggregationKey: "agg-1",
      },
      update: {
        occurredAt: new Date("2026-06-01T12:00:00.000Z"),
        count: {
          increment: 1,
        },
        lastOccurredAt: new Date("2026-06-01T12:00:00.000Z"),
        requestId: "request-1",
        searchSessionId: "search-1",
        metadata: {
          query: "loft",
        },
        personalizationEligible: true,
      },
      create: {
        id: ACTIVITY_1_ID,
        aggregationKey: "agg-1",
        eventType: "search_click",
        source: "search_results",
        occurredAt: new Date("2026-06-01T12:00:00.000Z"),
        postingId: POSTING_1_ID,
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        anonymousActorHash: "anon-1",
        deviceType: "desktop",
        requestId: "request-1",
        searchSessionId: "search-1",
        metadata: {
          query: "loft",
        },
        count: 2,
        firstOccurredAt: new Date("2026-06-01T11:59:00.000Z"),
        lastOccurredAt: new Date("2026-06-01T12:00:00.000Z"),
        personalizationEligible: true,
      },
    });

    expect(jobCreate).toHaveBeenCalledWith({
      data: {
        id: "refresh-job-1",
        jobType: "user_refresh",
        dedupeKey: `user:${USER_2_ID}`,
        userId: USER_2_ID,
        segmentType: null,
        segmentValue: null,
        availableAt: new Date("2026-06-01T08:30:00.000Z"),
      },
    });
    expect(jobUpdate).toHaveBeenNthCalledWith(1, {
      where: {
        dedupeKey: `user:${USER_1_ID}`,
      },
      data: {
        availableAt: new Date("2026-06-01T08:00:00.000Z"),
        lastError: null,
      },
    });
    expect(jobUpdate).toHaveBeenNthCalledWith(2, {
      where: {
        dedupeKey: "popular:global",
      },
      data: {
        availableAt: new Date("2026-06-01T10:00:00.000Z"),
        processingAt: null,
        processedAt: null,
        attempts: 0,
        lastError: null,
      },
    });
  });

  it("stores non-coalesced activity updates without incrementing counts", async () => {
    const activityUpsert = jest.fn(async () => undefined);
    const repository = new RecommendationActivityRepository(
      createDatabaseMock({
        recommendationActivity: {
          upsert: activityUpsert,
        },
        recommendationRefreshJob: {
          findUnique: jest.fn(async () => null),
          create: jest.fn(async () => undefined),
          update: jest.fn(async () => undefined),
        },
      }) as any,
    );

    await repository.persistActivityAndRefreshJobs(
      createActivity({
        coalesced: false,
        requestId: undefined,
        searchSessionId: undefined,
        metadata: undefined,
        personalizationEligible: false,
      }),
      [],
    );

    expect(activityUpsert).toHaveBeenCalledWith({
      where: {
        aggregationKey: "agg-1",
      },
      update: {
        occurredAt: new Date("2026-06-01T12:00:00.000Z"),
        requestId: null,
        searchSessionId: null,
        metadata: null,
        personalizationEligible: false,
      },
      create: {
        id: ACTIVITY_1_ID,
        aggregationKey: "agg-1",
        eventType: "search_click",
        source: "search_results",
        occurredAt: new Date("2026-06-01T12:00:00.000Z"),
        postingId: POSTING_1_ID,
        organizationId: ORG_1_ID,
        actorUserId: USER_1_ID,
        anonymousActorHash: "anon-1",
        deviceType: "desktop",
        requestId: null,
        searchSessionId: null,
        metadata: null,
        count: 2,
        firstOccurredAt: new Date("2026-06-01T11:59:00.000Z"),
        lastOccurredAt: new Date("2026-06-01T12:00:00.000Z"),
        personalizationEligible: false,
      },
    });
  });
});

function createActivity(
  overrides: Partial<PersistRecommendationActivityInput> = {},
): PersistRecommendationActivityInput {
  return {
    id: ACTIVITY_1_ID,
    aggregationKey: "agg-1",
    eventType: "search_click",
    source: "search_results",
    occurredAt: new Date("2026-06-01T12:00:00.000Z"),
    postingId: POSTING_1_ID,
    organizationId: ORG_1_ID,
    actorUserId: USER_1_ID,
    anonymousActorHash: "anon-1",
    deviceType: "desktop",
    requestId: "request-1",
    searchSessionId: "search-1",
    metadata: {
      query: "loft",
    },
    count: 2,
    firstOccurredAt: new Date("2026-06-01T11:59:00.000Z"),
    lastOccurredAt: new Date("2026-06-01T12:00:00.000Z"),
    personalizationEligible: true,
    coalesced: true,
    ...overrides,
  };
}

function createRefreshJob(
  overrides: Partial<UpsertRecommendationRefreshJobInput> = {},
): UpsertRecommendationRefreshJobInput {
  return {
    jobType: "user_refresh",
    dedupeKey: `user:${USER_1_ID}`,
    userId: USER_1_ID,
    availableAt: new Date("2026-06-01T08:30:00.000Z"),
    ...overrides,
  };
}

function createDatabaseMock(
  delegates: Record<string, Record<string, unknown>>,
) {
  const transactionClient = {
    ...delegates,
  };

  return {
    posting: {
      findUnique: jest.fn(async () => null),
      ...(delegates.posting as object),
    },
    recommendationActivity: {
      upsert: jest.fn(async () => undefined),
      ...(delegates.recommendationActivity as object),
    },
    recommendationRefreshJob: {
      create: jest.fn(async () => undefined),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => undefined),
      ...(delegates.recommendationRefreshJob as object),
    },
    ...delegates,
    $transaction: async (
      callback: (transaction: typeof transactionClient) => Promise<unknown>,
    ) => callback(transactionClient),
  };
}
