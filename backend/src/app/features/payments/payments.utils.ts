import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  PaymentFailureCategory,
  ProviderErrorInfo,
} from "@/features/payments/payments.model";

export function createPaymentIdempotencyKey(provided?: string): string {
  const normalized = provided?.trim();
  return normalized && normalized.length > 0 ? normalized : randomUUID();
}

export function moneyToMinorUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 100));
}

export function minorUnitsToMoney(amount: bigint | number): number {
  const numeric = typeof amount === "bigint" ? Number(amount) : amount;
  return numeric / 100;
}

export function calculatePlatformFeeAmount(
  totalAmount: number,
  feeBps: number,
): number {
  return Math.round(totalAmount * (feeBps / 10_000) * 100) / 100;
}

export function createExponentialBackoffDate(
  retryCount: number,
  baseDelayMs: number,
  maxDelayMs: number,
): Date {
  const cappedRetry = Math.min(retryCount, 8);
  const delay = Math.min(baseDelayMs * 2 ** cappedRetry, maxDelayMs);
  const jitter = Math.floor(
    Math.random() * Math.max(250, Math.floor(delay * 0.1)),
  );

  return new Date(Date.now() + delay + jitter);
}

export function verifySquareSignature(input: {
  signatureKey: string;
  notificationUrl: string;
  rawBody: string;
  signatureHeader?: string;
}): boolean {
  if (!input.signatureHeader) {
    return false;
  }

  const payload = `${input.notificationUrl}${input.rawBody}`;
  const digest = createHmac("sha256", input.signatureKey)
    .update(payload)
    .digest("base64");

  const expected = Buffer.from(digest);
  const actual = Buffer.from(input.signatureHeader);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

export function classifyHttpError(
  status: number | undefined,
  fallbackMessage: string,
  fallbackCode?: string,
): ProviderErrorInfo {
  if (status === undefined) {
    return {
      category: "unknown",
      code: fallbackCode,
      message: fallbackMessage,
      retryable: true,
    };
  }

  const category: PaymentFailureCategory =
    status >= 500 || status === 429
      ? "transient"
      : status >= 400
        ? "permanent"
        : "unknown";

  return {
    category,
    code: fallbackCode ?? String(status),
    message: fallbackMessage,
    retryable: category === "transient",
  };
}
