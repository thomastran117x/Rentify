const mockGetEnvironment = jest.fn();
const mockIsDevelopment = jest.fn();
const mockVerifySquareSignature = jest.fn();

jest.mock("@/configuration/environment/index", () => ({
  getEnvironment: () => mockGetEnvironment(),
  environment: {
    isDevelopment: () => mockIsDevelopment(),
  },
}));

jest.mock("@/features/payments/payments.utils", () => {
  const actual = jest.requireActual("@/features/payments/payments.utils");
  return {
    ...actual,
    verifySquareSignature: (...args: unknown[]) =>
      mockVerifySquareSignature(...args),
  };
});

import { SquarePaymentAdapter } from "@/features/payments/square.adapter";

function createFetchResponse(options: {
  ok: boolean;
  status: number;
  body?: Record<string, unknown>;
  requestId?: string;
}) {
  return {
    ok: options.ok,
    status: options.status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "x-request-id"
          ? (options.requestId ?? null)
          : null,
    },
    text: async () => JSON.stringify(options.body ?? {}),
  } as Response;
}

describe("SquarePaymentAdapter", () => {
  beforeEach(() => {
    mockGetEnvironment.mockReturnValue({
      square: {
        accessToken: "live-square-access-token",
        locationId: "square-location-1",
        webhookSignatureKey: "square-webhook-key",
        webhookNotificationUrl:
          "http://localhost:8040/api/v1/payments/webhooks/square",
        apiBaseUrl: "https://connect.squareupsandbox.com",
      },
      oauth: {
        google: {
          frontendBaseUrl: "http://localhost:3040",
        },
      },
    });
    mockIsDevelopment.mockReturnValue(false);
    mockVerifySquareSignature.mockReset();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    mockGetEnvironment.mockReset();
    mockIsDevelopment.mockReset();
  });

  it("creates a Square payment link session and maps checkout details", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      createFetchResponse({
        ok: true,
        status: 200,
        requestId: "request-1",
        body: {
          payment_link: {
            url: "https://square.test/checkout",
            order_id: "order-1",
          },
        },
      }),
    );
    const adapter = new SquarePaymentAdapter();

    const result = await adapter.createPaymentSession({
      idempotencyKey: "idem-1",
      amount: 123.45,
      currency: "CAD",
      bookingRequestId: "booking-1",
      paymentId: "payment-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://connect.squareupsandbox.com/v2/online-checkout/payment-links",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer live-square-access-token",
          "Square-Version": "2026-01-15",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(
      JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string),
    ).toMatchObject({
      idempotency_key: "idem-1",
      order: {
        location_id: "square-location-1",
        reference_id: "booking-1",
        line_items: [
          {
            quantity: "1",
            base_price_money: {
              amount: 12345,
              currency: "CAD",
            },
          },
        ],
      },
      checkout_options: {
        redirect_url: "http://localhost:3040/payments/payment-1/return",
      },
    });
    expect(result).toEqual({
      checkoutUrl: "https://square.test/checkout",
      providerRequestId: "request-1",
      providerPaymentId: undefined,
      providerOrderId: "order-1",
      locationId: "square-location-1",
      raw: {
        payment_link: {
          url: "https://square.test/checkout",
          order_id: "order-1",
        },
      },
    });
  });

  it("returns null when payment status lookup is attempted without a provider payment id", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const adapter = new SquarePaymentAdapter();

    const result = await adapter.getPaymentStatus({
      providerOrderId: "order-1",
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a Square payment status response into provider status fields", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      createFetchResponse({
        ok: true,
        status: 200,
        body: {
          payment: {
            id: "square-pay-1",
            order_id: "order-1",
            status: "COMPLETED",
            amount_money: {
              amount: 11025,
              currency: "CAD",
            },
            card_details: {
              status: "CAPTURED",
            },
            delay_action: "manual_review",
          },
        },
      }),
    );
    const adapter = new SquarePaymentAdapter();

    const result = await adapter.getPaymentStatus({
      providerPaymentId: "square-pay-1",
    });

    expect(result).toEqual({
      providerPaymentId: "square-pay-1",
      providerOrderId: "order-1",
      status: "COMPLETED",
      amount: 110.25,
      currency: "CAD",
      failureCode: "CAPTURED",
      failureMessage: "manual_review",
      raw: {
        payment: {
          id: "square-pay-1",
          order_id: "order-1",
          status: "COMPLETED",
          amount_money: {
            amount: 11025,
            currency: "CAD",
          },
          card_details: {
            status: "CAPTURED",
          },
          delay_action: "manual_review",
        },
      },
    });
  });

  it("returns null when Square does not return a payment object", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      createFetchResponse({
        ok: true,
        status: 200,
        body: {},
      }),
    );
    const adapter = new SquarePaymentAdapter();

    const result = await adapter.getPaymentStatus({
      providerPaymentId: "square-pay-1",
    });

    expect(result).toBeNull();
  });

  it("simulates refunds in development when Square credentials are placeholders", async () => {
    mockGetEnvironment.mockReturnValue({
      square: {
        accessToken: "change-me-square-access-token",
        locationId: "change-me-square-location-id",
        webhookSignatureKey: "change-me-square-webhook-signature-key",
        webhookNotificationUrl:
          "http://localhost:8040/api/v1/payments/webhooks/square",
        apiBaseUrl: "https://connect.squareupsandbox.com",
      },
      oauth: {
        google: {
          frontendBaseUrl: "http://localhost:3040",
        },
      },
    });
    mockIsDevelopment.mockReturnValue(true);
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const adapter = new SquarePaymentAdapter();

    await expect(
      adapter.createRefund({
        idempotencyKey: "refund-123",
        providerPaymentId: "payment-123",
        amount: 184.8,
        currency: "CAD",
        reason: "Renter cancelled before start.",
      }),
    ).resolves.toEqual({
      providerRefundId: "mock-refund-refund-123",
      status: "COMPLETED",
      raw: {
        mock: true,
        providerPaymentId: "payment-123",
        amount: 184.8,
        currency: "CAD",
        reason: "Renter cancelled before start.",
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates real Square refunds and maps rejected responses as failed", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      createFetchResponse({
        ok: true,
        status: 200,
        body: {
          refund: {
            id: "refund-1",
            status: "REJECTED",
          },
        },
      }),
    );
    const adapter = new SquarePaymentAdapter();

    const result = await adapter.createRefund({
      idempotencyKey: "refund-1",
      providerPaymentId: "square-pay-1",
      amount: 42.5,
      currency: "CAD",
      reason: "Customer requested refund",
    });

    expect(
      JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string),
    ).toMatchObject({
      idempotency_key: "refund-1",
      payment_id: "square-pay-1",
      amount_money: {
        amount: 4250,
        currency: "CAD",
      },
      reason: "Customer requested refund",
    });
    expect(result).toEqual({
      providerRefundId: "refund-1",
      status: "FAILED",
      raw: {
        refund: {
          id: "refund-1",
          status: "REJECTED",
        },
      },
    });
  });

  it("verifies webhook signatures and returns parsed event details", () => {
    mockVerifySquareSignature.mockReturnValue(true);
    const adapter = new SquarePaymentAdapter();

    const result = adapter.verifyWebhookSignature(
      JSON.stringify({
        event_id: "event-1",
        type: "payment.updated",
        ok: true,
      }),
      "sig-1",
    );

    expect(mockVerifySquareSignature).toHaveBeenCalledWith({
      signatureKey: "square-webhook-key",
      notificationUrl: "http://localhost:8040/api/v1/payments/webhooks/square",
      rawBody: JSON.stringify({
        event_id: "event-1",
        type: "payment.updated",
        ok: true,
      }),
      signatureHeader: "sig-1",
    });
    expect(result).toEqual({
      isValid: true,
      eventId: "event-1",
      eventType: "payment.updated",
      payload: {
        event_id: "event-1",
        type: "payment.updated",
        ok: true,
      },
    });
  });

  it("classifies HTTP errors using the response status and code", () => {
    const adapter = new SquarePaymentAdapter();
    const error = Object.assign(new Error("Too many requests"), {
      status: 429,
      code: "RATE_LIMITED",
    });

    expect(adapter.classifyError(error)).toEqual({
      category: "transient",
      code: "RATE_LIMITED",
      message: "Too many requests",
      retryable: true,
    });
  });

  it("classifies network errors with transient socket codes", () => {
    const adapter = new SquarePaymentAdapter();
    const error = Object.assign(new Error("socket reset"), {
      code: "ECONNRESET",
    });

    expect(adapter.classifyError(error)).toEqual({
      category: "transient",
      code: "ECONNRESET",
      message: "socket reset",
      retryable: true,
    });
  });

  it("surfaces Square API error details from failed HTTP requests", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      createFetchResponse({
        ok: false,
        status: 400,
        body: {
          errors: [
            {
              code: "INVALID_REQUEST_ERROR",
              detail: "Square rejected the checkout request.",
            },
          ],
        },
      }),
    );
    const adapter = new SquarePaymentAdapter();

    await expect(
      adapter.createPaymentSession({
        idempotencyKey: "idem-1",
        amount: 10,
        currency: "CAD",
        bookingRequestId: "booking-1",
        paymentId: "payment-1",
      }),
    ).rejects.toThrow("Square rejected the checkout request.");
  });

  it("classifies Square transport failures as transient provider outages", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      }),
    );
    const adapter = new SquarePaymentAdapter();

    let thrown: unknown;
    try {
      await adapter.createPaymentSession({
        idempotencyKey: "idem-network",
        amount: 10,
        currency: "CAD",
        bookingRequestId: "booking-network",
        paymentId: "payment-network",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(adapter.classifyError(thrown)).toEqual({
      category: "transient",
      code: "ECONNREFUSED",
      message: "Square request failed before receiving a response.",
      retryable: true,
    });
  });

  it("classifies invalid Square JSON as an unretryable provider response issue", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not-json", {
        status: 200,
        headers: {
          "x-request-id": "request-invalid-json",
        },
      }),
    );
    const adapter = new SquarePaymentAdapter();

    let thrown: unknown;
    try {
      await adapter.createPaymentSession({
        idempotencyKey: "idem-invalid-json",
        amount: 10,
        currency: "CAD",
        bookingRequestId: "booking-invalid-json",
        paymentId: "payment-invalid-json",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(adapter.classifyError(thrown)).toEqual({
      category: "permanent",
      code: "INVALID_PROVIDER_RESPONSE",
      message: "Square returned an invalid JSON response.",
      retryable: false,
    });
  });
});
