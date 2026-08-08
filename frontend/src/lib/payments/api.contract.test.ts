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
