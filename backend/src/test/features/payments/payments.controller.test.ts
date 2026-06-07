import type { Context } from "hono";
import { RequestValidationError } from "@/configuration/validation/request";
import type { AppBindings } from "@/configuration/http/bindings";
import { PaymentsController } from "@/features/payments/payments.controller";
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
  const variables = new Map<string, unknown>();
  variables.set("requestId", "request-1");
  variables.set("container", {
    resolve: () => ({
      inspectRequest: () => [],
    }),
  });

  const context = {
    req: {
      json: async () => options?.body ?? {},
      text: async () => options?.text ?? "",
      url:
        options?.url ??
        "https://example.test/api/v1/payments/payment-1/payouts?page=2&pageSize=5&status=scheduled",
      param: (name?: string) =>
        name ? options?.params?.[name] : (options?.params ?? {}),
      header: (name: string) => options?.headers?.[name.toLowerCase()],
    },
    get: (name: string) => variables.get(name),
    set: (name: string, value: unknown) => {
      variables.set(name, value);
    },
    json: (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
        },
      }),
  };

  return context as unknown as Context<AppBindings>;
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
    } as never);

    const response = await controller.createSessionForBooking(
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
    } as never);

    const response = await controller.listPayouts(createContext());

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
    } as never);

    const response = await controller.webhook(
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
    const controller = new PaymentsController(service as never);
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

    await controller.getById(context);
    await controller.retry(context);
    await controller.createRefund(context);
    await controller.reconcile(context);

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

  it("returns request validation details for invalid payout queries", async () => {
    const controller = new PaymentsController({
      listPayouts: jest.fn(),
    } as never);

    await expect(
      controller.listPayouts(
        createContext({
          url: "https://example.test/api/v1/payments/payouts?page=0&pageSize=999",
        }),
      ),
    ).rejects.toMatchObject<RequestValidationError>({
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
