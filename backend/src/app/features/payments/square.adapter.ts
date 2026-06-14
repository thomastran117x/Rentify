import { environment, getEnvironment } from "@/configuration/environment/index";
import type { PaymentProviderAdapter } from "@/features/payments/payment-provider";
import type {
  PaymentFailureCategory,
  ProviderErrorInfo,
  ProviderPaymentSession,
  ProviderPaymentStatus,
  ProviderRefundResult,
  SquareWebhookVerificationResult,
} from "@/features/payments/payments.model";
import {
  classifyHttpError,
  moneyToMinorUnits,
  verifySquareSignature,
} from "@/features/payments/payments.utils";

type SquareApiErrorResponse = {
  errors?: Array<{
    category?: string;
    code?: string;
    detail?: string;
  }>;
};

const SQUARE_REQUEST_TIMEOUT_MS = 5_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNestedRecord(
  input: Record<string, unknown>,
  path: string[],
): Record<string, unknown> | undefined {
  let current: unknown = input;

  for (const segment of path) {
    if (!isPlainObject(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment];
  }

  return isPlainObject(current) ? current : undefined;
}

function readNestedString(
  input: Record<string, unknown>,
  path: string[],
): string | undefined {
  let current: unknown = input;

  for (const segment of path) {
    if (!isPlainObject(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment];
  }

  return typeof current === "string" ? current : undefined;
}

function readNestedNumber(
  input: Record<string, unknown>,
  path: string[],
): number | undefined {
  let current: unknown = input;

  for (const segment of path) {
    if (!isPlainObject(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment];
  }

  return typeof current === "number" ? current : undefined;
}

export class SquarePaymentAdapter implements PaymentProviderAdapter {
  private readonly accessToken: string;
  private readonly locationId: string;
  private readonly webhookSignatureKey: string;
  private readonly apiBaseUrl: string;
  private readonly webhookNotificationUrl: string;

  constructor() {
    const environment = getEnvironment();
    this.accessToken = environment.square.accessToken;
    this.locationId = environment.square.locationId;
    this.webhookSignatureKey = environment.square.webhookSignatureKey;
    this.apiBaseUrl = environment.square.apiBaseUrl;
    this.webhookNotificationUrl = environment.square.webhookNotificationUrl;
  }

  async createPaymentSession(input: {
    idempotencyKey: string;
    amount: number;
    currency: string;
    bookingRequestId: string;
    paymentId: string;
  }): Promise<ProviderPaymentSession> {
    const payload = {
      idempotency_key: input.idempotencyKey,
      order: {
        location_id: this.locationId,
        reference_id: input.bookingRequestId,
        line_items: [
          {
            name: `Rentify booking ${input.bookingRequestId}`,
            quantity: "1",
            base_price_money: {
              amount: Number(moneyToMinorUnits(input.amount)),
              currency: input.currency,
            },
          },
        ],
      },
      checkout_options: {
        redirect_url: `${getEnvironment().oauth.google.frontendBaseUrl}/payments/${input.paymentId}/return`,
      },
      pre_populated_data: {},
    };

    const response = await this.requestJson(
      "/v2/online-checkout/payment-links",
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    const body = response.body;
    const paymentLink = readNestedRecord(body, ["payment_link"]);
    const order = readNestedRecord(body, ["related_resources", "orders"]);

    return {
      checkoutUrl: readNestedString(body, ["payment_link", "url"]),
      providerRequestId: response.requestId,
      providerPaymentId: undefined,
      providerOrderId:
        readNestedString(body, ["payment_link", "order_id"]) ??
        readNestedString(order ?? {}, ["0", "id"]),
      locationId: this.locationId,
      raw: body,
    };
  }

  async getPaymentStatus(input: {
    providerPaymentId?: string;
    providerOrderId?: string;
  }): Promise<ProviderPaymentStatus | null> {
    if (input.providerPaymentId) {
      const response = await this.requestJson(
        `/v2/payments/${input.providerPaymentId}`,
        {
          method: "GET",
        },
      );
      const payment = readNestedRecord(response.body, ["payment"]);

      if (!payment) {
        return null;
      }

      return {
        providerPaymentId: readNestedString(response.body, ["payment", "id"]),
        providerOrderId: readNestedString(response.body, [
          "payment",
          "order_id",
        ]),
        status: this.normalizePaymentStatus(
          readNestedString(response.body, ["payment", "status"]) ?? "PENDING",
        ),
        amount: this.readMoneyAmount(payment),
        currency: readNestedString(response.body, [
          "payment",
          "amount_money",
          "currency",
        ]),
        failureCode: readNestedString(response.body, [
          "payment",
          "card_details",
          "status",
        ]),
        failureMessage: readNestedString(response.body, [
          "payment",
          "delay_action",
        ]),
        raw: response.body,
      };
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

    const response = await this.requestJson("/v2/refunds", {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: input.idempotencyKey,
        payment_id: input.providerPaymentId,
        amount_money: {
          amount: Number(moneyToMinorUnits(input.amount)),
          currency: input.currency,
        },
        reason: input.reason ?? undefined,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    return {
      providerRefundId: readNestedString(response.body, ["refund", "id"]),
      status: this.normalizeRefundStatus(
        readNestedString(response.body, ["refund", "status"]) ?? "PENDING",
      ),
      raw: response.body,
    };
  }

  verifyWebhookSignature(
    rawBody: string,
    signatureHeader: string | undefined,
  ): SquareWebhookVerificationResult {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;

    return {
      isValid: verifySquareSignature({
        signatureKey: this.webhookSignatureKey,
        notificationUrl: this.webhookNotificationUrl,
        rawBody,
        signatureHeader,
      }),
      eventId: readNestedString(payload, ["event_id"]) ?? "unknown",
      eventType: readNestedString(payload, ["type"]) ?? "unknown",
      payload,
    };
  }

  classifyError(error: unknown): ProviderErrorInfo {
    if (typeof error === "object" && error !== null && "status" in error) {
      const status = (error as { status?: unknown }).status;
      const message =
        error instanceof Error ? error.message : "Square request failed.";
      const codeValue = (error as { code?: unknown }).code;
      const code = typeof codeValue === "string" ? codeValue : undefined;
      if (code === "INVALID_PROVIDER_RESPONSE") {
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
        error instanceof Error ? error.message : "Square request failed.",
      retryable: true,
    };
  }

  private async requestJson(
    path: string,
    init: RequestInit,
  ): Promise<{ body: Record<string, unknown>; requestId?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      SQUARE_REQUEST_TIMEOUT_MS,
    );
    let response: Response;

    try {
      response = await fetch(`${this.apiBaseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Square-Version": "2026-01-15",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw this.toSquareTransportError(error);
    } finally {
      clearTimeout(timeoutId);
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;
    const text = await response.text();
    const body = this.parseSquareResponseBody(text, response.status);

    if (!response.ok) {
      const error = new Error(
        this.readSquareErrorMessage(body) ??
          `Square request failed with ${response.status}.`,
      ) as Error & {
        status?: number;
        code?: string;
      };
      const firstError = (body as SquareApiErrorResponse).errors?.[0];
      error.status = response.status;
      error.code = firstError?.code;
      throw error;
    }

    return {
      body,
      requestId,
    };
  }

  private parseSquareResponseBody(
    text: string,
    status: number,
  ): Record<string, unknown> {
    if (text.length === 0) {
      return {};
    }

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      const error = new Error(
        "Square returned an invalid JSON response.",
      ) as Error & {
        status?: number;
        code?: string;
      };
      error.status = status;
      error.code = "INVALID_PROVIDER_RESPONSE";
      throw error;
    }
  }

  private toSquareTransportError(error: unknown): Error & {
    status?: number;
    code?: string;
  } {
    const mapped = new Error(
      this.isAbortError(error)
        ? "Square request timed out."
        : "Square request failed before receiving a response.",
    ) as Error & {
      status?: number;
      code?: string;
    };

    mapped.status = this.isAbortError(error) ? 504 : 503;
    mapped.code = this.isAbortError(error)
      ? "ETIMEDOUT"
      : this.readNodeErrorCode(error) ?? "PROVIDER_NETWORK_ERROR";
    return mapped;
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  private readNodeErrorCode(error: unknown): string | undefined {
    const directCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (typeof directCode === "string") {
      return directCode;
    }

    if (typeof error !== "object" || error === null || !("cause" in error)) {
      return undefined;
    }

    const cause = (error as { cause?: unknown }).cause;

    if (typeof cause !== "object" || cause === null || !("code" in cause)) {
      return undefined;
    }

    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }

  private readSquareErrorMessage(
    body: Record<string, unknown>,
  ): string | undefined {
    const errors = (body as SquareApiErrorResponse).errors;
    return errors?.[0]?.detail;
  }

  private normalizePaymentStatus(
    status: string,
  ): ProviderPaymentStatus["status"] {
    switch (status) {
      case "COMPLETED":
        return "COMPLETED";
      case "FAILED":
        return "FAILED";
      case "CANCELED":
        return "CANCELED";
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
      case "REJECTED":
        return "FAILED";
      default:
        return "PENDING";
    }
  }

  private readMoneyAmount(
    payment: Record<string, unknown>,
  ): number | undefined {
    const amountMinor = readNestedNumber(payment, ["amount_money", "amount"]);
    return amountMinor === undefined ? undefined : amountMinor / 100;
  }

  private shouldSimulateRefunds(): boolean {
    return (
      environment.isDevelopment() &&
      [this.accessToken, this.locationId, this.webhookSignatureKey].some(
        (value) => this.isPlaceholderCredential(value),
      )
    );
  }

  private isPlaceholderCredential(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized.length === 0 || normalized.startsWith("change-me-");
  }
}
