import { PostingsRepository } from "@/features/postings/postings.repository";
import type { SearchPostingsInput } from "@/features/postings/postings.model";

function sqlText(arg: unknown): string {
  const value = arg as { strings?: string[]; text?: string };

  if (value?.strings) {
    return value.strings.join(" ");
  }

  return value?.text ?? String(arg);
}

/**
 * Captures the raw SQL the fallback builds. The where clause is assembled from
 * tagged templates, so the interpolated values live outside the text: these
 * assertions check that the predicate is present at all, which is exactly what
 * was missing for the three filters below.
 */
function createRepository() {
  const seenSql: string[] = [];
  const queryRaw = jest.fn(async (arg: unknown) => {
    const text = sqlText(arg);
    seenSql.push(text);

    return text.includes("COUNT(*)") ? [{ total: 0 }] : [];
  });

  return {
    seenSql,
    repository: new PostingsRepository({ $queryRaw: queryRaw } as never),
  };
}

function createInput(
  overrides: Partial<SearchPostingsInput> = {},
): SearchPostingsInput {
  return {
    page: 1,
    pageSize: 20,
    sort: "newest",
    ...overrides,
  };
}

describe("PostingsRepository.searchPublicFallback filter parity", () => {
  // These three filters reach Elasticsearch but were silently dropped by the
  // SQL fallback. An interactive searcher can see that for themselves; the
  // saved-search sweep cannot, and would email matches that do not match.
  it("applies the cancellation policy filter", async () => {
    const { repository, seenSql } = createRepository();

    await repository.searchPublicFallback(
      createInput({ cancellationPolicy: "flexible" }),
    );

    expect(seenSql.join(" ")).toContain("cancellation_policy");
  });

  it("applies the instant booking filter", async () => {
    const { repository, seenSql } = createRepository();

    await repository.searchPublicFallback(
      createInput({ instantBooking: true }),
    );

    expect(seenSql.join(" ")).toContain("instant_booking");
  });

  it("treats a posting with no minimum duration as satisfying any ceiling", async () => {
    // Matches the Elasticsearch rule, which is a `should` over the range plus
    // a missing-field clause: no minimum set means any requested ceiling is met.
    const { repository, seenSql } = createRepository();

    await repository.searchPublicFallback(
      createInput({ maxMinBookingDurationDays: 3 }),
    );

    const combined = seenSql.join(" ");

    expect(combined).toContain("min_booking_duration_days IS NULL");
    expect(combined).toContain("min_booking_duration_days <=");
  });

  it("leaves the three predicates out when the filters are absent", async () => {
    const { repository, seenSql } = createRepository();

    await repository.searchPublicFallback(createInput({ query: "kayak" }));

    const combined = seenSql.join(" ");

    expect(combined).not.toContain("cancellation_policy");
    expect(combined).not.toContain("instant_booking");
    expect(combined).not.toContain("min_booking_duration_days");
  });
});
