import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDeviceIdMock = vi.fn();
const getDevicePlatformMock = vi.fn();
const readStoredSessionMock = vi.fn();

vi.mock("@/lib/auth/device", () => ({
  getDeviceId: getDeviceIdMock,
  getDevicePlatform: getDevicePlatformMock,
}));

vi.mock("@/lib/auth/storage", () => ({
  readStoredSession: readStoredSessionMock,
}));

describe("postingsAnalyticsApi", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    getDeviceIdMock.mockReturnValue("device-1");
    getDevicePlatformMock.mockReturnValue("web");
    readStoredSessionMock.mockReturnValue({
      accessToken: "analytics-access-token",
      device: {
        known: true,
        knownByIp: false,
      },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "owner",
      },
    });
    document.cookie = "csrf_token=analytics-csrf-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches owner analytics summaries with query params and headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          message: "ok",
          data: {
            window: "30d",
            totals: {
              searchImpressions: 100,
              searchClicks: 20,
              views: 15,
              uniqueViews: 12,
              bookingRequests: 4,
              approvedRequests: 3,
              declinedRequests: 1,
              expiredRequests: 0,
              cancelledRequests: 0,
              paymentFailedRequests: 0,
              confirmedBookings: 2,
              estimatedConfirmedRevenue: 400,
              refundedRevenue: 0,
              activeDaysPublished: 30,
              calendarBlockedDays: 2,
              confirmedBookedDays: 6,
            },
            derivedMetrics: {
              ctr: 0.2,
              viewToRequestRate: 0.26,
              clickToRequestRate: 0.2,
              requestToApprovalRate: 0.75,
              requestToConfirmedRate: 0.5,
              utilizationRate: 0.2,
              averageRevenuePerConfirmedBooking: 200,
            },
            dataAvailability: {
              searchImpressions: "live",
              searchClicks: "live",
              views: "live",
              bookingRequests: "live",
              requestOutcomes: "live",
              confirmedBookings: "live",
              revenue: "live",
              isPartial: false,
            },
            range: {
              endAt: "2026-05-24T00:00:00.000Z",
            },
          },
          error: null,
          meta: {
            requestId: "request-1",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { postingsAnalyticsApi } = await import("./analytics");
    const result = await postingsAnalyticsApi.getOwnerSummary("30d");

    expect(result.window).toBe("30d");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/postings/analytics/summary?window=30d",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer analytics-access-token",
          "x-csrf-token": "analytics-csrf-token",
          "x-device-id": "device-1",
          "x-device-platform": "web",
        }),
      }),
    );
  });

  it("lists owner postings with default pagination", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          message: "ok",
          data: {
            window: "7d",
            postings: [],
            pagination: {
              page: 1,
              pageSize: 20,
              total: 0,
              totalPages: 0,
              hasNextPage: false,
              hasPreviousPage: false,
            },
            dataAvailability: {
              searchImpressions: "live",
              searchClicks: "live",
              views: "live",
              bookingRequests: "live",
              requestOutcomes: "live",
              confirmedBookings: "live",
              revenue: "live",
              isPartial: false,
            },
            range: {
              endAt: "2026-05-24T00:00:00.000Z",
            },
          },
          error: null,
          meta: {
            requestId: "request-2",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { postingsAnalyticsApi } = await import("./analytics");
    await postingsAnalyticsApi.listOwnerPostings({ window: "7d" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/postings/analytics/postings?window=7d&page=1&pageSize=20",
      expect.any(Object),
    );
  });

  it("fetches posting detail and surfaces API errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              postingId: "posting-1",
              name: "Studio",
              status: "published",
              window: "7d",
              granularity: "day",
              totals: {
                searchImpressions: 10,
                searchClicks: 2,
                views: 4,
                uniqueViews: 4,
                bookingRequests: 1,
                approvedRequests: 1,
                declinedRequests: 0,
                expiredRequests: 0,
                cancelledRequests: 0,
                paymentFailedRequests: 0,
                confirmedBookings: 1,
                estimatedConfirmedRevenue: 250,
                refundedRevenue: 0,
                activeDaysPublished: 7,
                calendarBlockedDays: 0,
                confirmedBookedDays: 2,
              },
              derivedMetrics: {
                ctr: 0.2,
                viewToRequestRate: 0.25,
                clickToRequestRate: 0.5,
                requestToApprovalRate: 1,
                requestToConfirmedRate: 1,
                utilizationRate: 0.28,
                averageRevenuePerConfirmedBooking: 250,
              },
              buckets: [],
              dataAvailability: {
                searchImpressions: "live",
                searchClicks: "live",
                views: "live",
                bookingRequests: "live",
                requestOutcomes: "live",
                confirmedBookings: "live",
                revenue: "live",
                isPartial: false,
              },
              range: {
                endAt: "2026-05-24T00:00:00.000Z",
              },
            },
            error: null,
            meta: {
              requestId: "request-3",
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: "Forbidden",
            error: {
              code: "FORBIDDEN",
            },
          }),
          {
            status: 403,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { postingsAnalyticsApi } = await import("./analytics");
    const detail = await postingsAnalyticsApi.getPostingDetail("posting-1", {
      window: "7d",
      granularity: "day",
    });

    expect(detail.postingId).toBe("posting-1");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8040/api/v1/postings/posting-1/analytics?window=7d&granularity=day",
      expect.any(Object),
    );

    await expect(
      postingsAnalyticsApi.getPostingDetail("posting-2", {
        window: "all",
        granularity: "hour",
      }),
    ).rejects.toMatchObject({
      message: "Forbidden",
      code: "FORBIDDEN",
      status: 403,
    });
  });
});
