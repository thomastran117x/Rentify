import { beforeEach, describe, expect, it, vi } from "vitest";
import { paymentsApi } from "./api";

const { requestMock, pathMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  pathMock: vi.fn(
    (path: string, query: Record<string, unknown>) =>
      `${path}?${new URLSearchParams(
        Object.entries(query)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)]),
      ).toString()}`,
  ),
}));
vi.mock("@/lib/api/client", () => ({
  authenticatedJson: requestMock,
  buildPathWithQuery: pathMock,
}));

describe("paymentsApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates and retries sessions with optional idempotency headers", () => {
    paymentsApi.createSession("booking / 1");
    paymentsApi.createSession("booking / 1", { idempotencyKey: "create-key" });
    paymentsApi.retry("payment / 1");
    paymentsApi.retry("payment / 1", { idempotencyKey: "retry-key" });
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/booking-requests/booking%20%2F%201/payment-session",
      {},
      undefined,
    );
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/booking-requests/booking%20%2F%201/payment-session",
      { idempotencyKey: "create-key" },
      { "idempotency-key": "create-key", "x-idempotency-key": "create-key" },
    );
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/payments/payment%20%2F%201/retry",
      { idempotencyKey: "retry-key" },
      expect.objectContaining({ "idempotency-key": "retry-key" }),
    );
  });

  it("sends the embedded checkout method with the session request", () => {
    paymentsApi.createSession("booking / 1", {
      idempotencyKey: "card-key",
      method: "card",
    });
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/booking-requests/booking%20%2F%201/payment-session",
      { idempotencyKey: "card-key", method: "card" },
      { "idempotency-key": "card-key", "x-idempotency-key": "card-key" },
    );
  });

  it("reads the checkout summary for a booking", () => {
    paymentsApi.getCheckoutSummary("booking / 1");
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/booking-requests/booking%20%2F%201/checkout",
    );
  });

  it("captures payments and records cancelled checkouts", () => {
    paymentsApi.capture("payment / 1");
    paymentsApi.capture("payment / 1", { orderId: "ORDER-1" });
    paymentsApi.cancelCheckout("payment / 1");
    paymentsApi.cancelCheckout("payment / 1", { orderId: "ORDER-1" });
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/payments/payment%20%2F%201/capture",
      {},
    );
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/payments/payment%20%2F%201/capture",
      { orderId: "ORDER-1" },
    );
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/payments/payment%20%2F%201/cancel-checkout",
      {},
    );
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/payments/payment%20%2F%201/cancel-checkout",
      { orderId: "ORDER-1" },
    );
  });

  it("gets payment records and performs refund and remediation operations", () => {
    paymentsApi.getById("payment / 1");
    paymentsApi.getByBookingRequest("booking / 1");
    paymentsApi.createRefund("payment / 1", {
      amount: 20,
      reason: "Changed plans",
      idempotencyKey: "refund-key",
    });
    paymentsApi.reconcile("payment / 1");
    paymentsApi.repair("payment / 1");
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/payments/payment%20%2F%201",
    );
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/booking-requests/booking%20%2F%201/payment",
    );
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/payments/payment%20%2F%201/refunds",
      expect.objectContaining({ amount: 20 }),
      expect.objectContaining({ "x-idempotency-key": "refund-key" }),
    );
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/payments/payment%20%2F%201/reconcile",
      {},
    );
    expect(requestMock).toHaveBeenCalledWith(
      "POST",
      "/payments/payment%20%2F%201/repair",
      {},
    );
  });

  it("lists payouts with default and supplied filters", () => {
    paymentsApi.listPayouts();
    paymentsApi.listPayouts({ page: 2, pageSize: 50, status: "released" });
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/payouts/me?page=1&pageSize=20",
    );
    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/payouts/me?page=2&pageSize=50&status=released",
    );
  });
});
