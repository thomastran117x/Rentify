import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDeviceIdMock = vi.fn();
const getDevicePlatformMock = vi.fn();
const readStoredSessionMock = vi.fn();
const writeStoredSessionMock = vi.fn();
const clearStoredSessionMock = vi.fn();

vi.mock("@/lib/auth/device", () => ({
  getDeviceId: getDeviceIdMock,
  getDevicePlatform: getDevicePlatformMock,
}));

vi.mock("@/lib/auth/storage", () => ({
  readStoredSession: readStoredSessionMock,
  writeStoredSession: writeStoredSessionMock,
  clearStoredSession: clearStoredSessionMock,
}));

describe("paymentsApi", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    getDeviceIdMock.mockReturnValue("device-1");
    getDevicePlatformMock.mockReturnValue("web");
    readStoredSessionMock.mockReturnValue({
      accessToken: "payment-access-token",
      refreshToken: "payment-refresh-token",
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
    document.cookie = "csrf_token=payment-csrf-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends payment-session idempotency in both body and headers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              id: "payment-1",
              bookingRequestId: "booking-1",
              postingId: "posting-1",
              renterId: "user-1",
              organizationId: "org-1",
              provider: "square",
              status: "awaiting_method",
              pricingCurrency: "CAD",
              rentalSubtotalAmount: 100,
              platformFeeAmount: 10,
              totalAmount: 110,
              createdAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-01T00:00:00.000Z",
              booking: {
                id: "booking-1",
                status: "approved",
                startAt: "2026-06-10T00:00:00.000Z",
                endAt: "2026-06-12T00:00:00.000Z",
                holdExpiresAt: "2026-06-02T00:00:00.000Z",
                paymentReconciliationRequired: false,
              },
              attempts: [],
              refunds: [],
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

    const { paymentsApi } = await import("./api");
    await paymentsApi.createSession("booking-1", {
      idempotencyKey: "idem-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/booking-requests/booking-1/payment-session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: "idem-1",
        }),
        headers: expect.objectContaining({
          "idempotency-key": "idem-1",
          "x-idempotency-key": "idem-1",
          authorization: "Bearer payment-access-token",
        }),
      }),
    );
  });

  it("builds payout list query params", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              payouts: [],
              pagination: {
                page: 2,
                pageSize: 10,
                total: 0,
                totalPages: 0,
                hasNextPage: false,
                hasPreviousPage: true,
              },
              status: "scheduled",
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

    const { paymentsApi } = await import("./api");
    await paymentsApi.listPayouts({
      page: 2,
      pageSize: 10,
      status: "scheduled",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8040/api/v1/payouts/me?page=2&pageSize=10&status=scheduled",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });
});
