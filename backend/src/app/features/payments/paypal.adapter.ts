import { createHash } from "node:crypto";
import { environment, getEnvironment } from "@/configuration/environment/index";
import type { PaymentProviderAdapter } from "@/features/payments/payment-provider";
import type {
  CardAuthenticationResult,
  PaymentFailureCategory,
  PaymentMethod,
  PaymentWebhookDetails,
  PaymentWebhookHeaders,
  PaymentWebhookVerificationResult,
  ProviderErrorInfo,
  ProviderOrderDetails,
  ProviderPaymentSession,
  ProviderPaymentSessionRequest,
  ProviderPaymentSource,
  ProviderPaymentStatus,
  ProviderRefundResult,
} from "@/features/payments/payments.model";
import {
  classifyHttpError,
  formatMoneyValue,
} from "@/features/payments/payments.utils";

type PayPalApiErrorResponse = {
  name?: string;
  message?: string;
  details?: Array<{
    issue?: string;
    description?: string;
  }>;
  error?: string;
  error_description?: string;
};

type ProviderHttpError = Error & {
  status?: number;
  code?: string;
};

const PAYPAL_REQUEST_TIMEOUT_MS = 5_000;
/** Refresh the OAuth token a minute early so in-flight calls never see it expire. */
const ACCESS_TOKEN_EXPIRY_MARGIN_MS = 60_000;
/** PayPal rejects PayPal-Request-Id values longer than this. */
const MAX_REQUEST_ID_LENGTH = 108;
const MAX_REFUND_NOTE_LENGTH = 255;

const PAYMENT_SOURCE_KEYS: Record<string, ProviderPaymentSource> = {
  paypal: "paypal",
  card: "card",
  apple_pay: "apple_pay",
  google_pay: "google_pay",
  venmo: "venmo",
};

function readPath(input: unknown, path: Array<string | number>): unknown {
  let current: unknown = input;

  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }

      current = current[segment];
      continue;
    }

    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !(segment in current)
    ) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function readRecord(
  input: unknown,
  path: Array<string | number>,
): Record<string, unknown> | undefined {
  const value = readPath(input, path);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(
  input: unknown,
  path: Array<string | number>,
): string | undefined {
  const value = readPath(input, path);
  return typeof value === "string" ? value : undefined;
}

function readNumber(
  input: unknown,
  path: Array<string | number>,
): number | undefined {
  const value = readPath(input, path);
  return typeof value === "number" ? value : undefined;
}

function createProviderError(
  message: string,
  status: number | undefined,
  code: string | undefined,
): ProviderHttpError {
  const error = new Error(message) as ProviderHttpError;
  error.status = status;
  error.code = code;
  return error;
}

export class PayPalPaymentAdapter implements PaymentProviderAdapter {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly webhookId: string;
  private readonly apiBaseUrl: string;
  private readonly frontendUrl: string;
  private cachedAccessToken?: { value: string; expiresAt: number };

  constructor() {
    const environment = getEnvironment();
    this.clientId = environment.paypal.clientId;
    this.clientSecret = environment.paypal.clientSecret;
    this.webhookId = environment.paypal.webhookId;
    this.apiBaseUrl = environment.paypal.apiBaseUrl;
    this.frontendUrl = environment.application.frontendUrl;
  }

  async createPaymentSession(
    input: ProviderPaymentSessionRequest,
  ): Promise<ProviderPaymentSession> {
    const returnUrl = `${this.frontendUrl}/payments/${input.paymentId}/return`;
    const paymentSource = this.buildPaymentSource(input.method, returnUrl);
    const response = await this.requestJson("/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.bookingRequestId,
            custom_id: input.paymentId,
            description: `Rentify booking ${input.bookingRequestId}`,
            amount: {
              currency_code: input.currency,
              value: formatMoneyValue(input.amount),
            },
          },
        ],
        ...(paymentSource ? { payment_source: paymentSource } : {}),
      }),
      headers: this.mutationHeaders(input.idempotencyKey),
    });

    return {
      checkoutUrl:
        this.readLink(response.body, "payer-action") ??
        this.readLink(response.body, "approve"),
      providerRequestId: response.requestId,
      providerPaymentId: undefined,
      providerOrderId: readString(response.body, ["id"]),
      raw: response.body,
    };
  }

  async capturePayment(input: {
    providerOrderId: string;
    idempotencyKey: string;
  }): Promise<ProviderPaymentStatus> {
    try {
      const response = await this.requestJson(
        `/v2/checkout/orders/${encodeURIComponent(input.providerOrderId)}/capture`,
        {
          method: "POST",
          body: "{}",
          headers: this.mutationHeaders(input.idempotencyKey),
        },
      );

      return this.mapOrder(response.body);
    } catch (error) {
      // A second capture (e.g. webhook and return page racing) is not a
      // failure: report whatever state the order already reached.
      if ((error as ProviderHttpError).code === "ORDER_ALREADY_CAPTURED") {
        const status = await this.getPaymentStatus({
          providerOrderId: input.providerOrderId,
        });

        if (status) {
          return status;
        }
      }

      throw error;
    }
  }

  async getPaymentStatus(input: {
    providerPaymentId?: string;
    providerOrderId?: string;
  }): Promise<ProviderPaymentStatus | null> {
    if (input.providerPaymentId) {
      const body = await this.requestJsonOrNull(
        `/v2/payments/captures/${encodeURIComponent(input.providerPaymentId)}`,
      );

      if (!body || !readString(body, ["id"])) {
        return null;
      }

      return this.mapCapture(
        body,
        input.providerOrderId ??
          readString(body, ["supplementary_data", "related_ids", "order_id"]),
        body,
      );
    }

    if (input.providerOrderId) {
      const body = await this.requestJsonOrNull(
        `/v2/checkout/orders/${encodeURIComponent(input.providerOrderId)}`,
      );

      if (!body || !readString(body, ["id"])) {
        return null;
      }

      return this.mapOrder(body);
    }

    return null;
  }

  async createRefund(input: {
    idempotencyKey: string;
    providerPaymentId: string;
    amount: number;
    currency: string;
    reason?: string | null;
  }): Promise<ProviderRefundResult> {
    if (this.shouldSimulateRefunds()) {
      return {
        providerRefundId: `mock-refund-${input.idempotencyKey}`,
        status: "COMPLETED",
        raw: {
          mock: true,
          providerPaymentId: input.providerPaymentId,
          amount: input.amount,
          currency: input.currency,
          reason: input.reason ?? undefined,
        },
      };
    }

    const response = await this.requestJson(
      `/v2/payments/captures/${encodeURIComponent(input.providerPaymentId)}/refund`,
      {
        method: "POST",
        body: JSON.stringify({
          amount: {
            value: formatMoneyValue(input.amount),
            currency_code: input.currency,
          },
          note_to_payer: input.reason
            ? input.reason.slice(0, MAX_REFUND_NOTE_LENGTH)
            : undefined,
        }),
        headers: this.mutationHeaders(input.idempotencyKey),
      },
    );

    return {
      providerRefundId: readString(response.body, ["id"]),
      status: this.normalizeRefundStatus(
        readString(response.body, ["status"]) ?? "PENDING",
      ),
      raw: response.body,
    };
  }

  async verifyWebhookSignature(
    rawBody: string,
    headers: PaymentWebhookHeaders,
  ): Promise<PaymentWebhookVerificationResult> {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const eventType = readString(payload, ["event_type"]) ?? "unknown";

    return {
      isValid: await this.verifyWithPayPal(payload, headers),
      eventId: readString(payload, ["id"]) ?? "unknown",
      eventType,
      payload,
      details: this.readWebhookDetails(eventType, payload),
    };
  }

  classifyError(error: unknown): ProviderErrorInfo {
    if (typeof error === "object" && error !== null && "status" in error) {
      const status = (error as { status?: unknown }).status;
      const message =
        error instanceof Error ? error.message : "PayPal request failed.";
      const codeValue = (error as { code?: unknown }).code;
      const code = typeof codeValue === "string" ? codeValue : undefined;
      if (code === "INVALID_PROVIDER_RESPONSE") {
        if (typeof status === "number" && (status >= 500 || status === 429)) {
          return classifyHttpError(status, message, code);
        }

        return {
          category: "permanent",
          code,
          message,
          retryable: false,
        };
      }
      return classifyHttpError(
        typeof status === "number" ? status : undefined,
        message,
        code,
      );
    }

    const codeValue =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    const code = typeof codeValue === "string" ? codeValue : undefined;
    const transientCodes = new Set([
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ABORT_ERR",
      "EPIPE",
    ]);
    const category: PaymentFailureCategory =
      code && transientCodes.has(code) ? "transient" : "unknown";

    return {
      category,
      code,
      message:
        error instanceof Error ? error.message : "PayPal request failed.",
      retryable: true,
    };
  }

  private async verifyWithPayPal(
    payload: Record<string, unknown>,
    headers: PaymentWebhookHeaders,
  ): Promise<boolean> {
    const authAlgo = headers["paypal-auth-algo"];
    const certUrl = headers["paypal-cert-url"];
    const transmissionId = headers["paypal-transmission-id"];
    const transmissionSig = headers["paypal-transmission-sig"];
    const transmissionTime = headers["paypal-transmission-time"];

    if (
      !authAlgo ||
      !certUrl ||
      !transmissionId ||
      !transmissionSig ||
      !transmissionTime
    ) {
      return false;
    }

    const response = await this.requestJson(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: JSON.stringify({
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: this.webhookId,
          webhook_event: payload,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    return readString(response.body, ["verification_status"]) === "SUCCESS";
  }

  /**
   * The `payment_source` for a new order. Guest checkout attaches its source
   * when the SDK confirms the order, so it sends none.
   */
  private buildPaymentSource(
    method: PaymentMethod,
    returnUrl: string,
  ): Record<string, unknown> | undefined {
    const experienceContext = {
      return_url: returnUrl,
      cancel_url: `${returnUrl}?cancelled=1`,
    };
    const scaWhenRequired = {
      verification: {
        method: "SCA_WHEN_REQUIRED",
      },
    };

    switch (method) {
      case "paypal_redirect":
      case "paypal":
        // The SDK can fall back to a full-page redirect, so embedded PayPal
        // orders keep the return URL too.
        return {
          paypal: {
            experience_context: {
              ...experienceContext,
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
            },
          },
        };
      case "card":
        return {
          card: {
            attributes: scaWhenRequired,
            experience_context: experienceContext,
          },
        };
      case "paypal_guest":
        return undefined;
    }
  }

  private readOrderDetails(
    body: Record<string, unknown>,
  ): ProviderOrderDetails {
    const paymentSource = readRecord(body, ["payment_source"]);
    const sourceKey = paymentSource ? Object.keys(paymentSource)[0] : undefined;
    const amountValue = readString(body, [
      "purchase_units",
      0,
      "amount",
      "value",
    ]);

    return {
      paymentSource: sourceKey
        ? (PAYMENT_SOURCE_KEYS[sourceKey] ?? "unknown")
        : undefined,
      cardAuthentication: this.readCardAuthentication(paymentSource),
      customId: readString(body, ["purchase_units", 0, "custom_id"]),
      amount: amountValue === undefined ? undefined : Number(amountValue),
      currency: readString(body, [
        "purchase_units",
        0,
        "amount",
        "currency_code",
      ]),
    };
  }

  private readCardAuthentication(
    paymentSource: Record<string, unknown> | undefined,
  ): CardAuthenticationResult | undefined {
    const result = readRecord(paymentSource, ["card", "authentication_result"]);

    if (!result) {
      return undefined;
    }

    return {
      liabilityShift: readString(result, ["liability_shift"]),
      enrollmentStatus: readString(result, [
        "three_d_secure",
        "enrollment_status",
      ]),
      authenticationStatus: readString(result, [
        "three_d_secure",
        "authentication_status",
      ]),
    };
  }

  private readWebhookDetails(
    eventType: string,
    payload: Record<string, unknown>,
  ): PaymentWebhookDetails {
    const resource = readRecord(payload, ["resource"]) ?? {};

    switch (eventType) {
      case "CHECKOUT.ORDER.APPROVED":
        return {
          providerOrderId: readString(resource, ["id"]),
          status: "APPROVED",
        };
      case "CHECKOUT.ORDER.VOIDED":
        return {
          providerOrderId: readString(resource, ["id"]),
          status: "CANCELED",
        };
      case "PAYMENT.CAPTURE.COMPLETED":
      case "PAYMENT.CAPTURE.PENDING":
      case "PAYMENT.CAPTURE.DECLINED":
      case "PAYMENT.CAPTURE.DENIED":
        return {
          providerPaymentId: readString(resource, ["id"]),
          providerOrderId: readString(resource, [
            "supplementary_data",
            "related_ids",
            "order_id",
          ]),
          status:
            eventType === "PAYMENT.CAPTURE.COMPLETED"
              ? "COMPLETED"
              : eventType === "PAYMENT.CAPTURE.PENDING"
                ? "PENDING"
                : "FAILED",
        };
      case "PAYMENT.CAPTURE.REFUNDED":
      case "PAYMENT.REFUND.PENDING":
      case "PAYMENT.REFUND.FAILED": {
        const providerRefundId = readString(resource, ["id"]);

        if (!providerRefundId) {
          return {};
        }

        return {
          refund: {
            providerRefundId,
            status: this.normalizeRefundStatus(
              readString(resource, ["status"]) ??
                (eventType === "PAYMENT.CAPTURE.REFUNDED"
                  ? "COMPLETED"
                  : eventType === "PAYMENT.REFUND.FAILED"
                    ? "FAILED"
                    : "PENDING"),
            ),
          },
        };
      }
      default:
        return {};
    }
  }

  private mapOrder(body: Record<string, unknown>): ProviderPaymentStatus {
    const orderId = readString(body, ["id"]);
    const capture = readRecord(body, [
      "purchase_units",
      0,
      "payments",
      "captures",
      0,
    ]);

    if (capture) {
      return {
        ...this.mapCapture(capture, orderId, body),
        order: this.readOrderDetails(body),
      };
    }

    const orderStatus = readString(body, ["status"]);

    return {
      providerOrderId: orderId,
      status:
        orderStatus === "APPROVED"
          ? "APPROVED"
          : orderStatus === "VOIDED"
            ? "CANCELED"
            : "PENDING",
      order: this.readOrderDetails(body),
      raw: body,
    };
  }

  private mapCapture(
    capture: Record<string, unknown>,
    providerOrderId: string | undefined,
    raw: Record<string, unknown>,
  ): ProviderPaymentStatus {
    const captureStatus = readString(capture, ["status"]) ?? "PENDING";
    const status = this.normalizeCaptureStatus(captureStatus);
    const amountValue = readString(capture, ["amount", "value"]);

    return {
      providerPaymentId: readString(capture, ["id"]),
      providerOrderId,
      status,
      amount: amountValue === undefined ? undefined : Number(amountValue),
      currency: readString(capture, ["amount", "currency_code"]),
      failureCode: status === "FAILED" ? captureStatus : undefined,
      failureMessage: readString(capture, ["status_details", "reason"]),
      raw,
    };
  }

  private readLink(
    body: Record<string, unknown>,
    rel: string,
  ): string | undefined {
    const links = readPath(body, ["links"]);

    if (!Array.isArray(links)) {
      return undefined;
    }

    const link = links.find((item) => readString(item, ["rel"]) === rel);
    return readString(link, ["href"]);
  }

  private mutationHeaders(idempotencyKey: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "PayPal-Request-Id": this.toRequestId(idempotencyKey),
      Prefer: "return=representation",
    };
  }

  private toRequestId(idempotencyKey: string): string {
    return idempotencyKey.length <= MAX_REQUEST_ID_LENGTH
      ? idempotencyKey
      : createHash("sha256").update(idempotencyKey).digest("hex");
  }

  private async requestJsonOrNull(
    path: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.requestJson(path, { method: "GET" });
      return response.body;
    } catch (error) {
      if ((error as ProviderHttpError).status === 404) {
        return null;
      }

      throw error;
    }
  }

  private async requestJson(
    path: string,
    init: RequestInit,
  ): Promise<{ body: Record<string, unknown>; requestId?: string }> {
    const accessToken = await this.getAccessToken();

    try {
      return await this.send(path, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      if ((error as ProviderHttpError).status === 401) {
        this.cachedAccessToken = undefined;
      }

      throw error;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.cachedAccessToken &&
      this.cachedAccessToken.expiresAt > Date.now()
    ) {
      return this.cachedAccessToken.value;
    }

    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");
    const response = await this.send("/v1/oauth2/token", {
      method: "POST",
      body: "grant_type=client_credentials",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    const accessToken = readString(response.body, ["access_token"]);

    if (!accessToken) {
      throw createProviderError(
        "PayPal did not return an access token.",
        502,
        "INVALID_PROVIDER_RESPONSE",
      );
    }

    const expiresInMs = (readNumber(response.body, ["expires_in"]) ?? 0) * 1000;
    this.cachedAccessToken = {
      value: accessToken,
      expiresAt:
        Date.now() + Math.max(0, expiresInMs - ACCESS_TOKEN_EXPIRY_MARGIN_MS),
    };

    return accessToken;
  }

  private async send(
    path: string,
    init: RequestInit,
  ): Promise<{ body: Record<string, unknown>; requestId?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      PAYPAL_REQUEST_TIMEOUT_MS,
    );
    let response: Response;

    try {
      response = await fetch(`${this.apiBaseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      throw this.toTransportError(error);
    } finally {
      clearTimeout(timeoutId);
    }

    const requestId = response.headers.get("paypal-debug-id") ?? undefined;
    const text = await response.text();
    const body = this.parseResponseBody(text, response.status);

    if (!response.ok) {
      const errorBody = body as PayPalApiErrorResponse;
      throw createProviderError(
        errorBody.details?.[0]?.description ??
          errorBody.message ??
          errorBody.error_description ??
          `PayPal request failed with ${response.status}.`,
        response.status,
        errorBody.details?.[0]?.issue ?? errorBody.name ?? errorBody.error,
      );
    }

    return {
      body,
      requestId,
    };
  }

  private parseResponseBody(
    text: string,
    status: number,
  ): Record<string, unknown> {
    if (text.length === 0) {
      return {};
    }

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw createProviderError(
        "PayPal returned an invalid JSON response.",
        status,
        "INVALID_PROVIDER_RESPONSE",
      );
    }
  }

  private toTransportError(error: unknown): ProviderHttpError {
    const aborted = this.isAbortError(error);

    return createProviderError(
      aborted
        ? "PayPal request timed out."
        : "PayPal request failed before receiving a response.",
      aborted ? 504 : 503,
      aborted
        ? "ETIMEDOUT"
        : (this.readNodeErrorCode(error) ?? "PROVIDER_NETWORK_ERROR"),
    );
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  private readNodeErrorCode(error: unknown): string | undefined {
    return readString(error, ["code"]) ?? readString(error, ["cause", "code"]);
  }

  private normalizeCaptureStatus(
    status: string,
  ): ProviderPaymentStatus["status"] {
    switch (status) {
      case "COMPLETED":
      // A refunded capture was still paid; refunds are tracked separately.
      case "PARTIALLY_REFUNDED":
      case "REFUNDED":
        return "COMPLETED";
      case "DECLINED":
      case "FAILED":
        return "FAILED";
      default:
        return "PENDING";
    }
  }

  private normalizeRefundStatus(
    status: string,
  ): ProviderRefundResult["status"] {
    switch (status) {
      case "COMPLETED":
        return "COMPLETED";
      case "FAILED":
      case "CANCELLED":
        return "FAILED";
      default:
        return "PENDING";
    }
  }

  private shouldSimulateRefunds(): boolean {
    return (
      environment.isDevelopment() &&
      [this.clientId, this.clientSecret, this.webhookId].some((value) =>
        this.isPlaceholderCredential(value),
      )
    );
  }

  private isPlaceholderCredential(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized.length === 0 || normalized.startsWith("change-me-");
  }
}
