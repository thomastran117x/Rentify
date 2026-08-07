import { beforeEach, describe, expect, it, vi } from "vitest";
import { moderationApi } from "./api";

const { requestMock, pathMock } = vi.hoisted(() => ({ requestMock: vi.fn(), pathMock: vi.fn((path: string, query: Record<string, unknown>) => `${path}?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString()}`) }));
vi.mock("@/lib/api/client", () => ({ authenticatedJson: requestMock, buildPathWithQuery: pathMock }));

describe("moderationApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates reports and lists them with defaults or supplied filters", () => {
    const report = { subjectType: "posting" as const, subjectId: "posting-1", reasonCode: "spam" as const, title: "Spam", description: "Repeated messages" };
    moderationApi.createReport(report); moderationApi.listReports();
    moderationApi.listReports({ q: "spam", status: "under_review", subjectType: "user", reasonCode: "harassment_or_hate", assignedTo: "mod-1", reporterId: "user-1", page: 3, pageSize: 50, sort: "recentlyReviewed" });
    expect(requestMock).toHaveBeenCalledWith("POST", "/reports", report);
    expect(requestMock).toHaveBeenCalledWith("GET", "/moderation/reports?page=1&pageSize=20&sort=newest");
    expect(requestMock).toHaveBeenCalledWith("GET", "/moderation/reports?q=spam&status=under_review&subjectType=user&reasonCode=harassment_or_hate&assignedTo=mod-1&reporterId=user-1&page=3&pageSize=50&sort=recentlyReviewed");
  });

  it("gets, assigns, and resolves encoded report ids", () => {
    moderationApi.getReport("report / 1"); moderationApi.assignReport("report / 1", { assignedModeratorId: "mod-1" }); moderationApi.updateStatus("report / 1", { status: "resolved", resolutionCode: "action_taken", resolutionSummary: "Removed", note: "Reviewed" });
    expect(requestMock).toHaveBeenCalledWith("GET", "/moderation/reports/report%20%2F%201");
    expect(requestMock).toHaveBeenCalledWith("POST", "/moderation/reports/report%20%2F%201/assignment", { assignedModeratorId: "mod-1" });
    expect(requestMock).toHaveBeenCalledWith("POST", "/moderation/reports/report%20%2F%201/status", expect.objectContaining({ status: "resolved", resolutionCode: "action_taken" }));
  });
});
