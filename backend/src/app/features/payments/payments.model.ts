import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/features/postings/postings.model";

export const PAYMENT_PROVIDER = "square" as const;
export const DEFAULT_PLATFORM_FEE_BPS = 1000;
export const DEFAULT_BOOKING_DEPOSIT_BPS = 2500;
export const MAX_RETRY_ATTEMPTS = 5;
export const PAYMENT_PROCESSING_TIMEOUT_MINUTES = 15;

export const paymentStatusSchema = z.enum([
  "awaiting_method",
  "processing",
  "succeeded",
  "failed_retryable",
  "failed_final",
  "cancelled",
  "refunded",
  "partially_refunded",
]);

export const paymentAttemptStatusSchema = z.enum([
  "pending",
  "processing",
  "succeeded",
  "failed_retryable",
  "failed_final",
]);

export const paymentFailureCategorySchema = z.enum([
  "transient",
  "permanent",
  "unknown",
]);

export const refundStatusSchema = z.enum(["pending", "succeeded", "failed"]);
export const payoutStatusSchema = z.enum(["scheduled", "released", "failed"]);

export const createPaymentSessionSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
});

export const retryPaymentSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
});

export const createRefundSchema = z.object({
  amount: z.coerce.number().positive("Refund amount must be positive."),
  reason: z.string().trim().min(1).max(1000).optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
});

export const listPayoutsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  status: payoutStatusSchema.optional(),
});

export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type PaymentAttemptStatus = z.infer<typeof paymentAttemptStatusSchema>;
export type PaymentFailureCategory = z.infer<
  typeof paymentFailureCategorySchema
>;
export type RefundStatus = z.infer<typeof refundStatusSchema>;
export type PayoutStatus = z.infer<typeof payoutStatusSchema>;
export type CreatePaymentSessionBody = z.infer<
  typeof createPaymentSessionSchema
>;
export type RetryPaymentBody = z.infer<typeof retryPaymentSchema>;
export type CreateRefundBody = z.infer<typeof createRefundSchema>;
export type ListPayoutsQuery = z.infer<typeof listPayoutsQuerySchema>;

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
  organizationId: string;
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
  organizationId: string;
  provider: typeof PAYMENT_PROVIDER;
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
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  status?: PayoutStatus;
}

export interface CreatePaymentSessionInput {
  bookingRequestId: string;
  renterId: string;
  idempotencyKey?: string;
}

export interface RetryPaymentInput {
  paymentId: string;
  renterId: string;
  idempotencyKey?: string;
}

export interface CreateRefundInput {
  paymentId: string;
  actorUserId: string;
  amount: number;
  reason?: string | null;
  idempotencyKey?: string;
}

export interface ListPayoutsInput {
  actorUserId: string;
  organizationId: string;
  page: number;
  pageSize: number;
  status?: PayoutStatus;
}

export interface ProviderPaymentSession {
  checkoutUrl?: string;
  providerRequestId?: string;
  providerPaymentId?: string;
  providerOrderId?: string;
  locationId?: string;
  raw: Record<string, unknown>;
}

export interface ProviderPaymentStatus {
  providerPaymentId?: string;
  providerOrderId?: string;
  status: "PENDING" | "COMPLETED" | "FAILED" | "CANCELED";
  amount?: number;
  currency?: string;
  raw: Record<string, unknown>;
  failureCode?: string;
  failureMessage?: string;
}

export interface ProviderRefundResult {
  providerRefundId?: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  raw: Record<string, unknown>;
}

export interface ProviderErrorInfo {
  category: PaymentFailureCategory;
  code?: string;
  message: string;
  retryable: boolean;
}

export interface PaymentRetryCandidate {
  attemptId: string;
  paymentId: string;
  idempotencyKey: string;
  retryCount: number;
}

export interface PaymentRepairCandidate {
  paymentId: string;
  bookingRequestId: string;
  squarePaymentId?: string;
  status: PaymentStatus;
  bookingStatus: string;
}

export interface SquareWebhookVerificationResult {
  isValid: boolean;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}
