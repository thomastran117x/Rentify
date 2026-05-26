import {
  createContentReportRequestSchema,
  listContentReportsQuerySchema,
  updateContentReportStatusRequestSchema,
} from "@/features/reports/reports.model";

describe("reports.model", () => {
  it("trims report content and applies moderation list defaults", () => {
    expect(
      createContentReportRequestSchema.parse({
        subjectType: "posting",
        subjectId: "posting-1",
        reasonCode: "spam",
        title: "  Misleading listing  ",
        description: "  This listing is trying to move payment off-platform.  ",
      }),
    ).toEqual({
      subjectType: "posting",
      subjectId: "posting-1",
      reasonCode: "spam",
      title: "Misleading listing",
      description: "This listing is trying to move payment off-platform.",
    });

    expect(listContentReportsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: "newest",
    });
  });

  it("requires a resolution code when a report is resolved or dismissed", () => {
    const result = updateContentReportStatusRequestSchema.safeParse({
      status: "resolved",
      resolutionSummary: "Action taken.",
    });

    expect(result.success).toBe(false);
  });
});
