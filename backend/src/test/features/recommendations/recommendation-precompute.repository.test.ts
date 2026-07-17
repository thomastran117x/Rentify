const mockRandomUUID = jest.fn();

jest.mock("node:crypto", () => {
  const actual = jest.requireActual("node:crypto");

  return {
    ...actual,
    randomUUID: () => mockRandomUUID(),
  };
});

import { RecommendationPrecomputeRepository } from "@/features/recommendations/recommendation-precompute.repository";

describe("RecommendationPrecomputeRepository", () => {
  beforeEach(() => {
    mockRandomUUID.mockReset();
    mockRandomUUID.mockReturnValue("generated-id-1");
  });

  it("claims ready refresh jobs and stamps processingAt", async () => {
    const findMany = jest.fn(async () => [
      {
        id: "job-1",
        jobType: "user_refresh",
        userId: "user-1",
        attempts: 0,
        availableAt: new Date("2026-05-07T12:00:00.000Z"),
        createdAt: new Date("2026-05-07T12:00:00.000Z"),
        updatedAt: new Date("2026-05-07T12:00:00.000Z"),
      },
    ]);
    const updateMany = jest.fn(async () => ({
      count: 1,
    }));
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({
        recommendationRefreshJob: {
          findMany,
          updateMany,
        },
      }) as any,
    );

    const claimed = await repository.claimRefreshJobBatch(10);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(claimed).toEqual([
      expect.objectContaining({
        id: "job-1",
        jobType: "user_refresh",
        userId: "user-1",
      }),
    ]);
  });

  it("marks retries with exponential backoff metadata", async () => {
    const update = jest.fn(async () => undefined);
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({
        recommendationRefreshJob: {
          update,
        },
      }) as any,
    );

    await repository.markRefreshJobRetry("job-2", 3, "x".repeat(3_000));

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "job-2",
        },
        data: expect.objectContaining({
          processingAt: null,
          lastError: "x".repeat(2_048),
          attempts: {
            increment: 1,
          },
          availableAt: expect.any(Date),
        }),
      }),
    );
  });

  it("marks refresh jobs as processed and clears transient state", async () => {
    const update = jest.fn(async () => undefined);
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({
        recommendationRefreshJob: {
          update,
        },
      }) as any,
    );

    await repository.markRefreshJobProcessed("job-9");

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "job-9",
      },
      data: {
        processedAt: expect.any(Date),
        processingAt: null,
        lastError: null,
      },
    });
  });

  it("maps personalized user activity rows and skips rows without postings", async () => {
    const findMany = jest.fn(async () => [
      {
        postingId: "posting-1",
        eventType: "search_click",
        count: "2",
        lastOccurredAt: new Date("2026-05-07T12:00:00.000Z"),
        posting: {
          family: "place",
          subtype: "entire_place",
          tags: ["wifi", 123, "desk"],
        },
      },
      {
        postingId: "posting-2",
        eventType: "posting_view",
        count: 1,
        lastOccurredAt: new Date("2026-05-07T13:00:00.000Z"),
        posting: null,
      },
    ]);
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({
        recommendationActivity: {
          findMany,
        },
      }) as any,
    );

    const rows = await repository.listUserActivityRows(
      "user-1",
      new Date("2026-05-01T00:00:00.000Z"),
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        actorUserId: "user-1",
        personalizationEligible: true,
        lastOccurredAt: {
          gte: new Date("2026-05-01T00:00:00.000Z"),
        },
        eventType: {
          in: [
            "posting_view",
            "search_click",
            "booking_request_created",
            "renting_confirmed",
          ],
        },
      },
      select: {
        postingId: true,
        eventType: true,
        count: true,
        lastOccurredAt: true,
        posting: {
          select: {
            family: true,
            subtype: true,
            tags: true,
          },
        },
      },
    });
    expect(rows).toEqual([
      {
        postingId: "posting-1",
        eventType: "search_click",
        count: 2,
        lastOccurredAt: "2026-05-07T12:00:00.000Z",
        family: "place",
        subtype: "entire_place",
        tags: ["wifi", "desk"],
      },
    ]);
  });

  it("maps popular activity rows without requiring an actor filter", async () => {
    const findMany = jest.fn(async () => [
      {
        postingId: "posting-3",
        eventType: "renting_confirmed",
        count: 4,
        lastOccurredAt: new Date("2026-05-08T12:00:00.000Z"),
        posting: {
          family: "vehicle",
          subtype: "car",
          tags: "not-an-array",
        },
      },
    ]);
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({
        recommendationActivity: {
          findMany,
        },
      }) as any,
    );

    const rows = await repository.listPopularActivityRows(
      new Date("2026-05-01T00:00:00.000Z"),
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          lastOccurredAt: {
            gte: new Date("2026-05-01T00:00:00.000Z"),
          },
          eventType: {
            in: [
              "posting_view",
              "search_click",
              "booking_request_created",
              "renting_confirmed",
            ],
          },
        },
      }),
    );
    expect(rows).toEqual([
      {
        postingId: "posting-3",
        eventType: "renting_confirmed",
        count: 4,
        lastOccurredAt: "2026-05-08T12:00:00.000Z",
        family: "vehicle",
        subtype: "car",
        tags: [],
      },
    ]);
  });

  it("lists published recommendation candidates with filters and normalized tags", async () => {
    const findMany = jest.fn(async () => [
      {
        id: "posting-1",
        organizationId: "org-1",
        family: "place",
        subtype: "entire_place",
        tags: ["wifi", null, "balcony"],
        availabilityStatus: "available",
        publishedAt: new Date("2026-05-09T12:00:00.000Z"),
      },
      {
        id: "posting-2",
        organizationId: "org-2",
        family: "place",
        subtype: "entire_place",
        tags: [],
        availabilityStatus: "unavailable",
        publishedAt: null,
      },
    ]);
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({
        posting: {
          findMany,
        },
      }) as any,
    );

    const rows = await repository.listPublishedRecommendationCandidates({
      excludeUserId: "user-1",
      family: "place",
      subtype: "entire_place",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "published",
        NOT: {
          organization: {
            memberships: {
              some: {
                userId: "user-1",
              },
            },
          },
        },
        family: "place",
        subtype: "entire_place",
      },
      select: {
        id: true,
        organizationId: true,
        family: true,
        subtype: true,
        tags: true,
        availabilityStatus: true,
        publishedAt: true,
      },
    });
    expect(rows).toEqual([
      {
        id: "posting-1",
        organizationId: "org-1",
        family: "place",
        subtype: "entire_place",
        tags: ["wifi", "balcony"],
        availabilityStatus: "available",
        publishedAt: "2026-05-09T12:00:00.000Z",
      },
      {
        id: "posting-2",
        organizationId: "org-2",
        family: "place",
        subtype: "entire_place",
        tags: [],
        availabilityStatus: "unavailable",
      },
    ]);
  });

  it("builds unique popular segments from published postings", async () => {
    const findMany = jest.fn(async () => [
      {
        family: "place",
        subtype: "entire_place",
      },
      {
        family: "place",
        subtype: "entire_place",
      },
      {
        family: "vehicle",
        subtype: "car",
      },
    ]);
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({
        posting: {
          findMany,
        },
      }) as any,
    );

    const segments = await repository.listPublishedPopularSegments();

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "published",
      },
      select: {
        family: true,
        subtype: true,
      },
      distinct: ["family", "subtype"],
    });
    expect(segments).toEqual([
      {
        segmentType: "global",
        segmentValue: "global",
      },
      {
        segmentType: "family",
        segmentValue: "place",
      },
      {
        segmentType: "family_subtype",
        segmentValue: "place:entire_place",
      },
      {
        segmentType: "family",
        segmentValue: "vehicle",
      },
      {
        segmentType: "family_subtype",
        segmentValue: "vehicle:car",
      },
    ]);
  });

  it("maps popular snapshot freshness records to iso timestamps", async () => {
    const findMany = jest.fn(async () => [
      {
        segmentType: "family",
        segmentValue: "place",
        generatedAt: new Date("2026-05-10T12:00:00.000Z"),
      },
    ]);
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({
        popularRecommendationSnapshot: {
          findMany,
        },
      }) as any,
    );

    const rows = await repository.listPopularSnapshotFreshness();

    expect(findMany).toHaveBeenCalledWith({
      select: {
        segmentType: true,
        segmentValue: true,
        generatedAt: true,
      },
    });
    expect(rows).toEqual([
      {
        segmentType: "family",
        segmentValue: "place",
        generatedAt: "2026-05-10T12:00:00.000Z",
      },
    ]);
  });

  it("creates a new refresh job when no dedupe match exists", async () => {
    const findUnique = jest.fn(async () => null);
    const create = jest.fn(async () => undefined);
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({
        recommendationRefreshJob: {
          findUnique,
          create,
        },
      }) as any,
    );

    await repository.enqueueRefreshJobs([
      {
        jobType: "user_refresh",
        dedupeKey: "user:user-9",
        userId: "user-9",
        availableAt: new Date("2026-05-07T12:00:00.000Z"),
      },
    ]);

    expect(create).toHaveBeenCalledWith({
      data: {
        id: "generated-id-1",
        jobType: "user_refresh",
        dedupeKey: "user:user-9",
        userId: "user-9",
        segmentType: null,
        segmentValue: null,
        availableAt: new Date("2026-05-07T12:00:00.000Z"),
      },
    });
  });

  it("upserts popular recommendation snapshots with normalized dates", async () => {
    const upsert = jest.fn(async () => undefined);
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({
        popularRecommendationSnapshot: {
          upsert,
        },
      }) as any,
    );

    await repository.upsertPopularRecommendationSnapshot({
      segmentType: "family",
      segmentValue: "place",
      generatedAt: "2026-05-11T12:00:00.000Z",
      sourceLastSignalAt: "2026-05-10T12:00:00.000Z",
      candidateCount: 2,
      candidates: [
        {
          postingId: "posting-1",
          score: 0.9,
          reasonCodes: ["popular"],
        },
      ],
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        segmentType_segmentValue: {
          segmentType: "family",
          segmentValue: "place",
        },
      },
      update: {
        generatedAt: new Date("2026-05-11T12:00:00.000Z"),
        sourceLastSignalAt: new Date("2026-05-10T12:00:00.000Z"),
        candidateCount: 2,
        candidates: [
          {
            postingId: "posting-1",
            score: 0.9,
            reasonCodes: ["popular"],
          },
        ],
      },
      create: {
        id: "generated-id-1",
        segmentType: "family",
        segmentValue: "place",
        generatedAt: new Date("2026-05-11T12:00:00.000Z"),
        sourceLastSignalAt: new Date("2026-05-10T12:00:00.000Z"),
        candidateCount: 2,
        candidates: [
          {
            postingId: "posting-1",
            score: 0.9,
            reasonCodes: ["popular"],
          },
        ],
      },
    });
  });

  it("creates empty signal count records for all tracked event types", () => {
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({}) as any,
    );

    expect(repository.createEmptySignalCounts()).toEqual({
      posting_view: 0,
      search_click: 0,
      booking_request_created: 0,
      renting_confirmed: 0,
    });
  });

  it("upserts user artifacts and deletes stale snapshots when the user is not qualified", async () => {
    const profileUpsert = jest.fn(async () => undefined);
    const snapshotDeleteMany = jest.fn(async () => undefined);
    const snapshotUpsert = jest.fn(async () => undefined);
    const database = createDatabaseMock({
      userRecommendationProfile: {
        upsert: profileUpsert,
      },
      userRecommendationSnapshot: {
        deleteMany: snapshotDeleteMany,
        upsert: snapshotUpsert,
      },
    });
    const repository = new RecommendationPrecomputeRepository(
      database as any,
    );

    await repository.upsertUserRecommendationArtifacts({
      profile: {
        userId: "user-3",
        qualified: false,
        activityWindowStartAt: "2026-02-06T12:00:00.000Z",
        distinctPostingCount: 1,
        signalCounts: {
          posting_view: 1,
          search_click: 0,
          booking_request_created: 0,
          renting_confirmed: 0,
        },
        familyAffinities: [],
        subtypeAffinities: [],
        tagAffinities: [],
        rebuiltAt: "2026-05-07T12:00:00.000Z",
      },
    });

    expect(profileUpsert).toHaveBeenCalledTimes(1);
    expect(snapshotDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-3",
      },
    });
    expect(snapshotUpsert).not.toHaveBeenCalled();
  });

  it("re-enqueues processed jobs but leaves in-flight jobs claimed", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        dedupeKey: "popular:global",
        processedAt: new Date("2026-05-07T11:00:00.000Z"),
        processingAt: null,
        availableAt: new Date("2026-05-07T11:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        dedupeKey: "popular:family:place",
        processedAt: null,
        processingAt: new Date("2026-05-07T12:00:00.000Z"),
        availableAt: new Date("2026-05-07T12:00:00.000Z"),
      });
    const create = jest.fn(async () => undefined);
    const update = jest.fn(async () => undefined);
    const repository = new RecommendationPrecomputeRepository(
      createDatabaseMock({
        recommendationRefreshJob: {
          findUnique,
          create,
          update,
        },
      }) as any,
    );

    await repository.enqueueRefreshJobs([
      {
        jobType: "popular_refresh",
        dedupeKey: "popular:global",
        segmentType: "global",
        segmentValue: "global",
        availableAt: new Date("2026-05-07T12:00:00.000Z"),
      },
      {
        jobType: "popular_refresh",
        dedupeKey: "popular:family:place",
        segmentType: "family",
        segmentValue: "place",
        availableAt: new Date("2026-05-07T12:05:00.000Z"),
      },
    ]);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          dedupeKey: "popular:global",
        },
        data: expect.objectContaining({
          processedAt: null,
          processingAt: null,
          attempts: 0,
        }),
      }),
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          dedupeKey: "popular:family:place",
        },
        data: expect.not.objectContaining({
          processingAt: null,
        }),
      }),
    );
  });
});

function createDatabaseMock(
  delegates: Record<string, Record<string, unknown>>,
) {
  const transactionClient = {
    ...delegates,
  };

  return {
    ...delegates,
    $transaction: async (
      callback: (transaction: typeof transactionClient) => Promise<unknown>,
    ) => callback(transactionClient),
  };
}
