const mockGetEnvironment = jest.fn();
const mockIsDevelopment = jest.fn();

jest.mock("@/configuration/environment/index", () => ({
  getEnvironment: () => mockGetEnvironment(),
  environment: {
    isDevelopment: () => mockIsDevelopment(),
  },
}));

import { PayPalPaymentAdapter } from "@/features/payments/paypal.adapter";
import { testUuid } from "../../support/uuid";

const BOOKING_1_ID = testUuid(9000, 996753);
const PAYMENT_1_ID = testUuid(9000, 132102);
const API_BASE_URL = "https://api-m.sandbox.paypal.com";
const TOKEN_URL = `${API_BASE_URL}/v1/oauth2/token`;

const WEBHOOK_HEADERS = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/1",
  "paypal-transmission-id": "transmission-1",
  "paypal-transmission-sig": "signature-1",
  "paypal-transmission-time": "2026-09-14T12:00:00Z",
};

type FetchMock = jest.SpiedFunction<typeof fetch>;

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function tokenResponse(): Response {
  return jsonResponse(200, {
    access_token: "access-token-1",
    expires_in: 3600,
  });
}

/** Serves the OAuth token endpoint, then each queued response in order. */
function mockPayPal(...responses: Response[]): FetchMock {
  const queue = [...responses];

  return jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input) === TOKEN_URL) {
      return tokenResponse();
    }

    const next = queue.shift();

    if (!next) {
      throw new Error(`Unexpected PayPal request to ${String(input)}`);
    }

    return next;
  });
}

function apiCalls(fetchMock: FetchMock): Array<[string, RequestInit]> {
  return fetchMock.mock.calls
    .map(
      ([input, init]) =>
        [String(input), init as RequestInit] as [string, RequestInit],
    )
    .filter(([url]) => url !== TOKEN_URL);
}

function tokenCalls(fetchMock: FetchMock): number {
  return fetchMock.mock.calls.filter(([input]) => String(input) === TOKEN_URL)
    .length;
}

function requestHeaders(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

function requestBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to reject.");
}

function createSession(
  adapter: PayPalPaymentAdapter,
  idempotencyKey = "idem-1",
) {
  return adapter.createPaymentSession({
    idempotencyKey,
    amount: 123.45,
    currency: "CAD",
    bookingRequestId: BOOKING_1_ID,
    paymentId: PAYMENT_1_ID,
  });
}

function orderWithCapture(capture: Record<string, unknown>) {
  return {
    id: "ORDER-1",
    status: "COMPLETED",
    purchase_units: [
      {
        payments: {
          captures: [capture],
        },
      },
    ],
  };
}

describe("PayPalPaymentAdapter", () => {
  beforeEach(() => {
    mockGetEnvironment.mockReturnValue({
      paypal: {
        clientId: "client-1",
        clientSecret: "secret-1",
        webhookId: "WH-1",
        environment: "sandbox",
        apiBaseUrl: API_BASE_URL,
      },
      application: {
        frontendUrl: "http://localhost:3040",
      },
    });
    mockIsDevelopment.mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockGetEnvironment.mockReset();
    mockIsDevelopment.mockReset();
  });

  describe("createPaymentSession", () => {
    it("creates a checkout order and maps the approval link", async () => {
      const order = {
        id: "ORDER-1",
        status: "PAYER_ACTION_REQUIRED",
        links: [
          { rel: "self", href: `${API_BASE_URL}/v2/checkout/orders/ORDER-1` },
          {
            rel: "payer-action",
            href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
          },
        ],
      };
      const fetchMock = mockPayPal(
        jsonResponse(200, order, { "paypal-debug-id": "debug-1" }),
      );
      const adapter = new PayPalPaymentAdapter();

      const result = await createSession(adapter);

      const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(tokenUrl).toBe(TOKEN_URL);
      expect(tokenInit.body).toBe("grant_type=client_credentials");
      expect(requestHeaders(tokenInit).Authorization).toBe(
        `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
      );

      const [[url, init]] = apiCalls(fetchMock);
      expect(url).toBe(`${API_BASE_URL}/v2/checkout/orders`);
      expect(init.method).toBe("POST");
      expect(requestHeaders(init)).toMatchObject({
        Authorization: "Bearer access-token-1",
        "PayPal-Request-Id": "idem-1",
        "Content-Type": "application/json",
      });
      expect(requestBody(init)).toMatchObject({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: BOOKING_1_ID,
            custom_id: PAYMENT_1_ID,
            amount: { currency_code: "CAD", value: "123.45" },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: `http://localhost:3040/payments/${PAYMENT_1_ID}/return`,
              cancel_url: `http://localhost:3040/payments/${PAYMENT_1_ID}/return?cancelled=1`,
            },
          },
        },
      });
      expect(result).toEqual({
        checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
        providerRequestId: "debug-1",
        providerPaymentId: undefined,
        providerOrderId: "ORDER-1",
        raw: order,
      });
    });

    it("falls back to the approve link and hashes long idempotency keys", async () => {
      const fetchMock = mockPayPal(
        jsonResponse(200, {
          id: "ORDER-1",
          links: [{ rel: "approve", href: "https://paypal.test/approve" }],
        }),
      );
      const adapter = new PayPalPaymentAdapter();

      const result = await createSession(adapter, "k".repeat(200));

      expect(result.checkoutUrl).toBe("https://paypal.test/approve");
      expect(result.providerRequestId).toBeUndefined();
      const [[, init]] = apiCalls(fetchMock);
      expect(requestHeaders(init)["PayPal-Request-Id"]).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });

    it("leaves the checkout URL empty when PayPal returns no usable links", async () => {
      mockPayPal(jsonResponse(200, { id: "ORDER-1" }));
      const adapter = new PayPalPaymentAdapter();

      await expect(createSession(adapter)).resolves.toMatchObject({
        checkoutUrl: undefined,
        providerOrderId: "ORDER-1",
      });
    });

    it("reuses the cached access token until PayPal rejects it", async () => {
      const fetchMock = mockPayPal(
        jsonResponse(200, { id: "ORDER-1" }),
        jsonResponse(401, {
          name: "AUTHENTICATION_FAILURE",
          message:
            "Authentication failed due to invalid authentication credentials.",
        }),
        jsonResponse(200, { id: "ORDER-2" }),
      );
      const adapter = new PayPalPaymentAdapter();

      await createSession(adapter);
      await expect(createSession(adapter)).rejects.toMatchObject({
        status: 401,
        code: "AUTHENTICATION_FAILURE",
      });
      expect(tokenCalls(fetchMock)).toBe(1);

      await createSession(adapter);
      expect(tokenCalls(fetchMock)).toBe(2);
    });
  });

  describe("capturePayment", () => {
    it("captures the order and maps the completed capture", async () => {
      const order = orderWithCapture({
        id: "CAPTURE-1",
        status: "COMPLETED",
        amount: { value: "110.25", currency_code: "CAD" },
      });
      const fetchMock = mockPayPal(jsonResponse(201, order));
      const adapter = new PayPalPaymentAdapter();

      const result = await adapter.capturePayment({
        providerOrderId: "ORDER-1",
        idempotencyKey: "capture-ORDER-1",
      });

      const [[url, init]] = apiCalls(fetchMock);
      expect(url).toBe(`${API_BASE_URL}/v2/checkout/orders/ORDER-1/capture`);
      expect(requestHeaders(init)["PayPal-Request-Id"]).toBe("capture-ORDER-1");
      expect(result).toEqual({
        providerPaymentId: "CAPTURE-1",
        providerOrderId: "ORDER-1",
        status: "COMPLETED",
        amount: 110.25,
        currency: "CAD",
        failureCode: undefined,
        failureMessage: undefined,
        raw: order,
      });
    });

    it("maps declined captures as failed with the decline reason", async () => {
      mockPayPal(
        jsonResponse(
          201,
          orderWithCapture({
            id: "CAPTURE-1",
            status: "DECLINED",
            status_details: { reason: "DECLINED_BY_PROCESSOR" },
          }),
        ),
      );
      const adapter = new PayPalPaymentAdapter();

      await expect(
        adapter.capturePayment({
          providerOrderId: "ORDER-1",
          idempotencyKey: "capture-ORDER-1",
        }),
      ).resolves.toMatchObject({
        status: "FAILED",
        amount: undefined,
        failureCode: "DECLINED",
        failureMessage: "DECLINED_BY_PROCESSOR",
      });
    });

    it("reads the order state when the order was already captured", async () => {
      const fetchMock = mockPayPal(
        jsonResponse(422, {
          name: "UNPROCESSABLE_ENTITY",
          details: [
            {
              issue: "ORDER_ALREADY_CAPTURED",
              description: "Order already captured.",
            },
          ],
        }),
        jsonResponse(
          200,
          orderWithCapture({ id: "CAPTURE-1", status: "COMPLETED" }),
        ),
      );
      const adapter = new PayPalPaymentAdapter();

      await expect(
        adapter.capturePayment({
          providerOrderId: "ORDER-1",
          idempotencyKey: "capture-ORDER-1",
        }),
      ).resolves.toMatchObject({
        providerPaymentId: "CAPTURE-1",
        status: "COMPLETED",
      });
      expect(apiCalls(fetchMock)[1]?.[0]).toBe(
        `${API_BASE_URL}/v2/checkout/orders/ORDER-1`,
      );
    });

    it("rethrows the original error when an already captured order cannot be found", async () => {
      mockPayPal(
        jsonResponse(422, {
          name: "UNPROCESSABLE_ENTITY",
          details: [{ issue: "ORDER_ALREADY_CAPTURED" }],
        }),
        jsonResponse(404, { name: "RESOURCE_NOT_FOUND" }),
      );
      const adapter = new PayPalPaymentAdapter();

      await expect(
        adapter.capturePayment({
          providerOrderId: "ORDER-1",
          idempotencyKey: "capture-ORDER-1",
        }),
      ).rejects.toMatchObject({ code: "ORDER_ALREADY_CAPTURED" });
    });

    it("rethrows declined instruments as permanent failures", async () => {
      mockPayPal(
        jsonResponse(422, {
          name: "UNPROCESSABLE_ENTITY",
          details: [
            {
              issue: "INSTRUMENT_DECLINED",
              description: "The instrument presented was declined.",
            },
          ],
        }),
      );
      const adapter = new PayPalPaymentAdapter();

      const error = await captureError(
        adapter.capturePayment({
          providerOrderId: "ORDER-1",
          idempotencyKey: "capture-ORDER-1",
        }),
      );

      expect(error).toMatchObject({
        status: 422,
        code: "INSTRUMENT_DECLINED",
        message: "The instrument presented was declined.",
      });
      expect(adapter.classifyError(error)).toEqual({
        category: "permanent",
        code: "INSTRUMENT_DECLINED",
        message: "The instrument presented was declined.",
        retryable: false,
      });
    });
  });

  describe("getPaymentStatus", () => {
    it("looks up captures by id and treats refunded captures as paid", async () => {
      const capture = {
        id: "CAPTURE-1",
        status: "REFUNDED",
        amount: { value: "50.00", currency_code: "CAD" },
        supplementary_data: { related_ids: { order_id: "ORDER-1" } },
      };
      const fetchMock = mockPayPal(jsonResponse(200, capture));
      const adapter = new PayPalPaymentAdapter();

      const result = await adapter.getPaymentStatus({
        providerPaymentId: "CAPTURE-1",
      });

      expect(apiCalls(fetchMock)[0]?.[0]).toBe(
        `${API_BASE_URL}/v2/payments/captures/CAPTURE-1`,
      );
      expect(result).toMatchObject({
        providerPaymentId: "CAPTURE-1",
        providerOrderId: "ORDER-1",
        status: "COMPLETED",
        amount: 50,
      });
    });

    it("prefers the known order id over the capture's related ids", async () => {
      mockPayPal(jsonResponse(200, { id: "CAPTURE-1", status: "PENDING" }));
      const adapter = new PayPalPaymentAdapter();

      await expect(
        adapter.getPaymentStatus({
          providerPaymentId: "CAPTURE-1",
          providerOrderId: "ORDER-KNOWN",
        }),
      ).resolves.toMatchObject({
        providerOrderId: "ORDER-KNOWN",
        status: "PENDING",
      });
    });

    it.each([
      ["APPROVED", "APPROVED"],
      ["VOIDED", "CANCELED"],
      ["CREATED", "PENDING"],
    ])("maps an uncaptured %s order to %s", async (orderStatus, expected) => {
      const order = { id: "ORDER-1", status: orderStatus };
      mockPayPal(jsonResponse(200, order));
      const adapter = new PayPalPaymentAdapter();

      await expect(
        adapter.getPaymentStatus({ providerOrderId: "ORDER-1" }),
      ).resolves.toEqual({
        providerOrderId: "ORDER-1",
        status: expected,
        raw: order,
      });
    });

    it("returns null when PayPal has no matching record", async () => {
      const fetchMock = mockPayPal(
        jsonResponse(404, { name: "RESOURCE_NOT_FOUND" }),
        new Response("", { status: 200 }),
        jsonResponse(200, {}),
      );
      const adapter = new PayPalPaymentAdapter();

      await expect(
        adapter.getPaymentStatus({ providerPaymentId: "CAPTURE-404" }),
      ).resolves.toBeNull();
      await expect(
        adapter.getPaymentStatus({ providerOrderId: "ORDER-EMPTY" }),
      ).resolves.toBeNull();
      await expect(
        adapter.getPaymentStatus({ providerPaymentId: "CAPTURE-EMPTY" }),
      ).resolves.toBeNull();
      await expect(adapter.getPaymentStatus({})).resolves.toBeNull();
      expect(apiCalls(fetchMock)).toHaveLength(3);
    });

    it("rethrows lookup failures other than not found", async () => {
      mockPayPal(new Response("", { status: 500 }));
      const adapter = new PayPalPaymentAdapter();

      const error = await captureError(
        adapter.getPaymentStatus({ providerOrderId: "ORDER-1" }),
      );

      expect(error).toMatchObject({
        status: 500,
        message: "PayPal request failed with 500.",
      });
      expect(adapter.classifyError(error)).toMatchObject({
        category: "transient",
        retryable: true,
      });
    });
  });

  describe("createRefund", () => {
    it("simulates refunds in development when credentials are placeholders", async () => {
      mockGetEnvironment.mockReturnValue({
        paypal: {
          clientId: "change-me-paypal-client-id",
          clientSecret: "change-me-paypal-client-secret",
          webhookId: "change-me-paypal-webhook-id",
          environment: "sandbox",
          apiBaseUrl: API_BASE_URL,
        },
        application: { frontendUrl: "http://localhost:3040" },
      });
      mockIsDevelopment.mockReturnValue(true);
      const fetchMock = jest.spyOn(globalThis, "fetch");
      const adapter = new PayPalPaymentAdapter();

      await expect(
        adapter.createRefund({
          idempotencyKey: "refund-123",
          providerPaymentId: "CAPTURE-1",
          amount: 184.8,
          currency: "CAD",
          reason: "Renter cancelled before start.",
        }),
      ).resolves.toEqual({
        providerRefundId: "mock-refund-refund-123",
        status: "COMPLETED",
        raw: {
          mock: true,
          providerPaymentId: "CAPTURE-1",
          amount: 184.8,
          currency: "CAD",
          reason: "Renter cancelled before start.",
        },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refunds the capture with a truncated note to the payer", async () => {
      const fetchMock = mockPayPal(
        jsonResponse(201, { id: "REFUND-1", status: "COMPLETED" }),
      );
      const adapter = new PayPalPaymentAdapter();

      const result = await adapter.createRefund({
        idempotencyKey: "refund-1",
        providerPaymentId: "CAPTURE-1",
        amount: 42.5,
        currency: "CAD",
        reason: "x".repeat(300),
      });

      const [[url, init]] = apiCalls(fetchMock);
      expect(url).toBe(`${API_BASE_URL}/v2/payments/captures/CAPTURE-1/refund`);
      expect(requestHeaders(init)["PayPal-Request-Id"]).toBe("refund-1");
      expect(requestBody(init)).toEqual({
        amount: { value: "42.50", currency_code: "CAD" },
        note_to_payer: "x".repeat(255),
      });
      expect(result).toEqual({
        providerRefundId: "REFUND-1",
        status: "COMPLETED",
        raw: { id: "REFUND-1", status: "COMPLETED" },
      });
    });

    it.each([
      ["CANCELLED", "FAILED"],
      ["FAILED", "FAILED"],
      ["PENDING", "PENDING"],
      [undefined, "PENDING"],
    ])("maps a %s refund to %s", async (refundStatus, expected) => {
      const fetchMock = mockPayPal(
        jsonResponse(201, { id: "REFUND-1", status: refundStatus }),
      );
      const adapter = new PayPalPaymentAdapter();

      const result = await adapter.createRefund({
        idempotencyKey: "refund-1",
        providerPaymentId: "CAPTURE-1",
        amount: 10,
        currency: "CAD",
      });

      expect(result.status).toBe(expected);
      expect(requestBody(apiCalls(fetchMock)[0]![1])).not.toHaveProperty(
        "note_to_payer",
      );
    });
  });

  describe("verifyWebhookSignature", () => {
    const event = {
      id: "WH-EVENT-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAPTURE-1",
        supplementary_data: { related_ids: { order_id: "ORDER-1" } },
      },
    };

    it("verifies the event with PayPal and returns normalized details", async () => {
      const fetchMock = mockPayPal(
        jsonResponse(200, { verification_status: "SUCCESS" }),
      );
      const adapter = new PayPalPaymentAdapter();

      const result = await adapter.verifyWebhookSignature(
        JSON.stringify(event),
        WEBHOOK_HEADERS,
      );

      const [[url, init]] = apiCalls(fetchMock);
      expect(url).toBe(
        `${API_BASE_URL}/v1/notifications/verify-webhook-signature`,
      );
      expect(requestBody(init)).toEqual({
        auth_algo: "SHA256withRSA",
        cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/1",
        transmission_id: "transmission-1",
        transmission_sig: "signature-1",
        transmission_time: "2026-09-14T12:00:00Z",
        webhook_id: "WH-1",
        webhook_event: event,
      });
      expect(result).toEqual({
        isValid: true,
        eventId: "WH-EVENT-1",
        eventType: "PAYMENT.CAPTURE.COMPLETED",
        payload: event,
        details: {
          providerPaymentId: "CAPTURE-1",
          providerOrderId: "ORDER-1",
          status: "COMPLETED",
        },
      });
    });

    it("marks the event invalid when PayPal rejects the signature", async () => {
      mockPayPal(jsonResponse(200, { verification_status: "FAILURE" }));
      const adapter = new PayPalPaymentAdapter();

      await expect(
        adapter.verifyWebhookSignature(JSON.stringify(event), WEBHOOK_HEADERS),
      ).resolves.toMatchObject({ isValid: false });
    });

    it("rejects deliveries missing transmission headers without calling PayPal", async () => {
      const fetchMock = jest.spyOn(globalThis, "fetch");
      const adapter = new PayPalPaymentAdapter();

      await expect(
        adapter.verifyWebhookSignature("{}", {
          ...WEBHOOK_HEADERS,
          "paypal-transmission-sig": undefined,
        }),
      ).resolves.toEqual({
        isValid: false,
        eventId: "unknown",
        eventType: "unknown",
        payload: {},
        details: {},
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      [
        "CHECKOUT.ORDER.APPROVED",
        { id: "ORDER-1" },
        { providerOrderId: "ORDER-1", status: "APPROVED" },
      ],
      [
        "CHECKOUT.ORDER.VOIDED",
        { id: "ORDER-1" },
        { providerOrderId: "ORDER-1", status: "CANCELED" },
      ],
      [
        "PAYMENT.CAPTURE.PENDING",
        { id: "CAPTURE-1" },
        {
          providerPaymentId: "CAPTURE-1",
          providerOrderId: undefined,
          status: "PENDING",
        },
      ],
      [
        "PAYMENT.CAPTURE.DENIED",
        { id: "CAPTURE-1" },
        {
          providerPaymentId: "CAPTURE-1",
          providerOrderId: undefined,
          status: "FAILED",
        },
      ],
      [
        "PAYMENT.CAPTURE.DECLINED",
        { id: "CAPTURE-1" },
        {
          providerPaymentId: "CAPTURE-1",
          providerOrderId: undefined,
          status: "FAILED",
        },
      ],
      [
        "PAYMENT.CAPTURE.REFUNDED",
        { id: "REFUND-1", status: "COMPLETED" },
        { refund: { providerRefundId: "REFUND-1", status: "COMPLETED" } },
      ],
      [
        "PAYMENT.CAPTURE.REFUNDED",
        { id: "REFUND-1" },
        { refund: { providerRefundId: "REFUND-1", status: "COMPLETED" } },
      ],
      [
        "PAYMENT.REFUND.PENDING",
        { id: "REFUND-1" },
        { refund: { providerRefundId: "REFUND-1", status: "PENDING" } },
      ],
      [
        "PAYMENT.REFUND.FAILED",
        { id: "REFUND-1", status: "CANCELLED" },
        { refund: { providerRefundId: "REFUND-1", status: "FAILED" } },
      ],
      [
        "PAYMENT.REFUND.FAILED",
        { id: "REFUND-1" },
        { refund: { providerRefundId: "REFUND-1", status: "FAILED" } },
      ],
      ["PAYMENT.CAPTURE.REFUNDED", {}, {}],
      ["PAYMENT.CAPTURE.REVERSED", { id: "REFUND-1" }, {}],
    ])("reads %s webhook details", async (eventType, resource, details) => {
      const adapter = new PayPalPaymentAdapter();

      const result = await adapter.verifyWebhookSignature(
        JSON.stringify({ id: "WH-1", event_type: eventType, resource }),
        {},
      );

      expect(result.details).toEqual(details);
    });

    it("tolerates webhook events without a resource", async () => {
      const adapter = new PayPalPaymentAdapter();

      const result = await adapter.verifyWebhookSignature(
        JSON.stringify({ event_type: "CHECKOUT.ORDER.APPROVED" }),
        {},
      );

      expect(result.details).toEqual({
        providerOrderId: undefined,
        status: "APPROVED",
      });
    });
  });

  describe("errors", () => {
    it("surfaces OAuth error descriptions from the token endpoint", async () => {
      jest.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse(401, {
          error: "invalid_client",
          error_description: "Client Authentication failed",
        }),
      );
      const adapter = new PayPalPaymentAdapter();

      await expect(createSession(adapter)).rejects.toMatchObject({
        status: 401,
        code: "invalid_client",
        message: "Client Authentication failed",
      });
    });

    it("rejects token responses without an access token", async () => {
      jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(jsonResponse(200, { expires_in: 3600 }));
      const adapter = new PayPalPaymentAdapter();

      const error = await captureError(createSession(adapter));

      expect(adapter.classifyError(error)).toEqual({
        category: "transient",
        code: "INVALID_PROVIDER_RESPONSE",
        message: "PayPal did not return an access token.",
        retryable: true,
      });
    });

    it("refreshes tokens that arrive without an expiry on every request", async () => {
      const fetchMock = jest
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input) =>
          String(input) === TOKEN_URL
            ? jsonResponse(200, { access_token: "short-lived" })
            : jsonResponse(200, { id: "ORDER-1" }),
        );
      const adapter = new PayPalPaymentAdapter();

      await createSession(adapter);
      await createSession(adapter);

      expect(tokenCalls(fetchMock)).toBe(2);
    });

    it("classifies transport failures as transient provider outages", async () => {
      jest.spyOn(globalThis, "fetch").mockRejectedValue(
        Object.assign(new TypeError("fetch failed"), {
          cause: { code: "ECONNREFUSED" },
        }),
      );
      const adapter = new PayPalPaymentAdapter();

      const error = await captureError(createSession(adapter));

      expect(adapter.classifyError(error)).toEqual({
        category: "transient",
        code: "ECONNREFUSED",
        message: "PayPal request failed before receiving a response.",
        retryable: true,
      });
    });

    it("maps transport failures without a node error code", async () => {
      jest
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new TypeError("fetch failed"));
      const adapter = new PayPalPaymentAdapter();

      await expect(createSession(adapter)).rejects.toMatchObject({
        status: 503,
        code: "PROVIDER_NETWORK_ERROR",
      });
    });

    it("maps aborted requests to timeouts", async () => {
      jest
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(
          Object.assign(new Error("aborted"), { name: "AbortError" }),
        );
      const adapter = new PayPalPaymentAdapter();

      await expect(createSession(adapter)).rejects.toMatchObject({
        status: 504,
        code: "ETIMEDOUT",
        message: "PayPal request timed out.",
      });
    });

    it("classifies invalid JSON on successful responses as permanent", async () => {
      mockPayPal(new Response("not-json", { status: 200 }));
      const adapter = new PayPalPaymentAdapter();

      const error = await captureError(createSession(adapter));

      expect(adapter.classifyError(error)).toEqual({
        category: "permanent",
        code: "INVALID_PROVIDER_RESPONSE",
        message: "PayPal returned an invalid JSON response.",
        retryable: false,
      });
    });

    it("classifies invalid JSON on gateway failures as retryable", async () => {
      mockPayPal(new Response("<html>bad gateway</html>", { status: 502 }));
      const adapter = new PayPalPaymentAdapter();

      const error = await captureError(createSession(adapter));

      expect(adapter.classifyError(error)).toEqual({
        category: "transient",
        code: "INVALID_PROVIDER_RESPONSE",
        message: "PayPal returned an invalid JSON response.",
        retryable: true,
      });
    });

    it("classifies errors without an HTTP status by their socket code", () => {
      const adapter = new PayPalPaymentAdapter();

      expect(
        adapter.classifyError(
          Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
        ),
      ).toEqual({
        category: "transient",
        code: "ECONNRESET",
        message: "socket reset",
        retryable: true,
      });
      expect(adapter.classifyError("boom")).toEqual({
        category: "unknown",
        code: undefined,
        message: "PayPal request failed.",
        retryable: true,
      });
      expect(adapter.classifyError({ status: "bad", code: 42 })).toMatchObject({
        category: "unknown",
        code: undefined,
        message: "PayPal request failed.",
      });
    });
  });
});
