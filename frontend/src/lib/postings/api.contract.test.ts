import { beforeEach, describe, expect, it, vi } from "vitest";
import { postingsApi } from "./api";

const { authenticatedMock, publicMock, optionalMock, pathMock } = vi.hoisted(
  () => ({
    authenticatedMock: vi.fn(),
    publicMock: vi.fn(),
    optionalMock: vi.fn(),
    pathMock: vi.fn(
      (path: string, query: Record<string, unknown>) =>
        `${path}?${new URLSearchParams(
          Object.entries(query)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, String(value)]),
        ).toString()}`,
    ),
  }),
);
vi.mock("@/lib/api/client", () => ({
  authenticatedJson: authenticatedMock,
  publicJson: publicMock,
  optionalAuthJson: optionalMock,
  buildPathWithQuery: pathMock,
}));

describe("postingsApi", () => {
  beforeEach(() => vi.clearAllMocks());
  const id = "post / 1";

  it("covers owner posting lifecycle, list, batch, and analytics endpoints", () => {
    postingsApi.create({} as never);
    postingsApi.listMine();
    postingsApi.listMine({
      page: 2,
      pageSize: 50,
      status: "published",
      q: " camera ",
    });
    postingsApi.getStatusSummary();
    postingsApi.batchMine(["a", "b"]);
    postingsApi.update(id, {} as never);
    postingsApi.duplicate(id);
    postingsApi.publish(id);
    postingsApi.pausePosting(id);
    postingsApi.unpausePosting(id);
    postingsApi.archive(id);
    postingsApi.getOwnerAnalyticsSummary("30d");
    postingsApi.listOwnerAnalytics({ window: "30d", page: 2 });
    postingsApi.getAnalyticsDetail(id, { window: "7d", granularity: "day" });
    expect(authenticatedMock).toHaveBeenCalledWith("POST", "/postings", {});
    expect(authenticatedMock).toHaveBeenCalledWith(
      "GET",
      "/postings/me?page=1&pageSize=20",
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "GET",
      "/postings/me?page=2&pageSize=50&status=published&q=camera",
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "POST",
      "/postings/post%20%2F%201/archive",
      {},
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "GET",
      "/postings/post%20%2F%201/analytics?window=7d&granularity=day",
    );
  });

  it("covers public discovery, reviews, availability, recommendations, and booking quote calls", async () => {
    postingsApi.getPosting(id);
    postingsApi.searchPublic({ q: "camera" } as never);
    postingsApi.autocomplete({ q: "cam" } as never);
    postingsApi.listRecommendations();
    postingsApi.batchPublic(["a", "b"]);
    postingsApi.trackSearchClick(id, {} as never);
    postingsApi.listReviews(id);
    postingsApi.getOwnReview(id);
    postingsApi.createReview(id, {} as never);
    postingsApi.updateOwnReview(id, {} as never);
    postingsApi.listAvailabilityBlocks(id);
    postingsApi.createAvailabilityBlock(id, {} as never);
    postingsApi.updateAvailabilityBlock(id, "block / 1", {} as never);
    await postingsApi.deleteAvailabilityBlock(id, "block / 1");
    postingsApi.quoteBooking(id, {} as never);
    expect(optionalMock).toHaveBeenCalledWith(
      "GET",
      "/postings/post%20%2F%201",
    );
    expect(publicMock).toHaveBeenCalledWith("GET", "/postings?q=camera");
    expect(optionalMock).toHaveBeenCalledWith(
      "GET",
      "/postings/recommendations?page=1&pageSize=20",
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "DELETE",
      "/postings/post%20%2F%201/availability-blocks/block%20%2F%201",
    );
  });

  it("covers seasonal pricing operations", () => {
    const rule = {
      name: "Summer",
      startDate: "2026-06-01",
      endDate: "2026-08-31",
      dailyAmount: 100,
    };
    postingsApi.listSeasonalPricing(id);
    postingsApi.createSeasonalPricingRule(id, rule);
    postingsApi.updateSeasonalPricingRule(id, "rule / 1", rule);
    postingsApi.deleteSeasonalPricingRule(id, "rule / 1");
    expect(authenticatedMock).toHaveBeenCalledWith(
      "GET",
      "/postings/post%20%2F%201/seasonal-pricing",
    );
    expect(authenticatedMock).toHaveBeenCalledWith(
      "PATCH",
      "/postings/post%20%2F%201/seasonal-pricing/rule%20%2F%201",
      rule,
    );
  });
});
