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
  squarePaymentId?: string;
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
  squareRefundId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface PayoutRecord {
  id: string;
  paymentId: string;
  ownerId: string;
  status: PayoutStatus;
  amount: number;
  dueAt: string;
  releasedAt?: string;
  failedAt?: string;
  squarePayoutId?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  bookingRequestId: string;
  postingId: string;
  renterId: string;
  ownerId: string;
  provider: "square";
  status: PaymentStatus;
  pricingCurrency: string;
  rentalSubtotalAmount: number;
  platformFeeAmount: number;
  totalAmount: number;
  squarePaymentId?: string;
  squareOrderId?: string;
  squareLocationId?: string;
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
