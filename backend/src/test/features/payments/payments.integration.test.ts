import { buildApiPath } from "@/configuration/http/api-path";
import { containerTokens } from "@/configuration/bootstrap/container";
import { PaymentsController } from "@/features/payments/payments.controller";
import {
  createJwtClaims,
  createRouteTestApp,
} from "../../support/integration-app";

function createPagination() {
  return {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };
}

function createApp() {
  const paymentsService = {
    createPaymentSession: jest.fn(async () => ({
      id: "session-1",
      checkoutUrl: "https://square.example/checkout/session-1",
      expiresAt: "2026-06-30T00:00:00.000Z",
    })),
    processSquareWebhook: jest.fn(async () => undefined),
    getPaymentById: jest.fn(async () => ({
      id: "payment-1",
      bookingRequestId: "booking-1",
      status: "awaiting_method",
      currency: "CAD",
      amount: 330,
    })),
    retryPayment: jest.fn(async () => ({
      id: "payment-1",
      status: "processing",
    })),
    createRefund: jest.fn(async () => ({
      id: "refund-1",
      paymentId: "payment-1",
      amount: 50,
      status: "pending",
    })),
    reconcilePayment: jest.fn(async () => ({
      id: "payment-1",
      status: "succeeded",
    })),
    repairPayment: jest.fn(async () => undefined),
    listPayouts: jest.fn(async () => ({
      payouts: [
        {
          id: "payout-1",
          amount: 250,
          currency: "CAD",
          status: "scheduled",
        },
      ],
      pagination: createPagination(),
    })),
  };

  const tokenService = {
    verifyAccessToken: jest.fn(async (token: string) => {
      if (token === "admin-token") {
        return createJwtClaims({
          sub: "admin-1",
          email: "admin@example.com",
          role: "admin",
        });
      }

      return createJwtClaims({
        sub: "owner-1",
        email: "owner@example.com",
        role: "owner",
      });
    }),
  };

  const registry = new Map<unknown, unknown>([
    [
      containerTokens.paymentsController,
      new PaymentsController(paymentsService as never),
    ],
    [containerTokens.tokenService, tokenService],
  ]);

  return {
    app: createRouteTestApp(registry),
    paymentsService,
  };
}

function authHeaders(token = "owner-token") {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

describe("Payments integration", () => {
  it("covers payment session, webhook, payment lifecycle, and payout endpoints", async () => {
    const { app, paymentsService } = createApp();

    const createSessionResponse = await app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-1/payment-session")}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          idempotencyKey: "pay-session-1",
        }),
      },
    );
    const webhookResponse = await app.request(
      `http://rent.test${buildApiPath("/payments/webhooks/square")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-square-hmacsha256-signature": "signature-1",
        },
        body: JSON.stringify({
          type: "payment.updated",
        }),
      },
    );
    const getByIdResponse = await app.request(
      `http://rent.test${buildApiPath("/payments/payment-1")}`,
      {
        headers: authHeaders(),
      },
    );
    const retryResponse = await app.request(
      `http://rent.test${buildApiPath("/payments/payment-1/retry")}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          idempotencyKey: "retry-1",
        }),
      },
    );
    const refundResponse = await app.request(
      `http://rent.test${buildApiPath("/payments/payment-1/refunds")}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          amount: 50,
          reason: "Partial refund",
          idempotencyKey: "refund-1",
        }),
      },
    );
    const reconcileResponse = await app.request(
      `http://rent.test${buildApiPath("/payments/payment-1/reconcile")}`,
      {
        method: "POST",
        headers: authHeaders(),
      },
    );
    const repairResponse = await app.request(
      `http://rent.test${buildApiPath("/payments/payment-1/repair")}`,
      {
        method: "POST",
        headers: authHeaders("admin-token"),
      },
    );
    const payoutsResponse = await app.request(
      `http://rent.test${buildApiPath("/payouts/me?page=1&pageSize=20&status=scheduled")}`,
      {
        headers: authHeaders(),
      },
    );

    expect(createSessionResponse.status).toBe(201);
    expect(webhookResponse.status).toBe(200);
    expect(getByIdResponse.status).toBe(200);
    expect(retryResponse.status).toBe(200);
    expect(refundResponse.status).toBe(201);
    expect(reconcileResponse.status).toBe(200);
    expect(repairResponse.status).toBe(200);
    expect(payoutsResponse.status).toBe(200);

    expect(paymentsService.createPaymentSession).toHaveBeenCalledWith({
      bookingRequestId: "booking-1",
      renterId: "owner-1",
      idempotencyKey: "pay-session-1",
    });
    expect(paymentsService.processSquareWebhook).toHaveBeenCalledWith(
      JSON.stringify({
        type: "payment.updated",
      }),
      "signature-1",
    );
    expect(paymentsService.getPaymentById).toHaveBeenCalledWith(
      "payment-1",
      "owner-1",
    );
    expect(paymentsService.retryPayment).toHaveBeenCalledWith({
      paymentId: "payment-1",
      renterId: "owner-1",
      idempotencyKey: "retry-1",
    });
    expect(paymentsService.createRefund).toHaveBeenCalledWith({
      paymentId: "payment-1",
      actorUserId: "owner-1",
      amount: 50,
      reason: "Partial refund",
      idempotencyKey: "refund-1",
    });
    expect(paymentsService.reconcilePayment).toHaveBeenCalledWith(
      "payment-1",
      "owner-1",
    );
    expect(paymentsService.repairPayment).toHaveBeenCalledWith("payment-1");
    expect(paymentsService.listPayouts).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      organizationId: "",
      page: 1,
      pageSize: 20,
      status: "scheduled",
    });
  });
});
