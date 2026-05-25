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

describe("postingsApi", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    getDeviceIdMock.mockReturnValue("device-1");
    getDevicePlatformMock.mockReturnValue("web");
    readStoredSessionMock.mockReturnValue({
      accessToken: "posting-access-token",
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
    document.cookie = "csrf_token=posting-csrf-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a posting with auth and device headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          message: "ok",
          data: {
            viewerReviewState: {
              eligible: true,
              hasOwnReview: false,
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

    const { postingsApi } = await import("./api");
    const result = await postingsApi.getPosting("posting/1");

    expect(result.viewerReviewState?.eligible).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/postings/posting%2F1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer posting-access-token",
          "x-csrf-token": "posting-csrf-token",
          "x-device-id": "device-1",
          "x-device-platform": "web",
        }),
      }),
    );
  });

  it("posts booking quote requests with the provided payload", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          message: "ok",
          data: {
            postingId: "posting-1",
            bookable: true,
            durationDays: 2,
            pricingCurrency: "CAD",
            dailyPriceAmount: 100,
            estimatedTotal: 200,
            maxBookingDurationDays: 14,
            failureReasons: [],
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

    const { postingsApi } = await import("./api");
    await postingsApi.quoteBooking("posting-1", {
      startAt: "2026-06-01T00:00:00.000Z",
      endAt: "2026-06-03T00:00:00.000Z",
      guestCount: 2,
      note: "Need elevator access",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/postings/posting-1/booking-quote",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          startAt: "2026-06-01T00:00:00.000Z",
          endAt: "2026-06-03T00:00:00.000Z",
          guestCount: 2,
          note: "Need elevator access",
        }),
        headers: expect.objectContaining({
          "content-type": "application/json",
        }),
      }),
    );
  });

  it("surfaces API errors for availability block mutations", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          message: "Validation failed.",
          error: {
            code: "VALIDATION_ERROR",
            details: {
              startAt: "required",
            },
          },
        }),
        {
          status: 422,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { postingsApi } = await import("./api");

    await expect(
      postingsApi.createAvailabilityBlock("posting-1", {
        startAt: "",
        endAt: "",
      }),
    ).rejects.toMatchObject({
      message: "Validation failed.",
      code: "VALIDATION_ERROR",
      status: 422,
      details: {
        startAt: "required",
      },
    });
  });
});
