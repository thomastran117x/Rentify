import {
  listPostingAnalyticsQuerySchema,
  postingAnalyticsDetailQuerySchema,
  postingAnalyticsSummaryQuerySchema,
} from "@/features/postings/analytics/analytics.model";

describe("postings.analytics.model", () => {
  it("applies analytics query defaults", () => {
    expect(postingAnalyticsSummaryQuerySchema.parse({})).toEqual({
      window: "7d",
    });

    expect(postingAnalyticsDetailQuerySchema.parse({})).toEqual({
      window: "7d",
      granularity: "day",
    });
  });

  it("coerces analytics list pagination and enforces page size bounds", () => {
    expect(
      listPostingAnalyticsQuerySchema.parse({
        window: "30d",
        page: "2",
        pageSize: "10",
      }),
    ).toEqual({
      window: "30d",
      page: 2,
      pageSize: 10,
    });

    const result = listPostingAnalyticsQuerySchema.safeParse({
      pageSize: "999",
    });

    expect(result.success).toBe(false);
  });
});
