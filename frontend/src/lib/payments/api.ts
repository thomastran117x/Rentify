import { authenticatedJson, buildPathWithQuery } from "@/lib/api/client";
import type { Pagination } from "@/lib/api/types";

export type PaymentStatus =
  | "awaiting_method"
  | "processing"
  | "succeeded"
  | "failed_retryable"
  | "failed_final"
  | "cancelled"
  | "refunded"
  | "partially_refunded";
export type PaymentAttemptStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed_retryable"
  | "failed_final";
export type PaymentFailureCategory = "transient" | "permanent" | "unknown";
export type RefundStatus = "pending" | "succeeded" | "failed";
export type PayoutStatus = "scheduled" | "released" | "failed";
/** Checkout methods embedded on the checkout page through the PayPal JS SDK. */
export type CheckoutPaymentMethod = "paypal" | "paypal_guest" | "card";
/** `paypal_redirect` sends the renter to PayPal's hosted page. */
export type PaymentMethod = "paypal_redirect" | CheckoutPaymentMethod;

export interface PaymentAttemptRecord {
  id: string;
  paymentId: string;
  idempotencyKey: string;
  status: PaymentAttemptStatus;
  retryCount: number;
  failureCategory?: PaymentFailureCategory;
  failureCode?: string;
  failureMessage?: string;
  providerRequestId?: string;
  providerPaymentId?: string;
  providerOrderId?: string;
  paymentMethod?: PaymentMethod;
  nextRetryAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefundRecord {
  id: string;
  paymentId: string;
  status: RefundStatus;
  amount: number;
  reason?: string;
  idempotencyKey: string;
  providerRefundId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface PayoutRecord {
  id: string;
  paymentId: string;
  organizationId: string;
  status: PayoutStatus;
  amount: number;
  dueAt: string;
  releasedAt?: string;
  failedAt?: string;
  providerPayoutId?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  bookingRequestId: string;
  postingId: string;
  renterId: string;
  organizationId: string;
  provider: "paypal";
  status: PaymentStatus;
  pricingCurrency: string;
  rentalSubtotalAmount: number;
  platformFeeAmount: number;
  totalAmount: number;
  providerPaymentId?: string;
  providerOrderId?: string;
  checkoutUrl?: string;
  lastAttemptedAt?: string;
  succeededAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  booking: {
    id: string;
    status: string;
    startAt: string;
    endAt: string;
    holdExpiresAt: string;
    paymentReconciliationRequired: boolean;
  };
  attempts: PaymentAttemptRecord[];
  refunds: RefundRecord[];
  payout?: PayoutRecord;
}

export interface PayoutListResult {
  payouts: PayoutRecord[];
  pagination: Pagination;
  status?: PayoutStatus;
}

export interface CreatePaymentSessionInput {
  idempotencyKey?: string;
  method?: PaymentMethod;
}

export interface CapturePaymentInput {
  /** The approved order; the API refuses to capture it if it was replaced. */
  orderId?: string;
}

export interface CancelCheckoutInput {
  /** The abandoned order; the API refuses to cancel it if it was replaced. */
  orderId?: string;
}

export type CheckoutIneligibleReason =
  | "hold_expired"
  | "already_paid"
  | "converted"
  | "reconciliation"
  | "not_payable";

/** `error.details.reason` on checkout 409 responses. */
export type PaymentConflictReason =
  | "payment_in_progress"
  | "checkout_busy"
  | "stale_order"
  | "reconciliation_required";

export interface CheckoutSummary {
  serverTime: string;
  booking: {
    id: string;
    status: string;
    startAt: string;
    endAt: string;
    durationDays: number;
    guestCount: number;
    holdExpiresAt: string;
    dailyPriceAmount: number;
    currency: string;
  };
  posting: {
    id: string;
    name: string;
    primaryPhotoUrl?: string;
  };
  pricing: {
    currency: string;
    stayTotal: number;
    depositAmount: number;
    platformFeeAmount: number;
    totalDueNow: number;
    remainingBalance: number;
    depositBps: number | null;
    platformFeeBps: number | null;
    source: "payment" | "quote";
  };
  cancellationPolicy: {
    code: string;
    fullRefundCutoffHours: number;
    partialRefundCutoffHours: number;
    partialRefundPercent: number;
    ownerCancellationFullRefund: boolean;
    refundBase: "total_paid";
    hostNotes?: string;
  };
  checkout: {
    eligible: boolean;
    reason?: CheckoutIneligibleReason;
  };
  payment: {
    id: string;
    status: PaymentStatus;
    providerOrderId?: string;
    method?: PaymentMethod;
  } | null;
  paypal: {
    clientId: string;
    environment: "sandbox" | "production";
    enabledMethods: CheckoutPaymentMethod[];
  };
}

export interface RetryPaymentInput {
  idempotencyKey?: string;
}

export interface CreatePaymentRefundInput {
  amount: number;
  reason?: string | null;
  idempotencyKey?: string;
}

export interface ListPayoutsFilters {
  page?: number;
  pageSize?: number;
  status?: PayoutStatus;
}

function toIdempotencyHeaders(
  idempotencyKey?: string,
): Record<string, string> | undefined {
  if (!idempotencyKey) {
    return undefined;
  }

  return {
    "idempotency-key": idempotencyKey,
    "x-idempotency-key": idempotencyKey,
  };
}

export const paymentsApi = {
  createSession(
    bookingRequestId: string,
    input: CreatePaymentSessionInput = {},
  ): Promise<PaymentRecord> {
    return authenticatedJson<PaymentRecord, CreatePaymentSessionInput>(
      "POST",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/payment-session`,
      input,
      toIdempotencyHeaders(input.idempotencyKey),
    );
  },
  getById(paymentId: string): Promise<PaymentRecord> {
    return authenticatedJson<PaymentRecord>(
      "GET",
      `/payments/${encodeURIComponent(paymentId)}`,
    );
  },
  getCheckoutSummary(bookingRequestId: string): Promise<CheckoutSummary> {
    return authenticatedJson<CheckoutSummary>(
      "GET",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/checkout`,
    );
  },
  getByBookingRequest(bookingRequestId: string): Promise<PaymentRecord> {
    return authenticatedJson<PaymentRecord>(
      "GET",
      `/booking-requests/${encodeURIComponent(bookingRequestId)}/payment`,
    );
  },
  capture(
    paymentId: string,
    input: CapturePaymentInput = {},
  ): Promise<PaymentRecord> {
    return authenticatedJson<PaymentRecord, CapturePaymentInput>(
      "POST",
      `/payments/${encodeURIComponent(paymentId)}/capture`,
      input,
    );
  },
  cancelCheckout(
    paymentId: string,
    input: CancelCheckoutInput = {},
  ): Promise<PaymentRecord> {
    return authenticatedJson<PaymentRecord, CancelCheckoutInput>(
      "POST",
      `/payments/${encodeURIComponent(paymentId)}/cancel-checkout`,
      input,
    );
  },
  retry(
    paymentId: string,
    input: RetryPaymentInput = {},
  ): Promise<PaymentRecord> {
    return authenticatedJson<PaymentRecord, RetryPaymentInput>(
      "POST",
      `/payments/${encodeURIComponent(paymentId)}/retry`,
      input,
      toIdempotencyHeaders(input.idempotencyKey),
    );
  },
  createRefund(
    paymentId: string,
    input: CreatePaymentRefundInput,
  ): Promise<PaymentRecord> {
    return authenticatedJson<PaymentRecord, CreatePaymentRefundInput>(
      "POST",
      `/payments/${encodeURIComponent(paymentId)}/refunds`,
      input,
      toIdempotencyHeaders(input.idempotencyKey),
    );
  },
  reconcile(paymentId: string): Promise<PaymentRecord> {
    return authenticatedJson<PaymentRecord, Record<string, never>>(
      "POST",
      `/payments/${encodeURIComponent(paymentId)}/reconcile`,
      {},
    );
  },
  repair(paymentId: string): Promise<PaymentRecord> {
    return authenticatedJson<PaymentRecord, Record<string, never>>(
      "POST",
      `/payments/${encodeURIComponent(paymentId)}/repair`,
      {},
    );
  },
  listPayouts(filters: ListPayoutsFilters = {}): Promise<PayoutListResult> {
    return authenticatedJson<PayoutListResult>(
      "GET",
      buildPathWithQuery("/payouts/me", {
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 20,
        status: filters.status,
      }),
    );
  },
};
