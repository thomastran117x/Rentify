import { RecommendationPrecomputeRepository } from "@/features/recommendations/recommendation-precompute.repository";

describe("RecommendationPrecomputeRepository", () => {
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
      }) as never,
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
      }) as never,
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
      database as never,
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
      }) as never,
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
