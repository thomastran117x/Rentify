import { RequestValidationError } from "@/configuration/validation/request";
import { PaymentsController } from "@/features/payments/payments.controller";
import { createTestContext, invoke } from "../../support/mock-http";
import type { JwtClaims } from "@/features/auth/token/token.service";
import { testUuid } from "../../support/uuid";

const PAYMENT_ID = testUuid(3000, 1);
const USER_ID = testUuid(1000, 1);
const BOOKING_ID = testUuid(1020, 1);

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: USER_ID,
    email: `${USER_ID}@example.com`,
    role: "user",
    deviceId: "device-1",
    tokenVersion: 0,
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

function createContext(options?: {
  body?: unknown;
  url?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  text?: string;
}) {
  return createTestContext({
    ...options,
    url:
      options?.url ??
      "https://example.test/api/v1/payments/payment-1/payouts?page=2&pageSize=5&status=scheduled",
    state: {
      requestId: "request-1",
      container: {
        resolve: () => ({
          inspectRequest: () => [],
        }),
      },
    },
  });
}

describe("PaymentsController", () => {
  beforeEach(() => {
    mockRequireJwtAuth.mockReset();
    mockRequireJwtAuth.mockResolvedValue(createClaims());
  });

  it("creates booking payment sessions from auth, route params, and idempotency input", async () => {
    const createPaymentSession = jest.fn(async () => ({
      id: PAYMENT_ID,
      checkoutUrl: "https://payments.example.com/checkout",
    }));
    const controller = new PaymentsController({
      createPaymentSession,
    } as any);

    const response = await invoke(
      controller.createSessionForBooking,
      createContext({
        params: {
          id: BOOKING_ID,
        },
        body: {
          idempotencyKey: "booking-1-payment",
        },
      }),
    );

    expect(createPaymentSession).toHaveBeenCalledWith({
      bookingRequestId: BOOKING_ID,
      renterId: USER_ID,
      idempotencyKey: "booking-1-payment",
      method: "paypal_redirect",
    });
    expect(response.status).toBe(201);
  });

  it("passes the embedded checkout method through to the service", async () => {
    const createPaymentSession = jest.fn(async () => ({ id: PAYMENT_ID }));
    const controller = new PaymentsController({
      createPaymentSession,
    } as any);

    await invoke(
      controller.createSessionForBooking,
      createContext({
        params: { id: BOOKING_ID },
        body: { idempotencyKey: "booking-1-card", method: "card" },
      }),
    );

    expect(createPaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({ method: "card" }),
    );
  });

  it("rejects unknown checkout methods", async () => {
    const createPaymentSession = jest.fn();
    const controller = new PaymentsController({
      createPaymentSession,
    } as any);

    await expect(
      invoke(
        controller.createSessionForBooking,
        createContext({
          params: { id: BOOKING_ID },
          body: { method: "bitcoin" },
        }),
      ),
    ).rejects.toBeInstanceOf(RequestValidationError);
    expect(createPaymentSession).not.toHaveBeenCalled();
  });

  it("creates redirect payment sessions for requests without a body", async () => {
    const createPaymentSession = jest.fn(async () => ({ id: PAYMENT_ID }));
    const controller = new PaymentsController({
      createPaymentSession,
    } as any);

    await invoke(
      controller.createSessionForBooking,
      createContext({
        params: { id: BOOKING_ID },
        headers: { "content-length": "0" },
      }),
    );

    expect(createPaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({ method: "paypal_redirect" }),
    );
  });

  it("returns the checkout summary for the booking", async () => {
    const getCheckoutSummary = jest.fn(async () => ({
      checkout: { eligible: true },
    }));
    const controller = new PaymentsController({
      getCheckoutSummary,
    } as any);

    const response = await invoke(
      controller.getCheckoutSummary,
      createContext({
        params: { id: BOOKING_ID },
      }),
    );

    expect(getCheckoutSummary).toHaveBeenCalledWith(BOOKING_ID, USER_ID);
    expect(response.status).toBe(200);
  });

  it("forwards the approved order id to capture", async () => {
    const capturePayment = jest.fn(async () => ({ id: PAYMENT_ID }));
    const controller = new PaymentsController({
      capturePayment,
    } as any);

    await invoke(
      controller.capture,
      createContext({
        params: { id: PAYMENT_ID },
        body: { orderId: "ORDER-1" },
      }),
    );
    await invoke(
      controller.capture,
      createContext({
        params: { id: PAYMENT_ID },
        headers: { "content-length": "0" },
      }),
    );

    expect(capturePayment).toHaveBeenNthCalledWith(1, PAYMENT_ID, USER_ID, {
      orderId: "ORDER-1",
    });
    expect(capturePayment).toHaveBeenNthCalledWith(2, PAYMENT_ID, USER_ID, {
      orderId: undefined,
    });
  });

  it("maps payout list queries into service input and response metadata", async () => {
    const listPayouts = jest.fn(async () => ({
      payouts: [],
      pagination: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      status: "scheduled",
    }));
    const controller = new PaymentsController({
      listPayouts,
    } as any);

    const response = await invoke(controller.listPayouts, createContext());

    expect(listPayouts).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      page: 2,
      pageSize: 5,
      status: "scheduled",
    });
    await expect(response.json()).resolves.toMatchObject({
      meta: {
        requestId: "request-1",
        pagination: {
          page: 2,
          pageSize: 5,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      },
    });
  });

  it("passes webhook raw bodies and PayPal transmission headers through to the service", async () => {
    const processPaymentWebhook = jest.fn(async () => undefined);
    const controller = new PaymentsController({
      processPaymentWebhook,
    } as any);

    const response = await invoke(
      controller.webhook,
      createContext({
        text: '{"type":`${PAYMENT_ID}.updated`}',
        headers: {
          "paypal-auth-algo": "SHA256withRSA",
          "paypal-cert-url": "https://api.paypal.com/cert.pem",
          "paypal-transmission-id": "transmission-1",
          "paypal-transmission-sig": "signature-1",
          "paypal-transmission-time": "2026-09-14T12:00:00Z",
        },
      }),
    );

    expect(processPaymentWebhook).toHaveBeenCalledWith(
      '{"type":`${PAYMENT_ID}.updated`}',
      {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api.paypal.com/cert.pem",
        "paypal-transmission-id": "transmission-1",
        "paypal-transmission-sig": "signature-1",
        "paypal-transmission-time": "2026-09-14T12:00:00Z",
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      message: "Payment webhook processed successfully.",
      data: {
        ok: true,
      },
    });
  });

  it("maps retry, refund, get-by-id, capture, cancel-checkout, and reconcile calls to the service layer", async () => {
    const service = {
      getPaymentById: jest.fn(async () => ({ id: PAYMENT_ID })),
      retryPayment: jest.fn(async () => ({
        id: PAYMENT_ID,
        status: "processing",
      })),
      createRefund: jest.fn(async () => ({ id: "refund-1" })),
      cancelCheckout: jest.fn(async () => ({
        id: PAYMENT_ID,
        status: "failed_final",
      })),
      capturePayment: jest.fn(async () => ({
        id: PAYMENT_ID,
        status: "succeeded",
      })),
      reconcilePayment: jest.fn(async () => ({
        id: PAYMENT_ID,
        status: "succeeded",
      })),
    };
    const controller = new PaymentsController(service as any);
    const context = createContext({
      params: {
        id: PAYMENT_ID,
      },
      body: {
        idempotencyKey: "retry-1",
        amount: 25,
        reason: "guest_request",
      },
    });

    await invoke(controller.getById, context);
    await invoke(controller.retry, context);
    await invoke(controller.createRefund, context);
    await invoke(controller.capture, context);
    await invoke(controller.cancelCheckout, context);
    await invoke(controller.reconcile, context);

    expect(service.getPaymentById).toHaveBeenCalledWith(PAYMENT_ID, USER_ID);
    expect(service.retryPayment).toHaveBeenCalledWith({
      paymentId: PAYMENT_ID,
      renterId: USER_ID,
      idempotencyKey: "retry-1",
    });
    expect(service.createRefund).toHaveBeenCalledWith({
      paymentId: PAYMENT_ID,
      actorUserId: USER_ID,
      amount: 25,
      reason: "guest_request",
      idempotencyKey: "retry-1",
    });
    expect(service.capturePayment).toHaveBeenCalledWith(PAYMENT_ID, USER_ID, {
      orderId: undefined,
    });
    expect(service.cancelCheckout).toHaveBeenCalledWith(PAYMENT_ID, USER_ID);
    expect(service.reconcilePayment).toHaveBeenCalledWith(PAYMENT_ID, USER_ID);
  });

  it("maps get-by-booking-request calls to the service layer", async () => {
    const service = {
      getPaymentByBookingRequest: jest.fn(async () => ({ id: PAYMENT_ID })),
    };
    const controller = new PaymentsController(service as any);
    const context = createContext({
      params: {
        id: BOOKING_ID,
      },
    });

    const response = await invoke(controller.getByBookingRequest, context);

    expect(service.getPaymentByBookingRequest).toHaveBeenCalledWith(
      BOOKING_ID,
      USER_ID,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: PAYMENT_ID },
    });
  });

  it("returns request validation details for invalid payout queries", async () => {
    const controller = new PaymentsController({
      listPayouts: jest.fn(),
    } as any);

    await expect(
      invoke(
        controller.listPayouts,
        createContext({
          url: "https://example.test/api/v1/payments/payouts?page=0&pageSize=999",
        }),
      ),
    ).rejects.toMatchObject({
      message: "Request query validation failed.",
      details: [
        {
          path: "page",
          message: "Too small: expected number to be >=1",
        },
        {
          path: "pageSize",
          message: "Too big: expected number to be <=50",
        },
      ],
    });
  });
});
