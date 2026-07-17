import { RecommendationPrecomputeService } from "@/features/recommendations/recommendation-precompute.service";

describe("RecommendationPrecomputeService", () => {
  it("marks users with insufficient activity as unqualified and omits the personalized snapshot", async () => {
    const repository = createRepositoryMock({
      claimRefreshJobBatch: jest.fn(async () => [
        createUserRefreshJob("user-1"),
      ]),
      listPublishedPopularSegments: jest.fn(async () => []),
      listPopularSnapshotFreshness: jest.fn(async () => []),
      enqueueRefreshJobs: jest.fn(async () => undefined),
      listUserActivityRows: jest.fn(async () => [
        createActivity({
          postingId: "posting-1",
          eventType: "posting_view",
          family: "equipment",
          subtype: "camera",
          tags: ["dslr"],
        }),
      ]),
      listPopularActivityRows: jest.fn(async () => []),
      listPublishedRecommendationCandidates: jest.fn(async () => []),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    const processed = await service.processBatch(10);

    expect(processed).toBe(1);
    expect(repository.upsertUserRecommendationArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          userId: "user-1",
          qualified: false,
          distinctPostingCount: 1,
        }),
      }),
    );
    expect(
      repository.upsertUserRecommendationArtifacts,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.anything(),
      }),
    );
    expect(repository.markRefreshJobProcessed).toHaveBeenCalledWith(
      "job-user-1",
    );
  });

  it("prefers stronger tag matches in personalized snapshots", async () => {
    const repository = createRepositoryMock({
      claimRefreshJobBatch: jest.fn(async () => [
        createUserRefreshJob("user-2"),
      ]),
      listPublishedPopularSegments: jest.fn(async () => []),
      listPopularSnapshotFreshness: jest.fn(async () => []),
      enqueueRefreshJobs: jest.fn(async () => undefined),
      listUserActivityRows: jest.fn(async () => [
        createActivity({
          postingId: "source-1",
          eventType: "posting_view",
          family: "equipment",
          subtype: "camera",
          tags: ["dslr", "canon"],
        }),
        createActivity({
          postingId: "source-2",
          eventType: "search_click",
          family: "equipment",
          subtype: "camera",
          tags: ["dslr", "mirrorless"],
        }),
      ]),
      listPopularActivityRows: jest.fn(async () => [
        createActivity({
          postingId: "candidate-a",
          eventType: "posting_view",
          family: "equipment",
          subtype: "camera",
          tags: ["dslr"],
        }),
        createActivity({
          postingId: "candidate-b",
          eventType: "posting_view",
          family: "equipment",
          subtype: "camera",
          tags: ["tripod"],
        }),
      ]),
      listPublishedRecommendationCandidates: jest.fn().mockResolvedValueOnce([
        createCandidate({
          id: "candidate-a",
          family: "equipment",
          subtype: "camera",
          tags: ["dslr", "mirrorless"],
        }),
        createCandidate({
          id: "candidate-b",
          family: "equipment",
          subtype: "camera",
          tags: ["tripod"],
        }),
      ]),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    await service.processBatch(10);

    const snapshotInput =
      (repository.upsertUserRecommendationArtifacts.mock.calls[0] as any)?.[0]?.snapshot;
    expect(snapshotInput.candidates[0].postingId).toBe("candidate-a");
    expect(snapshotInput.candidates[0].reasonCodes).toEqual(
      expect.arrayContaining([
        "matched_tag",
        "matched_subtype",
        "matched_family",
      ]),
    );
  });

  it("qualifies booking-heavy users even with one distinct posting", async () => {
    const repository = createRepositoryMock({
      claimRefreshJobBatch: jest.fn(async () => [
        createUserRefreshJob("user-3"),
      ]),
      listPublishedPopularSegments: jest.fn(async () => []),
      listPopularSnapshotFreshness: jest.fn(async () => []),
      enqueueRefreshJobs: jest.fn(async () => undefined),
      listUserActivityRows: jest.fn(async () => [
        createActivity({
          postingId: "posting-strong",
          eventType: "booking_request_created",
          family: "vehicle",
          subtype: "car",
          tags: ["automatic"],
        }),
      ]),
      listPopularActivityRows: jest.fn(async () => []),
      listPublishedRecommendationCandidates: jest.fn(async () => [
        createCandidate({
          id: "candidate-strong",
          family: "vehicle",
          subtype: "car",
          tags: ["automatic"],
        }),
      ]),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    await service.processBatch(10);

    expect(repository.upsertUserRecommendationArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          qualified: true,
          distinctPostingCount: 1,
          signalCounts: expect.objectContaining({
            booking_request_created: 1,
          }),
        }),
        snapshot: expect.objectContaining({
          candidateCount: 1,
        }),
      }),
    );
  });

  it("de-prioritizes previously viewed postings without removing them", async () => {
    const repository = createRepositoryMock({
      claimRefreshJobBatch: jest.fn(async () => [
        createUserRefreshJob("user-4"),
      ]),
      listPublishedPopularSegments: jest.fn(async () => []),
      listPopularSnapshotFreshness: jest.fn(async () => []),
      enqueueRefreshJobs: jest.fn(async () => undefined),
      listUserActivityRows: jest.fn(async () => [
        createActivity({
          postingId: "viewed-candidate",
          eventType: "posting_view",
          family: "place",
          subtype: "entire_place",
          tags: ["lakefront"],
        }),
        createActivity({
          postingId: "source-other",
          eventType: "search_click",
          family: "place",
          subtype: "entire_place",
          tags: ["lakefront"],
        }),
      ]),
      listPopularActivityRows: jest.fn(async () => [
        createActivity({
          postingId: "viewed-candidate",
          eventType: "posting_view",
          family: "place",
          subtype: "entire_place",
          tags: ["lakefront"],
        }),
        createActivity({
          postingId: "fresh-candidate",
          eventType: "posting_view",
          family: "place",
          subtype: "entire_place",
          tags: ["lakefront"],
        }),
      ]),
      listPublishedRecommendationCandidates: jest.fn(async () => [
        createCandidate({
          id: "viewed-candidate",
          family: "place",
          subtype: "entire_place",
          tags: ["lakefront"],
        }),
        createCandidate({
          id: "fresh-candidate",
          family: "place",
          subtype: "entire_place",
          tags: ["lakefront"],
        }),
      ]),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    await service.processBatch(10);

    const snapshotInput =
      (repository.upsertUserRecommendationArtifacts.mock.calls[0] as any)?.[0]?.snapshot;
    expect(
      snapshotInput.candidates.map(
        (candidate: { postingId: string }) => candidate.postingId,
      ),
    ).toEqual(["fresh-candidate", "viewed-candidate"]);
    expect(snapshotInput.candidates[1].reasonCodes).toEqual(
      expect.arrayContaining(["previously_viewed"]),
    );
  });

  it("rebuilds popular family_subtype snapshots against the requested segment", async () => {
    const repository = createRepositoryMock({
      claimRefreshJobBatch: jest.fn(async () => [
        createPopularRefreshJob("family_subtype", "place:entire_place"),
      ]),
      listPublishedPopularSegments: jest.fn(async () => []),
      listPopularSnapshotFreshness: jest.fn(async () => []),
      enqueueRefreshJobs: jest.fn(async () => undefined),
      listPopularActivityRows: jest.fn(async () => [
        createActivity({
          postingId: "place-1",
          eventType: "posting_view",
          family: "place",
          subtype: "entire_place",
          tags: ["downtown"],
        }),
        createActivity({
          postingId: "camera-1",
          eventType: "renting_confirmed",
          family: "equipment",
          subtype: "camera",
          tags: ["canon"],
        }),
      ]),
      listPublishedRecommendationCandidates: jest.fn(async () => [
        createCandidate({
          id: "place-1",
          family: "place",
          subtype: "entire_place",
          tags: ["downtown"],
        }),
      ]),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    await service.processBatch(10);

    expect(
      repository.listPublishedRecommendationCandidates,
    ).toHaveBeenCalledWith({
      family: "place",
      subtype: "entire_place",
    });
    expect(repository.upsertPopularRecommendationSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentType: "family_subtype",
        segmentValue: "place:entire_place",
        candidateCount: 1,
        candidates: [
          expect.objectContaining({
            postingId: "place-1",
          }),
        ],
      }),
    );
  });

  it("enqueues stale and missing popular snapshots during the worker sweep", async () => {
    const now = new Date("2026-05-07T12:00:00.000Z");
    const repository = createRepositoryMock({
      listPublishedPopularSegments: jest.fn(async () => [
        { segmentType: "global", segmentValue: "global" },
        { segmentType: "family", segmentValue: "place" },
        { segmentType: "family_subtype", segmentValue: "place:entire_place" },
      ]),
      listPopularSnapshotFreshness: jest.fn(async () => [
        {
          segmentType: "global",
          segmentValue: "global",
          generatedAt: "2026-05-07T11:30:00.000Z",
        },
        {
          segmentType: "family",
          segmentValue: "place",
          generatedAt: "2026-05-07T04:30:00.000Z",
        },
      ]),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    await service.enqueueMissingOrStalePopularJobs(now);

    expect(repository.enqueueRefreshJobs).toHaveBeenCalledWith([
      expect.objectContaining({
        dedupeKey: "popular:family:place",
        segmentType: "family",
        segmentValue: "place",
      }),
      expect.objectContaining({
        dedupeKey: "popular:family_subtype:place:entire_place",
        segmentType: "family_subtype",
        segmentValue: "place:entire_place",
      }),
    ]);
  });

  it("marks malformed user refresh jobs for retry when userId is missing", async () => {
    const repository = createRepositoryMock({
      claimRefreshJobBatch: jest.fn(async () => [
        {
          ...createUserRefreshJob("user-missing"),
          userId: undefined,
        },
      ]),
      listPublishedPopularSegments: jest.fn(async () => []),
      listPopularSnapshotFreshness: jest.fn(async () => []),
      enqueueRefreshJobs: jest.fn(async () => undefined),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    const processed = await service.processBatch(5);

    expect(processed).toBe(1);
    expect(repository.markRefreshJobProcessed).not.toHaveBeenCalled();
    expect(repository.markRefreshJobRetry).toHaveBeenCalledWith(
      "job-user-missing",
      1,
      "User recommendation refresh job is missing a userId.",
    );
  });

  it("marks unsupported refresh job types for retry", async () => {
    const repository = createRepositoryMock({
      claimRefreshJobBatch: jest.fn(async () => [
        {
          ...createUserRefreshJob("user-unsupported"),
          id: "job-unsupported",
          jobType: "unknown_refresh",
        },
      ]),
      listPublishedPopularSegments: jest.fn(async () => []),
      listPopularSnapshotFreshness: jest.fn(async () => []),
      enqueueRefreshJobs: jest.fn(async () => undefined),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    await service.processBatch(5);

    expect(repository.markRefreshJobRetry).toHaveBeenCalledWith(
      "job-unsupported",
      1,
      "Unsupported recommendation refresh job type: unknown_refresh",
    );
  });

  it("marks popular refresh jobs missing segment metadata for retry", async () => {
    const repository = createRepositoryMock({
      claimRefreshJobBatch: jest.fn(async () => [
        {
          ...createPopularRefreshJob("family", "place"),
          id: "job-missing-segment",
          segmentType: undefined,
          segmentValue: undefined,
        },
      ]),
      listPublishedPopularSegments: jest.fn(async () => []),
      listPopularSnapshotFreshness: jest.fn(async () => []),
      enqueueRefreshJobs: jest.fn(async () => undefined),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    await service.processBatch(5);

    expect(repository.markRefreshJobRetry).toHaveBeenCalledWith(
      "job-missing-segment",
      1,
      "Popular recommendation refresh job is missing segment metadata.",
    );
  });

  it("marks invalid family segments for retry", async () => {
    const repository = createRepositoryMock({
      claimRefreshJobBatch: jest.fn(async () => [
        {
          ...createPopularRefreshJob("family", "invalid-family"),
          id: "job-invalid-family",
          segmentValue: "invalid-family",
        },
      ]),
      listPublishedPopularSegments: jest.fn(async () => []),
      listPopularSnapshotFreshness: jest.fn(async () => []),
      enqueueRefreshJobs: jest.fn(async () => undefined),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    await service.processBatch(5);

    expect(repository.markRefreshJobRetry).toHaveBeenCalledWith(
      "job-invalid-family",
      1,
      "Invalid family recommendation segment: invalid-family",
    );
  });

  it("marks invalid family_subtype segments for retry", async () => {
    const repository = createRepositoryMock({
      claimRefreshJobBatch: jest.fn(async () => [
        {
          ...createPopularRefreshJob("family_subtype", "place:not-real"),
          id: "job-invalid-family-subtype",
          segmentValue: "place:not-real",
        },
      ]),
      listPublishedPopularSegments: jest.fn(async () => []),
      listPopularSnapshotFreshness: jest.fn(async () => []),
      enqueueRefreshJobs: jest.fn(async () => undefined),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    await service.processBatch(5);

    expect(repository.markRefreshJobRetry).toHaveBeenCalledWith(
      "job-invalid-family-subtype",
      1,
      "Invalid family_subtype recommendation segment: place:not-real",
    );
  });

  it("falls back to a generic retry message for non-Error failures", async () => {
    const repository = createRepositoryMock({
      claimRefreshJobBatch: jest.fn(async () => [
        createUserRefreshJob("user-unknown-error"),
      ]),
      listPublishedPopularSegments: jest.fn(async () => []),
      listPopularSnapshotFreshness: jest.fn(async () => []),
      enqueueRefreshJobs: jest.fn(async () => undefined),
      listUserActivityRows: jest.fn(async () => {
        throw "boom";
      }),
    });
    const service = new RecommendationPrecomputeService(repository as any);

    await service.processBatch(5);

    expect(repository.markRefreshJobRetry).toHaveBeenCalledWith(
      "job-user-unknown-error",
      1,
      "Unknown recommendation precompute error.",
    );
  });
});

function createRepositoryMock(overrides: Record<string, unknown>) {
  return {
    claimRefreshJobBatch: jest.fn(async () => []),
    markRefreshJobProcessed: jest.fn(async () => undefined),
    markRefreshJobRetry: jest.fn(async () => undefined),
    listPublishedPopularSegments: jest.fn(async () => []),
    listPopularSnapshotFreshness: jest.fn(async () => []),
    enqueueRefreshJobs: jest.fn(async () => undefined),
    listUserActivityRows: jest.fn(async () => []),
    listPopularActivityRows: jest.fn(async () => []),
    listPublishedRecommendationCandidates: jest.fn(async () => []),
    upsertUserRecommendationArtifacts: jest.fn(async () => undefined),
    upsertPopularRecommendationSnapshot: jest.fn(async () => undefined),
    createEmptySignalCounts: jest.fn(() => ({
      posting_view: 0,
      search_click: 0,
      booking_request_created: 0,
      renting_confirmed: 0,
    })),
    ...overrides,
  };
}

function createUserRefreshJob(userId: string) {
  return {
    id: `job-${userId}`,
    jobType: "user_refresh" as const,
    userId,
    attempts: 0,
    availableAt: "2026-05-07T12:00:00.000Z",
    createdAt: "2026-05-07T12:00:00.000Z",
    updatedAt: "2026-05-07T12:00:00.000Z",
  };
}

function createPopularRefreshJob(
  segmentType: "global" | "family" | "family_subtype",
  segmentValue: string,
) {
  return {
    id: `job-${segmentType}-${segmentValue}`,
    jobType: "popular_refresh" as const,
    segmentType,
    segmentValue,
    attempts: 0,
    availableAt: "2026-05-07T12:00:00.000Z",
    createdAt: "2026-05-07T12:00:00.000Z",
    updatedAt: "2026-05-07T12:00:00.000Z",
  };
}

function createActivity(input: {
  postingId: string;
  eventType:
    | "posting_view"
    | "search_click"
    | "booking_request_created"
    | "renting_confirmed";
  family: "place" | "equipment" | "vehicle";
  subtype: "entire_place" | "camera" | "car";
  tags: string[];
}) {
  return {
    ...input,
    count: 1,
    lastOccurredAt: "2026-05-06T12:00:00.000Z",
  };
}

function createCandidate(input: {
  id: string;
  family: "place" | "equipment" | "vehicle";
  subtype: "entire_place" | "camera" | "car";
  tags: string[];
}) {
  return {
    ...input,
    ownerId: `owner-${input.id}`,
    availabilityStatus: "available" as const,
    publishedAt: "2026-05-07T10:00:00.000Z",
  };
}
