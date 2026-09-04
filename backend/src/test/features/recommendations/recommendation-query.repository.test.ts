import { RecommendationQueryRepository } from "@/features/recommendations/recommendation-query.repository";
import { testUuid } from "../../support/uuid";

const USER_1_ID = testUuid(9000, 994257);
const USER_2_ID = testUuid(9000, 994258);

interface CapturedSql {
  sql: string;
  values: unknown[];
}

describe("RecommendationQueryRepository", () => {
  it("maps personalization context records and defaults the toggle to enabled", async () => {
    const repository = new RecommendationQueryRepository(
      createDatabaseMock({
        profile: {
          findUnique: jest
            .fn(async () => ({
              recommendationPersonalizationEnabled: false,
            }))
            .mockResolvedValueOnce({
              recommendationPersonalizationEnabled: false,
            })
            .mockResolvedValueOnce(null as any),
        },
        userRecommendationProfile: {
          findUnique: jest.fn(async () => ({
            userId: USER_1_ID,
            qualified: true,
            activityWindowStartAt: new Date("2026-05-01T00:00:00.000Z"),
            lastSignalAt: new Date("2026-05-10T00:00:00.000Z"),
            distinctPostingCount: 3,
            signalCounts: {
              posting_view: 2,
              search_click: 1,
            },
            familyAffinities: [{ value: "place", score: 0.8 }],
            subtypeAffinities: [{ value: "studio", score: 0.7 }],
            tagAffinities: [{ value: "wifi", score: 0.6 }],
            rebuiltAt: new Date("2026-05-11T00:00:00.000Z"),
          })),
        },
        userRecommendationSnapshot: {
          findUnique: jest.fn(async () => ({
            userId: USER_1_ID,
            generatedAt: new Date("2026-05-12T00:00:00.000Z"),
            sourceLastSignalAt: new Date("2026-05-10T00:00:00.000Z"),
            candidateCount: 2,
            candidates: [
              {
                postingId: "posting-1",
                score: "0.75",
                reasonCodes: ["family_affinity"],
              },
              {
                postingId: "",
                score: 0.1,
                reasonCodes: ["ignored"],
              },
            ],
          })),
        },
      }) as any,
    );

    const context = await repository.getPersonalizationContext(USER_1_ID);
    const defaultedContext =
      await repository.getPersonalizationContext(USER_2_ID);

    expect(context).toEqual({
      recommendationPersonalizationEnabled: false,
      profile: {
        userId: USER_1_ID,
        qualified: true,
        activityWindowStartAt: "2026-05-01T00:00:00.000Z",
        lastSignalAt: "2026-05-10T00:00:00.000Z",
        distinctPostingCount: 3,
        signalCounts: {
          posting_view: 2,
          search_click: 1,
          booking_request_created: 0,
          renting_confirmed: 0,
        },
        familyAffinities: [{ value: "place", score: 0.8 }],
        subtypeAffinities: [{ value: "studio", score: 0.7 }],
        tagAffinities: [{ value: "wifi", score: 0.6 }],
        rebuiltAt: "2026-05-11T00:00:00.000Z",
      },
      snapshot: {
        userId: USER_1_ID,
        generatedAt: "2026-05-12T00:00:00.000Z",
        sourceLastSignalAt: "2026-05-10T00:00:00.000Z",
        candidateCount: 2,
        candidates: [
          {
            postingId: "posting-1",
            score: 0.75,
            reasonCodes: ["family_affinity"],
          },
        ],
      },
    });
    expect(defaultedContext.recommendationPersonalizationEnabled).toBe(true);
  });

  it("maps popular recommendation snapshots and empty availability windows", async () => {
    const $queryRaw = jest.fn(async () => []);
    const repository = new RecommendationQueryRepository(
      createDatabaseMock({
        popularRecommendationSnapshot: {
          findUnique: jest.fn(async () => ({
            segmentType: "region" as any,
            segmentValue: "toronto",
            generatedAt: new Date("2026-05-12T00:00:00.000Z"),
            sourceLastSignalAt: null,
            candidateCount: 1,
            candidates: [
              {
                postingId: "posting-2",
                score: 0.55,
                reasonCodes: ["popular"],
              },
            ],
          })),
        },
        $queryRaw,
      }) as any,
    );

    await expect(
      repository.getPopularSnapshot("region" as any, "toronto"),
    ).resolves.toEqual({
      segmentType: "region",
      segmentValue: "toronto",
      generatedAt: "2026-05-12T00:00:00.000Z",
      sourceLastSignalAt: undefined,
      candidateCount: 1,
      candidates: [
        {
          postingId: "posting-2",
          score: 0.55,
          reasonCodes: ["popular"],
        },
      ],
    });
    await expect(
      repository.filterCandidateIdsByAvailabilityWindow({
        candidateIds: [],
        startAt: new Date("2026-05-09T00:00:00.000Z"),
        endAt: new Date("2026-05-10T00:00:00.000Z"),
      }),
    ).resolves.toEqual([]);
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it("returns only own, active-booking, and confirmed-renting posting ids for exclusions", async () => {
    const repository = new RecommendationQueryRepository(
      createDatabaseMock({
        posting: {
          findMany: jest.fn(async () => [{ id: "own-posting" }]),
        },
        bookingRequest: {
          findMany: jest.fn(async () => [
            { postingId: "active-booking-posting" },
            { postingId: "active-booking-posting" },
          ]),
        },
        renting: {
          findMany: jest.fn(async () => [
            { postingId: "confirmed-renting-posting" },
          ]),
        },
      }) as any,
    );

    const excludedIds =
      await repository.listExcludedPostingIdsForUser(USER_1_ID);

    expect(Array.from(excludedIds)).toEqual([
      "own-posting",
      "active-booking-posting",
      "confirmed-renting-posting",
    ]);
  });

  it("filters candidate ids with the same overlap rules as fallback search and preserves rank order", async () => {
    const queries: CapturedSql[] = [];
    const repository = new RecommendationQueryRepository(
      createDatabaseMock({
        $queryRaw: jest.fn(
          async (query: { sql: string; values: unknown[] }) => {
            queries.push({
              sql: query.sql,
              values: query.values,
            });

            return [{ id: "candidate-3" }, { id: "candidate-1" }];
          },
        ),
      }) as any,
    );

    const eligibleIds = await repository.filterCandidateIdsByAvailabilityWindow(
      {
        candidateIds: ["candidate-1", "candidate-2", "candidate-3"],
        startAt: new Date("2026-05-09T00:00:00.000Z"),
        endAt: new Date("2026-05-10T00:00:00.000Z"),
      },
    );

    expect(eligibleIds).toEqual(["candidate-1", "candidate-3"]);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain("postings.id IN");
    expect(queries[0]?.sql).toContain("pab.start_at < ?");
    expect(queries[0]?.sql).toContain("pab.end_at > ?");
    expect(queries[0]?.sql).toContain(
      "br.status IN ('awaiting_payment', 'payment_processing', 'paid')",
    );
    expect(queries[0]?.sql).toContain(
      "br.status IN ('pending', 'awaiting_payment', 'payment_processing', 'paid')",
    );
    expect(queries[0]?.sql).toContain("r.start_at < ?");
    expect(queries[0]?.sql).toContain("r.end_at > ?");
    expect(queries[0]?.values).toEqual(
      expect.arrayContaining([
        "candidate-1",
        "candidate-2",
        "candidate-3",
        new Date("2026-05-10T00:00:00.000Z"),
        new Date("2026-05-09T00:00:00.000Z"),
      ]),
    );
  });
});

function createDatabaseMock(delegates: Record<string, unknown>) {
  return {
    profile: {
      findUnique: jest.fn(async () => null),
      ...(delegates.profile as object),
    },
    userRecommendationProfile: {
      findUnique: jest.fn(async () => null),
      ...(delegates.userRecommendationProfile as object),
    },
    userRecommendationSnapshot: {
      findUnique: jest.fn(async () => null),
      ...(delegates.userRecommendationSnapshot as object),
    },
    popularRecommendationSnapshot: {
      findUnique: jest.fn(async () => null),
      ...(delegates.popularRecommendationSnapshot as object),
    },
    ...delegates,
  };
}
