import { RequestValidationError } from "@/configuration/validation/request";
import { PaymentsController } from "@/features/payments/payments.controller";
import { createTestContext, invoke } from "../../support/mock-http";
import type { JwtClaims } from "@/features/auth/token/token.service";

const mockRequireJwtAuth = jest.fn();

jest.mock("@/configuration/middlewares/jwt-middleware", () => ({
  requireJwtAuth: (...args: unknown[]) => mockRequireJwtAuth(...args),
}));

function createClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    email: "user@example.com",
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
      id: "payment-1",
      checkoutUrl: "https://payments.example.com/checkout",
    }));
    const controller = new PaymentsController({
      createPaymentSession,
    } as any);

    const response = await invoke(
      controller.createSessionForBooking,
      createContext({
        params: {
          id: "booking-1",
        },
        body: {
          idempotencyKey: "booking-1-payment",
        },
      }),
    );

    expect(createPaymentSession).toHaveBeenCalledWith({
      bookingRequestId: "booking-1",
      renterId: "user-1",
      idempotencyKey: "booking-1-payment",
    });
    expect(response.status).toBe(201);
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
      actorUserId: "user-1",
      organizationId: "",
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

  it("passes webhook raw bodies and signatures through to the service", async () => {
    const processSquareWebhook = jest.fn(async () => undefined);
    const controller = new PaymentsController({
      processSquareWebhook,
    } as any);

    const response = await invoke(
      controller.webhook,
      createContext({
        text: '{"type":"payment.updated"}',
        headers: {
          "x-square-hmacsha256-signature": "signature-1",
        },
      }),
    );

    expect(processSquareWebhook).toHaveBeenCalledWith(
      '{"type":"payment.updated"}',
      "signature-1",
    );
    await expect(response.json()).resolves.toMatchObject({
      message: "Payment webhook processed successfully.",
      data: {
        ok: true,
      },
    });
  });

  it("maps retry, refund, get-by-id, and reconcile calls to the service layer", async () => {
    const service = {
      getPaymentById: jest.fn(async () => ({ id: "payment-1" })),
      retryPayment: jest.fn(async () => ({
        id: "payment-1",
        status: "processing",
      })),
      createRefund: jest.fn(async () => ({ id: "refund-1" })),
      reconcilePayment: jest.fn(async () => ({
        id: "payment-1",
        status: "succeeded",
      })),
    };
    const controller = new PaymentsController(service as any);
    const context = createContext({
      params: {
        id: "payment-1",
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
    await invoke(controller.reconcile, context);

    expect(service.getPaymentById).toHaveBeenCalledWith("payment-1", "user-1");
    expect(service.retryPayment).toHaveBeenCalledWith({
      paymentId: "payment-1",
      renterId: "user-1",
      idempotencyKey: "retry-1",
    });
    expect(service.createRefund).toHaveBeenCalledWith({
      paymentId: "payment-1",
      actorUserId: "user-1",
      amount: 25,
      reason: "guest_request",
      idempotencyKey: "retry-1",
    });
    expect(service.reconcilePayment).toHaveBeenCalledWith(
      "payment-1",
      "user-1",
    );
  });

  it("maps get-by-booking-request calls to the service layer", async () => {
    const service = {
      getPaymentByBookingRequest: jest.fn(async () => ({ id: "payment-1" })),
    };
    const controller = new PaymentsController(service as any);
    const context = createContext({
      params: {
        id: "booking-1",
      },
    });

    const response = await invoke(controller.getByBookingRequest, context);

    expect(service.getPaymentByBookingRequest).toHaveBeenCalledWith(
      "booking-1",
      "user-1",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: "payment-1" },
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
