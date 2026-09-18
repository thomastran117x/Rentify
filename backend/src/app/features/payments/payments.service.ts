import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import ServiceNotAvaliableError from "@/errors/http/service-not-avaliable.error";
import { getEnvironment } from "@/configuration/environment/index";
import {
  BOOKING_CANCELLATION_POLICY_CODE,
  FULL_REFUND_CUTOFF_HOURS,
  PARTIAL_REFUND_CUTOFF_HOURS,
} from "@/features/bookings/bookings.model";
import type { CacheService } from "@/features/cache/cache.service";
import {
  FLOW_LOCK_TTL_MS,
  flowLockKeys,
  withFlowLock,
} from "@/features/cache/cache-locks";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import { invalidatePublicPostingProjection } from "@/features/postings/postings.public-cache-invalidation";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { PaymentProviderAdapter } from "@/features/payments/payment-provider";
import type {
  CheckoutIneligibleReason,
  CheckoutSummary,
  CreatePaymentSessionInput,
  CreateRefundInput,
  ListPayoutsInput,
  PaymentMethod,
  PaymentRecord,
  PaymentWebhookDetails,
  PaymentWebhookHeaders,
  PayoutListResult,
  ProviderPaymentStatus,
  RetryPaymentInput,
  StoredRefundReference,
} from "@/features/payments/payments.model";
import {
  DEFAULT_BOOKING_DEPOSIT_BPS,
  DEFAULT_PLATFORM_FEE_BPS,
  PAYMENT_CONFLICT_REASONS,
  PAYMENT_FAILURE_CODES,
} from "@/features/payments/payments.model";
import {
  PAYABLE_BOOKING_STATUSES,
  PaymentsRepository,
  type CheckoutContext,
} from "@/features/payments/payments.repository";
import {
  calculateBookingCharge,
  createPaymentIdempotencyKey,
  evaluateCardAuthentication,
  isSameMoneyAmount,
} from "@/features/payments/payments.utils";
import { asOptionalUuid, type Uuid } from "@/configuration/validation/uuid";

const RECONCILIATION_REQUIRED_MESSAGE =
  "Payment succeeded, but the booking now requires reconciliation before it can be finalized.";
const CHECKOUT_BUSY_MESSAGE =
  "Another request is already updating this checkout. Please retry.";
/** Renew the checkout lock well before its TTL while a request is running. */
const LOCK_RENEWAL_INTERVAL_MS = Math.floor(FLOW_LOCK_TTL_MS / 3);

function reconciliationRequiredError(): ConflictError {
  return new ConflictError(RECONCILIATION_REQUIRED_MESSAGE, {
    reason: PAYMENT_CONFLICT_REASONS.reconciliationRequired,
  });
}

function staleOrderError(): ConflictError {
  return new ConflictError(
    "This checkout was replaced by a newer one, so nothing was charged.",
    { reason: PAYMENT_CONFLICT_REASONS.staleOrder },
  );
}

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

  /**
   * Creates a PayPal order for a booking. If the renter already has an order
   * that was never approved (closed the popup, abandoned the redirect, switched
   * methods), that order is superseded; approving it later moves no money
   * because capture only ever targets the payment's current order.
   */
  async createPaymentSession(
    input: CreatePaymentSessionInput,
  ): Promise<PaymentRecord> {
    const method = input.method ?? "paypal_redirect";
    this.assertCheckoutMethodEnabled(method);
    const idempotencyKey = createPaymentIdempotencyKey(input.idempotencyKey);

    return this.withCheckoutLock(input.bookingRequestId, async () => {
      const supersede = await this.resolveInFlightCheckout(
        input.bookingRequestId,
        input.renterId,
        idempotencyKey,
      );
      const attempt =
        await this.paymentsRepository.createPaymentAttemptForBooking({
          bookingRequestId: input.bookingRequestId,
          renterId: input.renterId,
          idempotencyKey,
          method,
          supersede,
        });
      // What the payment's order must still be when the session attaches. If
      // the lock lapsed during the provider call and another checkout moved
      // on, attaching is refused rather than overwriting its order.
      const expectedProviderOrderId = attempt.payment.providerOrderId ?? null;

      const existingAttempt = attempt.payment.attempts.find(
        (item) =>
          item.id === attempt.attemptId &&
          (item.providerRequestId || item.providerOrderId),
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
          method,
        });

        const payment = await this.paymentsRepository.attachPaymentSession(
          attempt.paymentId,
          attempt.attemptId,
          session,
          { expectedProviderOrderId },
        );
        await this.enqueueSearchSync(payment.postingId);
        return payment;
      } catch (error) {
        const errorInfo = this.paymentProvider.classifyError(error);
        const payment = await this.paymentsRepository.recordAttemptFailure(
          attempt.paymentId,
          attempt.attemptId,
          errorInfo,
          { scheduleRetry: method === "paypal_redirect" },
        );
        await this.enqueuePaymentFailedAnalytics(payment);
        await this.enqueueSearchSync(payment.postingId);
        return payment;
      }
    });
  }

  /**
   * The price breakdown, cancellation terms and PayPal settings the renter
   * sees before paying. Only the renter may check out, so organization members
   * get 403 here even though they can read the booking.
   */
  async getCheckoutSummary(
    bookingRequestId: Uuid,
    userId: Uuid,
  ): Promise<CheckoutSummary> {
    const context =
      await this.paymentsRepository.findCheckoutContext(bookingRequestId);

    if (!context) {
      throw new ResourceNotFoundError("Booking request could not be found.");
    }

    if (context.booking.renterId !== userId) {
      throw new ForbiddenError(
        "Only the renter can check out this booking request.",
      );
    }

    const { booking, posting, payment } = context;
    const paypal = getEnvironment().paypal;
    const ineligibleReason = this.resolveCheckoutIneligibleReason(context);

    return {
      serverTime: new Date().toISOString(),
      booking: {
        id: booking.id,
        status: booking.status,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
        durationDays: booking.durationDays,
        guestCount: booking.guestCount,
        holdExpiresAt: booking.holdExpiresAt.toISOString(),
        dailyPriceAmount: booking.dailyPriceAmount,
        currency: booking.pricingCurrency,
      },
      posting: {
        id: posting.id,
        name: posting.name,
        primaryPhotoUrl: posting.primaryPhotoUrl,
      },
      pricing: this.buildCheckoutPricing(context),
      cancellationPolicy: {
        code: BOOKING_CANCELLATION_POLICY_CODE,
        fullRefundCutoffHours: FULL_REFUND_CUTOFF_HOURS,
        partialRefundCutoffHours: PARTIAL_REFUND_CUTOFF_HOURS,
        partialRefundPercent: 50,
        ownerCancellationFullRefund: true,
        refundBase: "total_paid",
        hostNotes: posting.cancellationPolicyNotes,
      },
      checkout: ineligibleReason
        ? { eligible: false, reason: ineligibleReason }
        : { eligible: true },
      payment: payment
        ? {
            id: payment.id,
            status: payment.status,
            providerOrderId: payment.providerOrderId,
            method: payment.attempts.find(
              (attempt) =>
                attempt.providerOrderId !== undefined &&
                attempt.providerOrderId === payment.providerOrderId,
            )?.paymentMethod,
          }
        : null,
      paypal: {
        clientId: paypal.clientId,
        environment: paypal.environment,
        enabledMethods: [...paypal.checkoutMethods],
      },
    };
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
  async capturePayment(
    paymentId: Uuid,
    userId: Uuid,
    options: { orderId?: string } = {},
  ): Promise<PaymentRecord> {
    const accessible = await this.requirePaymentAccess(
      paymentId,
      userId,
      "manage",
    );

    return this.withCheckoutLock(accessible.bookingRequestId, async () => {
      // Re-read under the lock: a newer checkout may have replaced the order.
      const payment =
        (await this.paymentsRepository.findById(paymentId)) ?? accessible;

      if (CAPTURED_PAYMENT_STATUSES.has(payment.status)) {
        return payment;
      }

      if (options.orderId && options.orderId !== payment.providerOrderId) {
        throw staleOrderError();
      }

      if (!payment.providerOrderId) {
        throw new BadRequestError(
          "This payment does not have a PayPal order to capture yet.",
        );
      }

      let result: ProviderStatusResult;

      try {
        result = await this.captureApprovedOrder(
          payment,
          payment.providerOrderId,
        );
      } catch (error) {
        const errorInfo = this.paymentProvider.classifyError(error);

        if (errorInfo.retryable) {
          throw new ServiceNotAvaliableError(
            "PayPal is temporarily unavailable. Please try again.",
          );
        }

        // Declined instruments and similar rejections end this order; the
        // renter can start a new checkout.
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

      if (result.reconciliationRequired) {
        throw reconciliationRequiredError();
      }

      return result.payment ?? payment;
    });
  }

  /**
   * Records that the buyer left PayPal without approving, so the payment can be
   * retried. If PayPal shows the order was approved or paid after all, that
   * outcome is applied instead.
   */
  async cancelCheckout(
    paymentId: Uuid,
    userId: Uuid,
    options: { orderId?: string } = {},
  ): Promise<PaymentRecord> {
    const accessible = await this.requirePaymentAccess(
      paymentId,
      userId,
      "manage",
    );

    return this.withCheckoutLock(accessible.bookingRequestId, () =>
      this.cancelCheckoutLocked(paymentId, accessible, options),
    );
  }

  private async cancelCheckoutLocked(
    paymentId: Uuid,
    accessible: PaymentRecord,
    options: { orderId?: string },
  ): Promise<PaymentRecord> {
    const payment =
      (await this.paymentsRepository.findById(paymentId)) ?? accessible;

    // Coming back from an order a newer checkout replaced must not cancel the
    // order that replaced it.
    if (options.orderId && options.orderId !== payment.providerOrderId) {
      throw staleOrderError();
    }

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
        throw reconciliationRequiredError();
      }

      return result.payment ?? payment;
    }

    const cancelledCheckout = await this.applyProviderStatus(
      {
        providerOrderId: payment.providerOrderId,
        status: "CANCELED",
        failureCode: PAYMENT_FAILURE_CODES.checkoutCancelled,
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

      const status: ProviderPaymentStatus = {
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
      };

      // A webhook never throws for reconciliation: the booking is flagged and
      // the repair worker finishes it. A lock conflict does throw, so PayPal
      // redelivers the event once the in-flight checkout request finishes.
      if (payment) {
        await this.withCheckoutLock(payment.bookingRequestId, () =>
          this.applyProviderStatus(status, payment),
        );
      } else {
        await this.applyProviderStatus(status, payment);
      }
    }

    await this.paymentsRepository.markWebhookProcessed(verification.eventId);
  }

  async reconcilePayment(
    paymentId: Uuid,
    userId: Uuid,
  ): Promise<PaymentRecord> {
    const accessible = await this.requirePaymentAccess(
      paymentId,
      userId,
      "manage",
    );

    return this.withCheckoutLock(accessible.bookingRequestId, async () => {
      const payment =
        (await this.paymentsRepository.findById(paymentId)) ?? accessible;
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
        throw reconciliationRequiredError();
      }

      return result.payment;
    });
  }

  async repairPayment(paymentId: Uuid): Promise<void> {
    const found = await this.paymentsRepository.findById(paymentId);

    if (!found) {
      return;
    }

    try {
      await this.withCheckoutLock(found.bookingRequestId, async () => {
        const payment =
          (await this.paymentsRepository.findById(paymentId)) ?? found;
        const status = await this.paymentProvider.getPaymentStatus({
          providerPaymentId: payment.providerPaymentId,
          providerOrderId: payment.providerOrderId,
        });

        if (!status) {
          return;
        }

        await this.applyProviderStatus(status, payment);
      });
    } catch (error) {
      // A checkout request holds the booking; the next repair run retries.
      if (error instanceof ConflictError) {
        return;
      }

      throw error;
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
        // Retry candidates are redirect checkouts only (see
        // listRetryCandidates), so the retried order keeps that shape.
        const session = await this.paymentProvider.createPaymentSession({
          idempotencyKey: ready.idempotencyKey,
          amount: ready.amount,
          currency: ready.currency,
          bookingRequestId: ready.bookingRequestId,
          paymentId: ready.paymentId,
          method: "paypal_redirect",
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

        return this.captureApprovedOrder(
          payment,
          providerOrderId,
          status.order ? status : undefined,
        );
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

  /**
   * The only path that captures an order. Every caller (capture endpoint,
   * webhook, repair, reconcile, supersede) goes through these guards:
   * - only the payment's current order is captured;
   * - the booking hold must still be live;
   * - the order must be for this payment and its stored amount;
   * - card orders must pass 3-D Secure.
   *
   * `snapshot` is a status already read from GET order; webhook payloads do
   * not count because they omit the payment source.
   */
  private async captureApprovedOrder(
    payment: PaymentRecord,
    providerOrderId: string,
    snapshot?: ProviderPaymentStatus,
  ): Promise<ProviderStatusResult> {
    const unchanged = { payment, reconciliationRequired: false };

    // A superseded order was never captured; left alone, it expires.
    if (payment.providerOrderId !== providerOrderId) {
      return unchanged;
    }

    if (
      !PAYABLE_BOOKING_STATUSES.has(payment.booking.status) ||
      Date.parse(payment.booking.holdExpiresAt) <= Date.now()
    ) {
      return this.rejectCheckoutOrder(payment, providerOrderId, {
        code: PAYMENT_FAILURE_CODES.holdExpired,
        message:
          "The booking hold expired before the payment was confirmed, so nothing was charged.",
      });
    }

    const order =
      snapshot ??
      (await this.paymentProvider.getPaymentStatus({ providerOrderId }));

    if (!order) {
      return unchanged;
    }

    if (order.status !== "APPROVED") {
      return order.status === "PENDING"
        ? unchanged
        : this.applyProviderStatus(order, payment);
    }

    const details = order.order;

    if (
      details &&
      ((details.customId !== undefined && details.customId !== payment.id) ||
        (details.amount !== undefined &&
          !isSameMoneyAmount(details.amount, payment.totalAmount)) ||
        (details.currency !== undefined &&
          details.currency !== payment.pricingCurrency))
    ) {
      return this.rejectCheckoutOrder(payment, providerOrderId, {
        code: PAYMENT_FAILURE_CODES.orderMismatch,
        message:
          "The PayPal order does not match this booking, so nothing was charged.",
      });
    }

    if (details?.paymentSource === "card" || details?.cardAuthentication) {
      const decision = evaluateCardAuthentication(details.cardAuthentication);

      if (!decision.capture) {
        return this.rejectCheckoutOrder(payment, providerOrderId, decision);
      }
    }

    const captured = await this.paymentProvider.capturePayment({
      providerOrderId,
      idempotencyKey: createCaptureIdempotencyKey(providerOrderId),
    });

    // Guard against re-capturing forever if the order is still APPROVED.
    if (captured.status === "APPROVED") {
      return unchanged;
    }

    return this.applyProviderStatus(captured, payment);
  }

  private async rejectCheckoutOrder(
    payment: PaymentRecord,
    providerOrderId: string,
    failure: { code: string; message: string },
  ): Promise<ProviderStatusResult> {
    const rejected = await this.paymentsRepository.rejectCheckoutAttempt({
      paymentId: payment.id,
      providerOrderId,
      failureCode: failure.code,
      failureMessage: failure.message,
    });
    await this.enqueuePaymentFailedAnalytics(rejected);
    await this.enqueueSearchSync(rejected.postingId);
    return { payment: rejected, reconciliationRequired: false };
  }

  /**
   * Settles a checkout that is still open before a new order replaces it.
   * Returns the supersede expectation for the repository, or undefined when
   * nothing is in flight. Throws 409 when the open order was already paid.
   */
  private async resolveInFlightCheckout(
    bookingRequestId: Uuid,
    renterId: Uuid,
    idempotencyKey: string,
  ): Promise<{ expectedProviderOrderId: string | null } | undefined> {
    const payment =
      await this.paymentsRepository.findByBookingRequestId(bookingRequestId);

    // The repository answers replays, strangers (403), and unpayable bookings.
    if (
      !payment ||
      payment.renterId !== renterId ||
      payment.attempts.some(
        (attempt) => attempt.idempotencyKey === idempotencyKey,
      )
    ) {
      return undefined;
    }

    const inFlight =
      payment.status === "processing" ||
      payment.booking.status === "payment_processing";

    if (!inFlight) {
      return undefined;
    }

    if (payment.status !== "processing" || !payment.providerOrderId) {
      return { expectedProviderOrderId: payment.providerOrderId ?? null };
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

    // Unknown to PayPal, or created but never approved: safe to replace.
    if (!status || (status.status === "PENDING" && !status.providerPaymentId)) {
      return { expectedProviderOrderId: payment.providerOrderId };
    }

    const inProgressError = new ConflictError(
      "A payment for this booking is already being processed.",
      { reason: PAYMENT_CONFLICT_REASONS.paymentInProgress },
    );

    // A capture exists and is still settling; a new order could charge twice.
    if (status.status === "PENDING") {
      throw inProgressError;
    }

    const result = await this.applyProviderStatus(status, payment);

    if (result.reconciliationRequired) {
      throw reconciliationRequiredError();
    }

    const settled = result.payment ?? payment;

    if (
      settled.status === "failed_final" ||
      settled.status === "failed_retryable"
    ) {
      // The old order ended (declined, cancelled, refused by a guard).
      return undefined;
    }

    throw inProgressError;
  }

  private buildCheckoutPricing(
    context: CheckoutContext,
  ): CheckoutSummary["pricing"] {
    const { booking, payment } = context;
    const quote = calculateBookingCharge(booking.estimatedTotal, {
      depositBps: DEFAULT_BOOKING_DEPOSIT_BPS,
      platformFeeBps: DEFAULT_PLATFORM_FEE_BPS,
    });
    const charge = payment
      ? {
          depositAmount: payment.rentalSubtotalAmount,
          platformFeeAmount: payment.platformFeeAmount,
          totalAmount: payment.totalAmount,
        }
      : quote;
    // Older payments may have been priced differently; only label the
    // percentages when the stored amounts match today's formula.
    const matchesFormula =
      isSameMoneyAmount(charge.depositAmount, quote.depositAmount) &&
      isSameMoneyAmount(charge.platformFeeAmount, quote.platformFeeAmount) &&
      isSameMoneyAmount(charge.totalAmount, quote.totalAmount);

    return {
      currency: payment?.pricingCurrency ?? booking.pricingCurrency,
      stayTotal: booking.estimatedTotal,
      depositAmount: charge.depositAmount,
      platformFeeAmount: charge.platformFeeAmount,
      totalDueNow: charge.totalAmount,
      remainingBalance: Math.max(
        0,
        Math.round((booking.estimatedTotal - charge.depositAmount) * 100) / 100,
      ),
      depositBps: matchesFormula ? DEFAULT_BOOKING_DEPOSIT_BPS : null,
      platformFeeBps: matchesFormula ? DEFAULT_PLATFORM_FEE_BPS : null,
      source: payment ? "payment" : "quote",
    };
  }

  private resolveCheckoutIneligibleReason(
    context: CheckoutContext,
  ): CheckoutIneligibleReason | undefined {
    const { booking, payment } = context;

    if (booking.converted) {
      return "converted";
    }

    if (
      booking.status === "paid" ||
      (payment && CAPTURED_PAYMENT_STATUSES.has(payment.status))
    ) {
      return "already_paid";
    }

    if (booking.paymentReconciliationRequired) {
      return "reconciliation";
    }

    if (booking.status === "expired") {
      return "hold_expired";
    }

    if (!PAYABLE_BOOKING_STATUSES.has(booking.status)) {
      return "not_payable";
    }

    if (booking.holdExpiresAt.getTime() <= Date.now()) {
      return "hold_expired";
    }

    return undefined;
  }

  private assertCheckoutMethodEnabled(method: PaymentMethod): void {
    if (method === "paypal_redirect") {
      return;
    }

    if (!getEnvironment().paypal.checkoutMethods.includes(method)) {
      throw new BadRequestError(
        "This payment method is not available for checkout.",
      );
    }
  }

  /**
   * Serializes everything that creates, captures or settles a booking's
   * checkout, so a capture and a supersede never interleave.
   */
  private async withCheckoutLock<T>(
    bookingRequestId: Uuid,
    callback: () => Promise<T>,
  ): Promise<T> {
    const lock = await this.cacheService.acquireLock(
      flowLockKeys.bookingRequestState(bookingRequestId),
      FLOW_LOCK_TTL_MS,
    );

    if (!lock) {
      throw new ConflictError(CHECKOUT_BUSY_MESSAGE, {
        reason: PAYMENT_CONFLICT_REASONS.checkoutBusy,
      });
    }

    // A checkout can make several PayPal calls in a row, each allowed to run
    // to the provider timeout, which is longer than the lock's TTL. Renewing
    // it keeps the lock for as long as the work actually takes; the attach
    // compare-and-swap still covers a renewal that fails.
    const renewal = setInterval(() => {
      void lock.extend(FLOW_LOCK_TTL_MS).catch(() => undefined);
    }, LOCK_RENEWAL_INTERVAL_MS);
    renewal.unref?.();

    try {
      return await callback();
    } finally {
      clearInterval(renewal);
      await lock.release();
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
