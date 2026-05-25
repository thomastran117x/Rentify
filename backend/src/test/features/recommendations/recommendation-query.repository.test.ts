import { RecommendationQueryRepository } from "@/features/recommendations/recommendation-query.repository";

interface CapturedSql {
  sql: string;
  values: unknown[];
}

describe("RecommendationQueryRepository", () => {
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
      }) as never,
    );

    const excludedIds =
      await repository.listExcludedPostingIdsForUser("user-1");

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
      }) as never,
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
    ...delegates,
  };
}
