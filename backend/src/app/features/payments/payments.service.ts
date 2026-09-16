import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import ServiceNotAvaliableError from "@/errors/http/service-not-avaliable.error";
import type { CacheService } from "@/features/cache/cache.service";
import { flowLockKeys, withFlowLock } from "@/features/cache/cache-locks";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { PaymentProviderAdapter } from "@/features/payments/payment-provider";
import type {
  CreatePaymentSessionInput,
  CreateRefundInput,
  ListPayoutsInput,
  PaymentRecord,
  PaymentWebhookDetails,
  PaymentWebhookHeaders,
  PayoutListResult,
  ProviderPaymentStatus,
  RetryPaymentInput,
  StoredRefundReference,
} from "@/features/payments/payments.model";
import { PaymentsRepository } from "@/features/payments/payments.repository";
import { createPaymentIdempotencyKey } from "@/features/payments/payments.utils";
import { asOptionalUuid, type Uuid } from "@/configuration/validation/uuid";

const RECONCILIATION_REQUIRED_MESSAGE =
  "Payment succeeded, but the booking now requires reconciliation before it can be finalized.";

/** Payment statuses that already hold a captured charge. */
const CAPTURED_PAYMENT_STATUSES = new Set([
  "succeeded",
  "refunded",
  "partially_refunded",
]);

/**
 * Each provider order is captured at most once, so every capture path (return
 * page, webhook, reconcile, repair) shares one idempotency key per order.
 */
function createCaptureIdempotencyKey(providerOrderId: string): string {
  return `capture-${providerOrderId}`;
}

type ProviderStatusResult = {
  payment: PaymentRecord | null;
  reconciliationRequired: boolean;
};

export class PaymentsService {
  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly paymentProvider: PaymentProviderAdapter,
    private readonly postingsAnalyticsRepository: PostingsAnalyticsRepository,
    private readonly postingsRepository: PostingsRepository,
    private readonly cacheService: CacheService,
    private readonly postingsPublicCacheService: PostingsPublicCacheService,
    private readonly organizationAccessService: OrganizationAccessService,
  ) {}

  async createPaymentSession(
    input: CreatePaymentSessionInput,
  ): Promise<PaymentRecord> {
    const idempotencyKey = createPaymentIdempotencyKey(input.idempotencyKey);
    const attempt =
      await this.paymentsRepository.createPaymentAttemptForBooking({
        bookingRequestId: input.bookingRequestId,
        renterId: input.renterId,
        idempotencyKey,
      });

    const existingAttempt = attempt.payment.attempts.find(
      (item) => item.id === attempt.attemptId && item.providerRequestId,
    );

    if (existingAttempt) {
      return attempt.payment;
    }

    try {
      const session = await this.paymentProvider.createPaymentSession({
        idempotencyKey,
        amount: attempt.amount,
        currency: attempt.currency,
        bookingRequestId: input.bookingRequestId,
        paymentId: attempt.paymentId,
      });

      const payment = await this.paymentsRepository.attachPaymentSession(
        attempt.paymentId,
        attempt.attemptId,
        session,
      );
      await this.enqueueSearchSync(payment.postingId);
      return payment;
    } catch (error) {
      const errorInfo = this.paymentProvider.classifyError(error);
      const payment = await this.paymentsRepository.recordAttemptFailure(
        attempt.paymentId,
        attempt.attemptId,
        errorInfo,
      );
      await this.enqueuePaymentFailedAnalytics(payment);
      await this.enqueueSearchSync(payment.postingId);
      return payment;
    }
  }

  async retryPayment(input: RetryPaymentInput): Promise<PaymentRecord> {
    const payment = await this.requirePaymentAccess(
      input.paymentId,
      input.renterId,
      "manage",
    );

    if (!["failed_retryable", "failed_final"].includes(payment.status)) {
      throw new BadRequestError("This payment is not eligible for retry.");
    }

    return this.createPaymentSession({
      bookingRequestId: payment.bookingRequestId,
      renterId: input.renterId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async getPaymentById(paymentId: Uuid, userId: Uuid): Promise<PaymentRecord> {
    return this.requirePaymentAccess(paymentId, userId, "read");
  }

  async getPaymentByBookingRequest(
    bookingRequestId: Uuid,
    userId: Uuid,
  ): Promise<PaymentRecord> {
    const payment =
      await this.paymentsRepository.findByBookingRequestId(bookingRequestId);

    if (!payment) {
      throw new ResourceNotFoundError("Payment could not be found.");
    }

    return this.requirePaymentRecordAccess(payment, userId, "read");
  }

  /**
   * Captures the provider order the buyer approved. Capturing finalizes the
   * booking, so only the renter or a member who can manage the organization's
   * payments may do it. Called when the buyer is
   * redirected back from checkout; the webhook and repair paths cover buyers
   * who never make it back.
   */
  async capturePayment(paymentId: Uuid, userId: Uuid): Promise<PaymentRecord> {
    const payment = await this.requirePaymentAccess(
      paymentId,
      userId,
      "manage",
    );

    if (CAPTURED_PAYMENT_STATUSES.has(payment.status)) {
      return payment;
    }

    if (!payment.providerOrderId) {
      throw new BadRequestError(
        "This payment does not have a PayPal order to capture yet.",
      );
    }

    let captured: ProviderPaymentStatus;

    try {
      captured = await this.paymentProvider.capturePayment({
        providerOrderId: payment.providerOrderId,
        idempotencyKey: createCaptureIdempotencyKey(payment.providerOrderId),
      });
    } catch (error) {
      const errorInfo = this.paymentProvider.classifyError(error);

      if (errorInfo.retryable) {
        throw new ServiceNotAvaliableError(
          "PayPal is temporarily unavailable. Please try again.",
        );
      }

      // Declined instruments and similar rejections end this order; the renter
      // can start a new checkout through the retry endpoint.
      const failed = await this.applyProviderStatus(
        {
          providerOrderId: payment.providerOrderId,
          status: "FAILED",
          failureCode: errorInfo.code,
          failureMessage: errorInfo.message,
          raw: {
            code: errorInfo.code,
            message: errorInfo.message,
          },
        },
        payment,
      );
      return failed.payment ?? payment;
    }

    const result = await this.applyProviderStatus(captured, payment);

    if (result.reconciliationRequired) {
      throw new ConflictError(RECONCILIATION_REQUIRED_MESSAGE);
    }

    return result.payment ?? payment;
  }

  /**
   * Records that the buyer left PayPal without approving, so the payment can be
   * retried. If PayPal shows the order was approved or paid after all, that
   * outcome is applied instead.
   */
  async cancelCheckout(paymentId: Uuid, userId: Uuid): Promise<PaymentRecord> {
    const payment = await this.requirePaymentAccess(
      paymentId,
      userId,
      "manage",
    );

    if (payment.status !== "processing" || !payment.providerOrderId) {
      return payment;
    }

    let status: ProviderPaymentStatus | null;

    try {
      status = await this.paymentProvider.getPaymentStatus({
        providerOrderId: payment.providerOrderId,
      });
    } catch {
      throw new ServiceNotAvaliableError(
        "PayPal is temporarily unavailable. Please try again.",
      );
    }

    if (status && status.status !== "PENDING") {
      const result = await this.applyProviderStatus(status, payment);

      if (result.reconciliationRequired) {
        throw new ConflictError(RECONCILIATION_REQUIRED_MESSAGE);
      }

      return result.payment ?? payment;
    }

    const cancelledCheckout = await this.applyProviderStatus(
      {
        providerOrderId: payment.providerOrderId,
        status: "CANCELED",
        failureCode: "CHECKOUT_CANCELLED",
        failureMessage:
          "Checkout was cancelled before the payment was approved.",
        raw: {
          reason: "buyer_cancelled_checkout",
        },
      },
      payment,
    );

    return cancelledCheckout.payment ?? payment;
  }

  async createRefund(input: CreateRefundInput): Promise<PaymentRecord> {
    await this.requirePaymentAccess(
      input.paymentId,
      input.actorUserId,
      "manage",
    );

    const idempotencyKey = createPaymentIdempotencyKey(input.idempotencyKey);
    const { refundId, providerPaymentId, pricingCurrency } =
      await this.paymentsRepository.createRefundRecord({
        ...input,
        idempotencyKey,
      });

    const result = await this.paymentProvider.createRefund({
      idempotencyKey,
      providerPaymentId,
      amount: input.amount,
      currency: pricingCurrency,
      reason: input.reason,
    });

    const payment = await this.paymentsRepository.completeRefund(
      refundId,
      result,
    );
    // A pending refund is recorded when PayPal's completion webhook arrives.
    if (result.status === "COMPLETED") {
      await this.enqueueRefundRecordedAnalytics(payment, input.amount);
    }
    await this.enqueueSearchSync(payment.postingId);
    return payment;
  }

  async listPayouts(input: ListPayoutsInput): Promise<PayoutListResult> {
    const membership =
      await this.organizationAccessService.requireActiveMembership(
        input.actorUserId,
        "Select or join an organization before viewing payouts.",
      );
    this.organizationAccessService.assertCanManage(
      membership,
      "You do not have permission to view payouts for this organization.",
    );

    return this.paymentsRepository.listPayoutsForOrganization({
      ...input,
      organizationId: membership.organizationId,
    });
  }

  async processPaymentWebhook(
    rawBody: string,
    headers: PaymentWebhookHeaders,
  ): Promise<void> {
    const verification = await this.paymentProvider.verifyWebhookSignature(
      rawBody,
      headers,
    );
    const { details } = verification;
    const refund = details.refund
      ? await this.paymentsRepository.findRefundByProviderRefundId(
          details.refund.providerRefundId,
        )
      : null;
    const payment = await this.paymentsRepository.findByProviderReferences({
      providerPaymentId: details.providerPaymentId,
      providerOrderId: details.providerOrderId,
    });

    const stored = await this.paymentsRepository.upsertWebhookEvent({
      providerEventId: verification.eventId,
      eventType: verification.eventType,
      signatureValid: verification.isValid,
      payload: verification.payload,
      paymentId: asOptionalUuid(payment?.id ?? refund?.paymentId),
    });

    if (!verification.isValid) {
      throw new BadRequestError(
        "PayPal webhook signature verification failed.",
      );
    }

    if (stored.alreadyProcessed) {
      return;
    }

    if (details.refund) {
      // A refund Rentify has no record of stays unprocessed so it can be
      // reconciled by hand instead of being silently dropped.
      if (!refund) {
        return;
      }

      await this.applyRefundStatus(
        refund,
        details.refund,
        verification.payload,
      );
    } else if (details.status) {
      const failed =
        details.status === "FAILED" || details.status === "CANCELED";

      // A webhook never throws for reconciliation: the booking is flagged and
      // the repair worker finishes it.
      await this.applyProviderStatus(
        {
          providerPaymentId: details.providerPaymentId,
          providerOrderId: details.providerOrderId,
          status: details.status,
          raw: verification.payload,
          ...(failed
            ? {
                failureCode: verification.eventType,
                failureMessage: `PayPal webhook reported ${verification.eventType}.`,
              }
            : {}),
        },
        payment,
      );
    }

    await this.paymentsRepository.markWebhookProcessed(verification.eventId);
  }

  async reconcilePayment(
    paymentId: Uuid,
    userId: Uuid,
  ): Promise<PaymentRecord> {
    const payment = await this.requirePaymentAccess(
      paymentId,
      userId,
      "manage",
    );
    const status = await this.paymentProvider.getPaymentStatus({
      providerPaymentId: payment.providerPaymentId,
      providerOrderId: payment.providerOrderId,
    });

    if (!status) {
      throw new ResourceNotFoundError(
        "Provider payment could not be found for reconciliation.",
      );
    }

    const result = await this.applyProviderStatus(status, payment);

    if (!result.payment) {
      throw new ResourceNotFoundError("Payment could not be reconciled.");
    }

    if (result.reconciliationRequired) {
      throw new ConflictError(RECONCILIATION_REQUIRED_MESSAGE);
    }

    return result.payment;
  }

  async repairPayment(paymentId: Uuid): Promise<void> {
    const payment = await this.paymentsRepository.findById(paymentId);

    if (!payment) {
      return;
    }

    const status = await this.paymentProvider.getPaymentStatus({
      providerPaymentId: payment.providerPaymentId,
      providerOrderId: payment.providerOrderId,
    });

    if (!status) {
      return;
    }

    await this.applyProviderStatus(status, payment);
  }

  async processRetryQueue(limit: number): Promise<number> {
    const candidates = await this.paymentsRepository.listRetryCandidates(limit);

    for (const candidate of candidates) {
      const ready = await this.paymentsRepository.markAttemptForRetry(
        candidate.attemptId,
      );

      if (!ready) {
        continue;
      }

      try {
        const session = await this.paymentProvider.createPaymentSession({
          idempotencyKey: ready.idempotencyKey,
          amount: ready.amount,
          currency: ready.currency,
          bookingRequestId: ready.bookingRequestId,
          paymentId: ready.paymentId,
        });

        const payment = await this.paymentsRepository.attachPaymentSession(
          ready.paymentId,
          candidate.attemptId,
          session,
        );
        await this.enqueueSearchSync(payment.postingId);
      } catch (error) {
        const errorInfo = this.paymentProvider.classifyError(error);
        const payment = await this.paymentsRepository.recordAttemptFailure(
          ready.paymentId,
          candidate.attemptId,
          errorInfo,
        );
        await this.enqueuePaymentFailedAnalytics(payment);
        await this.enqueueSearchSync(payment.postingId);
      }
    }

    return candidates.length;
  }

  async processRepairQueue(limit: number): Promise<number> {
    const candidates =
      await this.paymentsRepository.listRepairCandidates(limit);

    for (const candidate of candidates) {
      await this.repairPayment(candidate.paymentId);
    }

    return candidates.length;
  }

  async processDuePayouts(limit: number): Promise<number> {
    const payouts = await this.paymentsRepository.listDuePayouts(limit);

    for (const payout of payouts) {
      try {
        await this.paymentsRepository.markPayoutReleased(payout.id);
      } catch (error) {
        await this.paymentsRepository.markPayoutFailed(
          payout.id,
          error instanceof Error ? error.message : "Payout release failed.",
        );
      }
    }

    return payouts.length;
  }

  /**
   * Moves a payment to match the provider's state: captures approved orders,
   * finalizes completed charges, and records failures.
   */
  private async applyProviderStatus(
    status: ProviderPaymentStatus,
    payment: PaymentRecord | null,
  ): Promise<ProviderStatusResult> {
    switch (status.status) {
      case "APPROVED": {
        const providerOrderId =
          status.providerOrderId ?? payment?.providerOrderId;

        if (!payment || !providerOrderId) {
          return { payment, reconciliationRequired: false };
        }

        const captured = await this.paymentProvider.capturePayment({
          providerOrderId,
          idempotencyKey: createCaptureIdempotencyKey(providerOrderId),
        });

        // Guard against re-capturing forever if the order is still APPROVED.
        if (captured.status === "APPROVED") {
          return { payment, reconciliationRequired: false };
        }

        return this.applyProviderStatus(captured, payment);
      }
      case "COMPLETED": {
        const result = await this.markCompletedPaymentStatus(
          status,
          payment?.postingId,
        );
        await this.enqueueSearchSync(result.payment?.postingId);
        return result;
      }
      case "FAILED":
      case "CANCELED": {
        const failed = await this.paymentsRepository.markPaymentFailed(
          status,
          status.status === "FAILED" ? "permanent" : "unknown",
        );
        await this.enqueuePaymentFailedAnalytics(failed);
        await this.enqueueSearchSync(failed?.postingId);
        return { payment: failed, reconciliationRequired: false };
      }
      default:
        return { payment, reconciliationRequired: false };
    }
  }

  /** Finalizes a refund that PayPal first reported as pending. */
  private async applyRefundStatus(
    refund: StoredRefundReference,
    update: NonNullable<PaymentWebhookDetails["refund"]>,
    raw: Record<string, unknown>,
  ): Promise<void> {
    if (refund.status !== "pending" || update.status === "PENDING") {
      return;
    }

    const payment = await this.paymentsRepository.completeRefund(
      refund.refundId,
      {
        providerRefundId: update.providerRefundId,
        status: update.status,
        raw,
      },
    );

    if (update.status === "COMPLETED") {
      await this.enqueueRefundRecordedAnalytics(
        payment,
        payment.refunds.find((item) => item.id === refund.refundId)?.amount ??
          0,
      );
    }

    await this.enqueueSearchSync(payment.postingId);
  }

  private async enqueueRefundRecordedAnalytics(
    payment: PaymentRecord,
    refundedAmount: number,
  ): Promise<void> {
    await this.postingsAnalyticsRepository.enqueueRefundRecordedEvent({
      postingId: payment.postingId,
      organizationId: payment.organizationId,
      occurredAt: new Date().toISOString(),
      refundedAmount,
    });
  }

  private async enqueueSearchSync(postingId?: Uuid): Promise<void> {
    if (!postingId) {
      return;
    }

    await invalidatePublicPostingProjection(
      this.postingsPublicCacheService,
      postingId,
    );
    await this.postingsRepository.enqueueSearchSync(postingId);
  }

  private async enqueuePaymentFailedAnalytics(
    payment?: PaymentRecord | null,
  ): Promise<void> {
    if (!payment) {
      return;
    }

    await this.postingsAnalyticsRepository.enqueuePaymentFailedEvent({
      postingId: payment.postingId,
      organizationId: payment.organizationId,
      occurredAt: payment.failedAt ?? new Date().toISOString(),
    });
  }

  private async requirePaymentAccess(
    paymentId: Uuid,
    userId: Uuid,
    access: "read" | "manage",
  ): Promise<PaymentRecord> {
    const payment = await this.paymentsRepository.findById(paymentId);

    if (!payment) {
      throw new ResourceNotFoundError("Payment could not be found.");
    }

    return this.requirePaymentRecordAccess(payment, userId, access);
  }

  private async requirePaymentRecordAccess(
    payment: PaymentRecord,
    userId: Uuid,
    access: "read" | "manage",
  ): Promise<PaymentRecord> {
    if (payment.renterId === userId) {
      return payment;
    }

    const membership = await this.organizationAccessService.requireMembership(
      userId,
      payment.organizationId,
      "You do not have access to this payment.",
    );

    if (access === "manage") {
      this.organizationAccessService.assertCanManage(
        membership,
        "You do not have permission to manage this payment.",
      );
    }

    return payment;
  }

  private async markCompletedPaymentStatus(
    status: ProviderPaymentStatus,
    postingId?: Uuid,
  ): Promise<ProviderStatusResult> {
    const existingPayment =
      postingId === undefined
        ? await this.paymentsRepository.findByProviderReferences({
            providerPaymentId: status.providerPaymentId,
            providerOrderId: status.providerOrderId,
          })
        : null;
    const lockPostingId = postingId ?? existingPayment?.postingId;

    if (!lockPostingId) {
      return this.paymentsRepository.markPaymentSucceeded(status);
    }

    return withFlowLock(
      this.cacheService,
      flowLockKeys.postingBookingWindow(lockPostingId),
      () => this.paymentsRepository.markPaymentSucceeded(status),
      "Another request is already finalizing a booking window for this posting. Please retry.",
    );
  }
}
