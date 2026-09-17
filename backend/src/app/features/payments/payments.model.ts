import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@/features/postings/postings.model";
import type { Uuid } from "@/configuration/validation/uuid";

export const PAYMENT_PROVIDER = "paypal" as const;
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
  id: Uuid;
  paymentId: Uuid;
  idempotencyKey: string;
  status: PaymentAttemptStatus;
  retryCount: number;
  failureCategory?: PaymentFailureCategory;
  failureCode?: string;
  failureMessage?: string;
  providerRequestId?: string;
  providerPaymentId?: string;
  nextRetryAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefundRecord {
  id: Uuid;
  paymentId: Uuid;
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
  id: Uuid;
  paymentId: Uuid;
  organizationId: Uuid;
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
  id: Uuid;
  bookingRequestId: Uuid;
  postingId: Uuid;
  renterId: Uuid;
  organizationId: Uuid;
  provider: typeof PAYMENT_PROVIDER;
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
    id: Uuid;
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
  bookingRequestId: Uuid;
  renterId: Uuid;
  idempotencyKey?: string;
}

export interface RetryPaymentInput {
  paymentId: Uuid;
  renterId: Uuid;
  idempotencyKey?: string;
}

export interface CreateRefundInput {
  paymentId: Uuid;
  actorUserId: Uuid;
  amount: number;
  reason?: string | null;
  idempotencyKey?: string;
}

export interface ListPayoutsInput {
  actorUserId: Uuid;
  page: number;
  pageSize: number;
  status?: PayoutStatus;
}

/** ListPayoutsInput once the service has resolved the owning organization. */
export interface ListPayoutsPersistenceInput extends ListPayoutsInput {
  organizationId: Uuid;
}

export interface ProviderPaymentSession {
  checkoutUrl?: string;
  providerRequestId?: string;
  providerPaymentId?: string;
  providerOrderId?: string;
  raw: Record<string, unknown>;
}

/**
 * APPROVED means the buyer approved the order but the charge has not been
 * captured yet; the service captures it before treating it as paid.
 */
export interface ProviderPaymentStatus {
  providerPaymentId?: string;
  providerOrderId?: string;
  status: "PENDING" | "APPROVED" | "COMPLETED" | "FAILED" | "CANCELED";
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
  paymentId: Uuid;
  idempotencyKey: string;
  retryCount: number;
}

export interface PaymentRepairCandidate {
  paymentId: Uuid;
  bookingRequestId: Uuid;
  providerPaymentId?: string;
  status: PaymentStatus;
  bookingStatus: string;
}

/** The transmission headers PayPal signs every webhook delivery with. */
export const PAYMENT_WEBHOOK_HEADER_NAMES = [
  "paypal-auth-algo",
  "paypal-cert-url",
  "paypal-transmission-id",
  "paypal-transmission-sig",
  "paypal-transmission-time",
] as const;

export type PaymentWebhookHeaders = Partial<
  Record<(typeof PAYMENT_WEBHOOK_HEADER_NAMES)[number], string>
>;

/** Provider references and status carried by a webhook event, if any. */
export interface PaymentWebhookDetails {
  providerPaymentId?: string;
  providerOrderId?: string;
  status?: ProviderPaymentStatus["status"];
  /** Set for refund lifecycle events, which reference a refund, not a payment. */
  refund?: {
    providerRefundId: string;
    status: ProviderRefundResult["status"];
  };
}

/** A stored refund located by the provider's refund id. */
export interface StoredRefundReference {
  refundId: string;
  paymentId: Uuid;
  status: RefundStatus;
}

export interface PaymentWebhookVerificationResult {
  isValid: boolean;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  details: PaymentWebhookDetails;
}
