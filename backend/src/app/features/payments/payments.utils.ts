import { randomUUID } from "node:crypto";
import type {
  CardAuthenticationResult,
  PaymentFailureCategory,
  ProviderErrorInfo,
} from "@/features/payments/payments.model";
import { PAYMENT_FAILURE_CODES } from "@/features/payments/payments.model";

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

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * What a booking charges at checkout: a deposit share of the stay total plus
 * the platform fee on that deposit. The rest of the stay is not charged by
 * Rentify.
 */
export function calculateBookingCharge(
  estimatedTotal: number,
  rates: { depositBps: number; platformFeeBps: number },
): { depositAmount: number; platformFeeAmount: number; totalAmount: number } {
  const depositAmount = roundMoney(
    estimatedTotal * (rates.depositBps / 10_000),
  );
  const platformFeeAmount = calculatePlatformFeeAmount(
    depositAmount,
    rates.platformFeeBps,
  );

  return {
    depositAmount,
    platformFeeAmount,
    totalAmount: roundMoney(depositAmount + platformFeeAmount),
  };
}

/** Compares two money amounts at cent precision. */
export function isSameMoneyAmount(left: number, right: number): boolean {
  return Math.round(left * 100) === Math.round(right * 100);
}

export type CardAuthenticationDecision =
  | { capture: true }
  | { capture: false; code: string; message: string };

const CAPTURABLE_ENROLLMENT_WITHOUT_LIABILITY_SHIFT = new Set(["N", "U", "B"]);
const RETRYABLE_AUTHENTICATION_STATUSES = new Set(["U", "C"]);

/**
 * Decides whether a card order may be captured from its 3-D Secure result,
 * following PayPal's recommended actions. Only the server-fetched order is
 * trusted; a client-reported liability shift is never an input.
 */
export function evaluateCardAuthentication(
  result: CardAuthenticationResult | undefined,
): CardAuthenticationDecision {
  // 3DS did not run (SCA_WHEN_REQUIRED decided it was not needed).
  if (!result?.liabilityShift) {
    return { capture: true };
  }

  const liabilityShift = result.liabilityShift.toUpperCase();
  const enrollment = result.enrollmentStatus?.toUpperCase();
  const authentication = result.authenticationStatus?.toUpperCase();

  if (liabilityShift === "POSSIBLE" || liabilityShift === "YES") {
    return { capture: true };
  }

  if (
    liabilityShift === "NO" &&
    enrollment &&
    CAPTURABLE_ENROLLMENT_WITHOUT_LIABILITY_SHIFT.has(enrollment) &&
    !authentication
  ) {
    // The card is not enrolled in 3DS, so there is nothing to authenticate.
    return { capture: true };
  }

  if (
    liabilityShift === "NO" &&
    (!authentication || !RETRYABLE_AUTHENTICATION_STATUSES.has(authentication))
  ) {
    return {
      capture: false,
      code: PAYMENT_FAILURE_CODES.cardAuthenticationFailed,
      message:
        "Your bank could not verify this card. Try again or use another payment method.",
    };
  }

  return {
    capture: false,
    code: PAYMENT_FAILURE_CODES.cardAuthenticationUnavailable,
    message:
      "Card verification is unavailable right now. Try again or use another payment method.",
  };
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

/** Formats an amount as the two-decimal string PayPal expects, e.g. "12.50". */
export function formatMoneyValue(amount: number): string {
  return (Math.round(amount * 100) / 100).toFixed(2);
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
