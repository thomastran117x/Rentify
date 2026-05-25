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

describe("bookingsApi", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    getDeviceIdMock.mockReturnValue("device-1");
    getDevicePlatformMock.mockReturnValue("web");
    readStoredSessionMock.mockReturnValue({
      accessToken: "booking-access-token",
      device: {
        known: true,
        knownByIp: false,
      },
      user: {
        id: "user-1",
        email: "person@example.com",
        username: "person",
        role: "user",
      },
    });
    document.cookie = "csrf_token=booking-csrf-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds owner dashboard query params and includes auth headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          message: "ok",
          data: {
            items: [],
            summary: {
              approval: 0,
              payment: 0,
              expiringHold: 0,
              paymentFailure: 0,
              conversion: 0,
              totalOpen: 0,
              upcomingRentings: 0,
              activeRentings: 0,
              pastRentings: 0,
            },
            pagination: {
              page: 2,
              pageSize: 10,
              total: 0,
              totalPages: 0,
              hasNextPage: false,
              hasPreviousPage: true,
            },
            postings: [],
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

    const { bookingsApi } = await import("./api");
    await bookingsApi.getOwnerDashboard({
      page: 2,
      pageSize: 10,
      sort: "start_at",
      status: "approved",
      actionNeeded: "approval",
      postingId: "posting-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/booking-requests/owner/dashboard?page=2&pageSize=10&sort=start_at&status=approved&actionNeeded=approval&postingId=posting-1",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: expect.objectContaining({
          accept: "application/json",
          authorization: "Bearer booking-access-token",
          "x-csrf-token": "booking-csrf-token",
          "x-device-id": "device-1",
          "x-device-platform": "web",
        }),
      }),
    );
  });

  it("posts cancellation requests with the provided reason", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          message: "ok",
          data: {
            id: "booking-1",
            status: "cancelled",
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

    const { bookingsApi } = await import("./api");
    await bookingsApi.cancel("booking/1", {
      reason: "Schedule changed",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/booking-requests/booking%2F1/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reason: "Schedule changed",
        }),
        headers: expect.objectContaining({
          "content-type": "application/json",
          authorization: "Bearer booking-access-token",
        }),
      }),
    );
  });

  it("surfaces API errors from renting mutations", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          message: "Validation failed.",
          error: {
            code: "VALIDATION_ERROR",
            details: {
              reason: "required",
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

    const { bookingsApi } = await import("./api");

    await expect(
      bookingsApi.createRentingDispute("renting-1", {
        reason: "",
      }),
    ).rejects.toMatchObject({
      message: "Validation failed.",
      code: "VALIDATION_ERROR",
      status: 422,
      details: {
        reason: "required",
      },
    });
  });
});
