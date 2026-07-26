import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
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
  PayoutListResult,
  ProviderPaymentStatus,
  RetryPaymentInput,
} from "@/features/payments/payments.model";
import { PaymentsRepository } from "@/features/payments/payments.repository";
import { createPaymentIdempotencyKey } from "@/features/payments/payments.utils";

function readEventPaymentDetails(payload: Record<string, unknown>): {
  paymentId?: string;
  orderId?: string;
  refundId?: string;
  status?: string;
} {
  const entity = (payload.data as Record<string, unknown> | undefined)
    ?.object as Record<string, unknown> | undefined;
  const payment =
    (entity?.payment as Record<string, unknown> | undefined) ?? entity;
  const refund =
    (entity?.refund as Record<string, unknown> | undefined) ?? entity;

  return {
    paymentId:
      (payment?.id as string | undefined) ??
      ((payload.payment_id as string | undefined) || undefined),
    orderId:
      (payment?.order_id as string | undefined) ??
      ((payload.order_id as string | undefined) || undefined),
    refundId:
      (refund?.id as string | undefined) ??
      ((payload.refund_id as string | undefined) || undefined),
    status:
      (payment?.status as string | undefined) ??
      (refund?.status as string | undefined),
  };
}

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

  async getPaymentById(
    paymentId: string,
    userId: string,
  ): Promise<PaymentRecord> {
    return this.requirePaymentAccess(paymentId, userId, "read");
  }

  async getPaymentByBookingRequest(
    bookingRequestId: string,
    userId: string,
  ): Promise<PaymentRecord> {
    const payment =
      await this.paymentsRepository.findByBookingRequestId(bookingRequestId);

    if (!payment) {
      throw new ResourceNotFoundError("Payment could not be found.");
    }

    return this.requirePaymentRecordAccess(payment, userId, "read");
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
    await this.postingsAnalyticsRepository.enqueueRefundRecordedEvent({
      postingId: payment.postingId,
      organizationId: payment.organizationId,
      occurredAt: new Date().toISOString(),
      refundedAmount: input.amount,
    });
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

  async processSquareWebhook(
    rawBody: string,
    signatureHeader: string | undefined,
  ): Promise<void> {
    const verification = this.paymentProvider.verifyWebhookSignature(
      rawBody,
      signatureHeader,
    );

    const details = readEventPaymentDetails(verification.payload);
    const payment = await this.paymentsRepository.findBySquareReferences({
      squarePaymentId: details.paymentId,
      squareOrderId: details.orderId,
    });

    const stored = await this.paymentsRepository.upsertWebhookEvent({
      providerEventId: verification.eventId,
      eventType: verification.eventType,
      signatureValid: verification.isValid,
      payload: verification.payload,
      paymentId: payment?.id,
    });

    if (!verification.isValid) {
      throw new BadRequestError(
        "Square webhook signature verification failed.",
      );
    }

    if (stored.alreadyProcessed) {
      return;
    }

    if (verification.eventType.startsWith("payment.")) {
      const status = (details.status ?? "").toUpperCase();

      if (status === "COMPLETED") {
        const result = await this.markCompletedPaymentStatus({
          providerPaymentId: details.paymentId,
          providerOrderId: details.orderId,
          status: "COMPLETED",
          raw: verification.payload,
        });
        await this.enqueueSearchSync(result.payment?.postingId);
      } else if (status === "FAILED" || status === "CANCELED") {
        const payment = await this.paymentsRepository.markPaymentFailed(
          {
            providerPaymentId: details.paymentId,
            providerOrderId: details.orderId,
            status: status === "FAILED" ? "FAILED" : "CANCELED",
            raw: verification.payload,
            failureCode: verification.eventType,
            failureMessage: `Square webhook reported ${status.toLowerCase()}.`,
          },
          status === "FAILED" ? "permanent" : "unknown",
        );
        await this.enqueuePaymentFailedAnalytics(payment);
        await this.enqueueSearchSync(payment?.postingId);
      }
    }

    await this.paymentsRepository.markWebhookProcessed(verification.eventId);
  }

  async reconcilePayment(
    paymentId: string,
    userId: string,
  ): Promise<PaymentRecord> {
    const payment = await this.requirePaymentAccess(
      paymentId,
      userId,
      "manage",
    );
    const status = await this.paymentProvider.getPaymentStatus({
      providerPaymentId: payment.squarePaymentId,
      providerOrderId: payment.squareOrderId,
    });

    if (!status) {
      throw new ResourceNotFoundError(
        "Provider payment could not be found for reconciliation.",
      );
    }

    if (status.status === "COMPLETED") {
      const result = await this.markCompletedPaymentStatus(
        status,
        payment.postingId,
      );

      if (!result.payment) {
        throw new ResourceNotFoundError("Payment could not be reconciled.");
      }

      await this.enqueueSearchSync(result.payment.postingId);

      if (result.reconciliationRequired) {
        throw new ConflictError(
          "Payment succeeded, but the booking now requires reconciliation before it can be finalized.",
        );
      }

      return result.payment;
    }

    if (status.status === "FAILED" || status.status === "CANCELED") {
      const result = await this.paymentsRepository.markPaymentFailed(
        status,
        status.status === "FAILED" ? "permanent" : "unknown",
      );

      if (!result) {
        throw new ResourceNotFoundError("Payment could not be reconciled.");
      }

      await this.enqueuePaymentFailedAnalytics(result);
      await this.enqueueSearchSync(result.postingId);
      return result;
    }

    return payment;
  }

  async repairPayment(paymentId: string): Promise<void> {
    const payment = await this.paymentsRepository.findById(paymentId);

    if (!payment) {
      return;
    }

    const status = await this.paymentProvider.getPaymentStatus({
      providerPaymentId: payment.squarePaymentId,
      providerOrderId: payment.squareOrderId,
    });

    if (!status) {
      return;
    }

    if (status.status === "COMPLETED") {
      const result = await this.markCompletedPaymentStatus(
        status,
        payment.postingId,
      );
      await this.enqueueSearchSync(result.payment?.postingId);
      return;
    }

    if (status.status === "FAILED" || status.status === "CANCELED") {
      const result = await this.paymentsRepository.markPaymentFailed(
        status,
        status.status === "FAILED" ? "permanent" : "unknown",
      );
      await this.enqueuePaymentFailedAnalytics(result);
      await this.enqueueSearchSync(result?.postingId);
    }
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

  private async enqueueSearchSync(postingId?: string): Promise<void> {
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
    paymentId: string,
    userId: string,
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
    userId: string,
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
    postingId?: string,
  ): Promise<{
    payment: PaymentRecord | null;
    reconciliationRequired: boolean;
  }> {
    const existingPayment =
      postingId === undefined
        ? await this.paymentsRepository.findBySquareReferences({
            squarePaymentId: status.providerPaymentId,
            squareOrderId: status.providerOrderId,
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
