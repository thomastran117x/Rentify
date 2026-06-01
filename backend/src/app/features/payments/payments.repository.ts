import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BaseRepository } from "@/features/base/base.repository";
import BadRequestError from "@/errors/http/bad-request.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  CreateRefundInput,
  ListPayoutsInput,
  PaymentFailureCategory,
  PaymentRecord,
  PaymentRepairCandidate,
  PaymentRetryCandidate,
  PayoutListResult,
  PayoutRecord,
  ProviderErrorInfo,
  ProviderPaymentSession,
  ProviderPaymentStatus,
  ProviderRefundResult,
} from "@/features/payments/payments.model";
import {
  DEFAULT_BOOKING_DEPOSIT_BPS,
  DEFAULT_PLATFORM_FEE_BPS,
  MAX_RETRY_ATTEMPTS,
  PAYMENT_PROVIDER,
  PAYMENT_PROCESSING_TIMEOUT_MINUTES,
} from "@/features/payments/payments.model";
import {
  calculatePlatformFeeAmount,
  createExponentialBackoffDate,
} from "@/features/payments/payments.utils";

type PaymentPersistence = Prisma.PaymentGetPayload<{
  include: {
    bookingRequest: true;
    attempts: {
      orderBy: {
        createdAt: "desc";
      };
    };
    refunds: {
      orderBy: {
        createdAt: "desc";
      };
    };
    payout: true;
  };
}>;

type PayoutPersistence = Prisma.PayoutGetPayload<object>;

export class PaymentsRepository extends BaseRepository {
  async createPaymentAttemptForBooking(input: {
    bookingRequestId: string;
    renterId: string;
    idempotencyKey: string;
    platformFeeBps?: number;
    depositBps?: number;
  }): Promise<{
    paymentId: string;
    attemptId: string;
    payment: PaymentRecord;
    amount: number;
    currency: string;
  }> {
    const platformFeeBps = input.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS;
    const depositBps = input.depositBps ?? DEFAULT_BOOKING_DEPOSIT_BPS;

    const result = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const booking = await transaction.bookingRequest.findUnique({
          where: {
            id: input.bookingRequestId,
          },
          include: {
            payment: {
              include: {
                bookingRequest: true,
                attempts: {
                  orderBy: {
                    createdAt: "desc",
                  },
                },
                refunds: {
                  orderBy: {
                    createdAt: "desc",
                  },
                },
                payout: true,
              },
            },
            renting: {
              select: {
                id: true,
              },
            },
          },
        });

        if (!booking) {
          throw new ResourceNotFoundError(
            "Booking request could not be found.",
          );
        }

        if (booking.renterId !== input.renterId) {
          throw new ForbiddenError(
            "You do not have access to this booking request.",
          );
        }

        if (booking.renting || booking.convertedAt) {
          throw new BadRequestError(
            "This booking request has already been finalized.",
          );
        }

        if (!["awaiting_payment", "payment_failed"].includes(booking.status)) {
          throw new BadRequestError(
            "This booking request is not ready for payment.",
          );
        }

        if (booking.holdExpiresAt.getTime() <= Date.now()) {
          throw new BadRequestError(
            "This booking request has already expired.",
          );
        }

        if (booking.payment) {
          const existingAttempt = booking.payment.attempts.find(
            (attempt) => attempt.idempotencyKey === input.idempotencyKey,
          );

          if (existingAttempt) {
            return {
              paymentId: booking.payment.id,
              attemptId: existingAttempt.id,
              amount: Number(booking.payment.totalAmount),
              currency: booking.payment.pricingCurrency,
              payment: this.mapPayment(booking.payment),
            };
          }
        }

        const rentalSubtotal =
          Math.round(
            Number(booking.estimatedTotal) * (depositBps / 10_000) * 100,
          ) / 100;
        const platformFeeAmount = calculatePlatformFeeAmount(
          rentalSubtotal,
          platformFeeBps,
        );
        const totalAmount =
          Math.round((rentalSubtotal + platformFeeAmount) * 100) / 100;

        const payment =
          booking.payment ??
          (await transaction.payment.create({
            data: {
              id: randomUUID(),
              bookingRequestId: booking.id,
              postingId: booking.postingId,
              renterId: booking.renterId,
              ownerId: booking.ownerId,
              organizationId: booking.organizationId,
              provider: PAYMENT_PROVIDER,
              status: "awaiting_method",
              pricingCurrency: booking.pricingCurrency,
              rentalSubtotalAmount: new Prisma.Decimal(rentalSubtotal),
              platformFeeAmount: new Prisma.Decimal(platformFeeAmount),
              totalAmount: new Prisma.Decimal(totalAmount),
            },
            include: {
              bookingRequest: true,
              attempts: {
                orderBy: {
                  createdAt: "desc",
                },
              },
              refunds: {
                orderBy: {
                  createdAt: "desc",
                },
              },
              payout: true,
            },
          }));

        const attempt = await transaction.paymentAttempt.create({
          data: {
            id: randomUUID(),
            paymentId: payment.id,
            idempotencyKey: input.idempotencyKey,
            status: "pending",
          },
        });

        const refreshed = await transaction.payment.findUniqueOrThrow({
          where: {
            id: payment.id,
          },
          include: {
            bookingRequest: true,
            attempts: {
              orderBy: {
                createdAt: "desc",
              },
            },
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
            },
            payout: true,
          },
        });

        await transaction.paymentLedgerEntry.create({
          data: {
            id: randomUUID(),
            paymentId: refreshed.id,
            type: "charge_created",
            amount: refreshed.totalAmount,
            currency: refreshed.pricingCurrency,
            metadata: {
              attemptId: attempt.id,
            } as Prisma.InputJsonValue,
          },
        });

        return {
          paymentId: payment.id,
          attemptId: attempt.id,
          amount: totalAmount,
          currency: booking.pricingCurrency,
          payment: this.mapPayment(refreshed),
        };
      }),
    );

    return result;
  }

  async attachPaymentSession(
    paymentId: string,
    attemptId: string,
    session: ProviderPaymentSession,
  ): Promise<PaymentRecord> {
    const payment = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        await transaction.paymentAttempt.update({
          where: {
            id: attemptId,
          },
          data: {
            status: "processing",
            providerRequestId: session.providerRequestId ?? null,
            squarePaymentId: session.providerPaymentId ?? null,
            responsePayload: session.raw as Prisma.InputJsonValue,
          },
        });

        await transaction.payment.update({
          where: {
            id: paymentId,
          },
          data: {
            status: "processing",
            checkoutUrl: session.checkoutUrl ?? null,
            squarePaymentId: session.providerPaymentId ?? null,
            squareOrderId: session.providerOrderId ?? null,
            squareLocationId: session.locationId ?? null,
            lastAttemptedAt: new Date(),
          },
        });

        await transaction.bookingRequest.update({
          where: {
            id: (
              await transaction.payment.findUniqueOrThrow({
                where: { id: paymentId },
                select: { bookingRequestId: true },
              })
            ).bookingRequestId,
          },
          data: {
            status: "payment_processing",
          },
        });

        return transaction.payment.findUniqueOrThrow({
          where: {
            id: paymentId,
          },
          include: {
            bookingRequest: true,
            attempts: {
              orderBy: {
                createdAt: "desc",
              },
            },
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
            },
            payout: true,
          },
        });
      }),
    );

    return this.mapPayment(payment);
  }

  async recordAttemptFailure(
    paymentId: string,
    attemptId: string,
    errorInfo: ProviderErrorInfo,
  ): Promise<PaymentRecord> {
    const payment = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const existingAttempt =
          await transaction.paymentAttempt.findUniqueOrThrow({
            where: {
              id: attemptId,
            },
          });

        const retryable =
          errorInfo.retryable &&
          existingAttempt.retryCount + 1 < MAX_RETRY_ATTEMPTS;
        const nextRetryAt = retryable
          ? createExponentialBackoffDate(
              existingAttempt.retryCount + 1,
              2_000,
              5 * 60 * 1000,
            )
          : null;

        await transaction.paymentAttempt.update({
          where: {
            id: attemptId,
          },
          data: {
            status: retryable ? "failed_retryable" : "failed_final",
            retryCount: {
              increment: 1,
            },
            failureCategory: errorInfo.category,
            failureCode: errorInfo.code ?? null,
            failureMessage: errorInfo.message,
            nextRetryAt,
          },
        });

        const paymentRow = await transaction.payment.findUniqueOrThrow({
          where: {
            id: paymentId,
          },
          select: {
            bookingRequestId: true,
          },
        });

        await transaction.payment.update({
          where: {
            id: paymentId,
          },
          data: {
            status: retryable ? "failed_retryable" : "failed_final",
            failedAt: new Date(),
          },
        });

        await transaction.bookingRequest.update({
          where: {
            id: paymentRow.bookingRequestId,
          },
          data: {
            status: "payment_failed",
            paymentFailedAt: new Date(),
          },
        });

        return transaction.payment.findUniqueOrThrow({
          where: {
            id: paymentId,
          },
          include: {
            bookingRequest: true,
            attempts: {
              orderBy: {
                createdAt: "desc",
              },
            },
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
            },
            payout: true,
          },
        });
      }),
    );

    return this.mapPayment(payment);
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    const payment = await this.executeAsync(() =>
      this.prisma.payment.findUnique({
        where: {
          id,
        },
        include: {
          bookingRequest: true,
          attempts: {
            orderBy: {
              createdAt: "desc",
            },
          },
          refunds: {
            orderBy: {
              createdAt: "desc",
            },
          },
          payout: true,
        },
      }),
    );

    return payment ? this.mapPayment(payment) : null;
  }

  async findAccessibleById(id: string, userId: string): Promise<PaymentRecord> {
    const payment = await this.findById(id);

    if (!payment) {
      throw new ResourceNotFoundError("Payment could not be found.");
    }

    if (payment.renterId !== userId && payment.ownerId !== userId) {
      throw new ForbiddenError("You do not have access to this payment.");
    }

    return payment;
  }

  async findByBookingRequestId(
    bookingRequestId: string,
  ): Promise<PaymentRecord | null> {
    const payment = await this.executeAsync(() =>
      this.prisma.payment.findUnique({
        where: {
          bookingRequestId,
        },
        include: {
          bookingRequest: true,
          attempts: {
            orderBy: {
              createdAt: "desc",
            },
          },
          refunds: {
            orderBy: {
              createdAt: "desc",
            },
          },
          payout: true,
        },
      }),
    );

    return payment ? this.mapPayment(payment) : null;
  }

  async createRefundRecord(input: CreateRefundInput): Promise<{
    refundId: string;
    paymentId: string;
    providerPaymentId: string;
    pricingCurrency: string;
  }> {
    return this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const payment = await transaction.payment.findUnique({
          where: {
            id: input.paymentId,
          },
          include: {
            refunds: true,
          },
        });

        if (!payment) {
          throw new ResourceNotFoundError("Payment could not be found.");
        }

        if (!payment.squarePaymentId) {
          throw new BadRequestError(
            "This payment is not linked to a Square payment yet.",
          );
        }

        const existing = payment.refunds.find(
          (refund) => refund.idempotencyKey === (input.idempotencyKey ?? ""),
        );

        if (existing) {
          return {
            refundId: existing.id,
            paymentId: payment.id,
            providerPaymentId: payment.squarePaymentId,
            pricingCurrency: payment.pricingCurrency,
          };
        }

        const succeededTotal = payment.refunds
          .filter((refund) => refund.status === "succeeded")
          .reduce((sum, refund) => sum + Number(refund.amount), 0);
        const remainingRefundableAmount = Math.max(
          0,
          Number(payment.totalAmount) - succeededTotal,
        );

        if (input.amount > remainingRefundableAmount) {
          throw new BadRequestError(
            "Refund amount cannot exceed the remaining refundable total.",
          );
        }

        const refund = await transaction.refund.create({
          data: {
            id: randomUUID(),
            paymentId: payment.id,
            issuedByUserId: input.actorUserId,
            status: "pending",
            amount: new Prisma.Decimal(input.amount),
            reason: input.reason ?? null,
            idempotencyKey: input.idempotencyKey ?? randomUUID(),
          },
        });

        return {
          refundId: refund.id,
          paymentId: payment.id,
          providerPaymentId: payment.squarePaymentId,
          pricingCurrency: payment.pricingCurrency,
        };
      }),
    );
  }

  async completeRefund(
    refundId: string,
    result: ProviderRefundResult,
    options?: {
      preserveBookingStatus?: boolean;
    },
  ): Promise<PaymentRecord> {
    const payment = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const refund = await transaction.refund.findUniqueOrThrow({
          where: {
            id: refundId,
          },
        });

        await transaction.refund.update({
          where: {
            id: refundId,
          },
          data: {
            status:
              result.status === "COMPLETED"
                ? "succeeded"
                : result.status === "FAILED"
                  ? "failed"
                  : "pending",
            squareRefundId: result.providerRefundId ?? null,
            completedAt: result.status === "COMPLETED" ? new Date() : null,
          },
        });

        const allRefunds = await transaction.refund.findMany({
          where: {
            paymentId: refund.paymentId,
          },
        });
        const paymentRow = await transaction.payment.findUniqueOrThrow({
          where: {
            id: refund.paymentId,
          },
          include: {
            bookingRequest: true,
            attempts: {
              orderBy: {
                createdAt: "desc",
              },
            },
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
            },
            payout: true,
          },
        });

        const succeededTotal = allRefunds
          .filter((item) => item.status === "succeeded")
          .reduce((sum, item) => sum + Number(item.amount), 0);
        const paymentTotal = Number(paymentRow.totalAmount);
        const nextPaymentStatus =
          succeededTotal >= paymentTotal
            ? "refunded"
            : succeededTotal > 0
              ? "partially_refunded"
              : paymentRow.status;

        await transaction.payment.update({
          where: {
            id: paymentRow.id,
          },
          data: {
            status: nextPaymentStatus,
          },
        });

        const shouldPreserveBookingStatus =
          options?.preserveBookingStatus === true;
        await transaction.bookingRequest.update({
          where: {
            id: paymentRow.bookingRequestId,
          },
          data: shouldPreserveBookingStatus
            ? succeededTotal > 0
              ? {
                  refundedAt: new Date(),
                }
              : {}
            : paymentRow.bookingRequest.status === "cancelled"
              ? succeededTotal > 0
                ? {
                    refundedAt: new Date(),
                    holdBlockId: null,
                  }
                : {}
              : succeededTotal >= paymentTotal
                ? {
                    status: "refunded",
                    refundedAt: new Date(),
                    holdBlockId: null,
                  }
                : {},
        });

        if (
          !shouldPreserveBookingStatus &&
          succeededTotal >= paymentTotal &&
          paymentRow.bookingRequest.holdBlockId
        ) {
          await transaction.postingAvailabilityBlock.deleteMany({
            where: {
              id: paymentRow.bookingRequest.holdBlockId,
            },
          });
        }

        await transaction.paymentLedgerEntry.create({
          data: {
            id: randomUUID(),
            paymentId: paymentRow.id,
            type: "refund_issued",
            amount: refund.amount,
            currency: paymentRow.pricingCurrency,
            metadata: result.raw as Prisma.InputJsonValue,
          },
        });

        return transaction.payment.findUniqueOrThrow({
          where: {
            id: paymentRow.id,
          },
          include: {
            bookingRequest: true,
            attempts: {
              orderBy: {
                createdAt: "desc",
              },
            },
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
            },
            payout: true,
          },
        });
      }),
    );

    return this.mapPayment(payment);
  }

  async upsertWebhookEvent(input: {
    providerEventId: string;
    eventType: string;
    signatureValid: boolean;
    payload: Record<string, unknown>;
    paymentId?: string;
  }): Promise<{ alreadyProcessed: boolean }> {
    const existing = await this.executeAsync(() =>
      this.prisma.paymentWebhookEvent.findUnique({
        where: {
          providerEventId: input.providerEventId,
        },
      }),
    );

    if (existing) {
      return {
        alreadyProcessed: Boolean(existing.processedAt),
      };
    }

    await this.executeAsync(() =>
      this.prisma.paymentWebhookEvent.create({
        data: {
          id: randomUUID(),
          paymentId: input.paymentId ?? null,
          provider: PAYMENT_PROVIDER,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          signatureValid: input.signatureValid,
          rawPayload: input.payload as Prisma.InputJsonValue,
        },
      }),
    );

    return {
      alreadyProcessed: false,
    };
  }

  async markWebhookProcessed(providerEventId: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.paymentWebhookEvent.update({
        where: {
          providerEventId,
        },
        data: {
          processedAt: new Date(),
        },
      }),
    );
  }

  async findBySquareReferences(input: {
    squarePaymentId?: string;
    squareOrderId?: string;
  }): Promise<PaymentRecord | null> {
    if (!input.squarePaymentId && !input.squareOrderId) {
      return null;
    }

    const payment = await this.executeAsync(() =>
      this.prisma.payment.findFirst({
        where: {
          OR: [
            ...(input.squarePaymentId
              ? [{ squarePaymentId: input.squarePaymentId }]
              : []),
            ...(input.squareOrderId
              ? [{ squareOrderId: input.squareOrderId }]
              : []),
          ],
        },
        include: {
          bookingRequest: true,
          attempts: {
            orderBy: {
              createdAt: "desc",
            },
          },
          refunds: {
            orderBy: {
              createdAt: "desc",
            },
          },
          payout: true,
        },
      }),
    );

    return payment ? this.mapPayment(payment) : null;
  }

  async markPaymentSucceeded(input: ProviderPaymentStatus): Promise<{
    payment: PaymentRecord | null;
    reconciliationRequired: boolean;
  }> {
    if (!input.providerPaymentId && !input.providerOrderId) {
      return {
        payment: null,
        reconciliationRequired: false,
      };
    }

    return this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const payment = await transaction.payment.findFirst({
          where: {
            OR: [
              ...(input.providerPaymentId
                ? [{ squarePaymentId: input.providerPaymentId }]
                : []),
              ...(input.providerOrderId
                ? [{ squareOrderId: input.providerOrderId }]
                : []),
            ],
          },
          include: {
            bookingRequest: true,
            attempts: {
              orderBy: {
                createdAt: "desc",
              },
            },
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
            },
            payout: true,
          },
        });

        if (!payment) {
          return {
            payment: null,
            reconciliationRequired: false,
          };
        }

        const paymentJustSucceeded = payment.status !== "succeeded";

        await transaction.payment.update({
          where: {
            id: payment.id,
          },
          data: {
            status: "succeeded",
            squarePaymentId: input.providerPaymentId ?? payment.squarePaymentId,
            squareOrderId: input.providerOrderId ?? payment.squareOrderId,
            succeededAt: payment.succeededAt ?? new Date(),
            failedAt: null,
          },
        });

        const latestAttempt = payment.attempts[0];
        if (latestAttempt && latestAttempt.status !== "succeeded") {
          await transaction.paymentAttempt.update({
            where: {
              id: latestAttempt.id,
            },
            data: {
              status: "succeeded",
              squarePaymentId:
                input.providerPaymentId ?? payment.squarePaymentId,
              responsePayload: input.raw as Prisma.InputJsonValue,
              failureCategory: null,
              failureCode: null,
              failureMessage: null,
              nextRetryAt: null,
            },
          });
        }

        const booking = await transaction.bookingRequest.findUniqueOrThrow({
          where: {
            id: payment.bookingRequestId,
          },
          include: {
            renting: {
              select: {
                id: true,
              },
            },
          },
        });

        const bookingAlreadyConverted = Boolean(
          booking.renting || booking.convertedAt,
        );
        let reconciliationRequired = false;
        let holdBlockId = booking.holdBlockId;

        if (!bookingAlreadyConverted && !holdBlockId) {
          const [availabilityConflict, rentingConflict] = await Promise.all([
            transaction.postingAvailabilityBlock.findFirst({
              where: {
                postingId: booking.postingId,
                startAt: {
                  lt: booking.endAt,
                },
                endAt: {
                  gt: booking.startAt,
                },
                OR: [
                  {
                    bookingRequestHold: null,
                  },
                  {
                    bookingRequestHold: {
                      status: "paid",
                      convertedAt: null,
                      id: {
                        not: booking.id,
                      },
                    },
                  },
                ],
              },
              select: {
                id: true,
              },
            }),
            transaction.renting.findFirst({
              where: {
                postingId: booking.postingId,
                startAt: {
                  lt: booking.endAt,
                },
                endAt: {
                  gt: booking.startAt,
                },
              },
              select: {
                id: true,
              },
            }),
          ]);

          reconciliationRequired = Boolean(
            availabilityConflict || rentingConflict,
          );

          if (!reconciliationRequired) {
            const holdBlock = await transaction.postingAvailabilityBlock.create(
              {
                data: {
                  id: randomUUID(),
                  postingId: booking.postingId,
                  startAt: booking.startAt,
                  endAt: booking.endAt,
                  note: `Booking paid reservation: ${booking.id}`,
                  source: "booking_hold",
                },
              },
            );
            holdBlockId = holdBlock.id;
          }
        }

        if (!bookingAlreadyConverted) {
          await transaction.bookingRequest.update({
            where: {
              id: booking.id,
            },
            data: reconciliationRequired
              ? {
                  paymentReconciliationRequired: true,
                }
              : {
                  status: "paid",
                  holdBlockId: holdBlockId ?? null,
                  conversionReservedAt: null,
                  conversionReservationExpiresAt: null,
                  paymentReconciliationRequired: false,
                },
          });
        }

        if (paymentJustSucceeded) {
          await transaction.paymentLedgerEntry.create({
            data: {
              id: randomUUID(),
              paymentId: payment.id,
              type: "charge_succeeded",
              amount: payment.totalAmount,
              currency: payment.pricingCurrency,
              metadata: input.raw as Prisma.InputJsonValue,
            },
          });
        }

        if (!payment.payout) {
          await transaction.payout.create({
            data: {
              id: randomUUID(),
              paymentId: payment.id,
              ownerId: payment.ownerId,
              organizationId: payment.organizationId,
              status: "scheduled",
              amount: payment.rentalSubtotalAmount,
              dueAt: booking.startAt,
            },
          });

          await transaction.paymentLedgerEntry.create({
            data: {
              id: randomUUID(),
              paymentId: payment.id,
              type: "payout_scheduled",
              amount: payment.rentalSubtotalAmount,
              currency: payment.pricingCurrency,
              metadata: {
                dueAt: booking.startAt.toISOString(),
              } as Prisma.InputJsonValue,
            },
          });
        }

        const refreshed = await transaction.payment.findUniqueOrThrow({
          where: {
            id: payment.id,
          },
          include: {
            bookingRequest: true,
            attempts: {
              orderBy: {
                createdAt: "desc",
              },
            },
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
            },
            payout: true,
          },
        });

        return {
          payment: this.mapPayment(refreshed),
          reconciliationRequired,
        };
      }),
    );
  }

  async markPaymentFailed(
    input: ProviderPaymentStatus,
    category: PaymentFailureCategory,
  ): Promise<PaymentRecord | null> {
    if (!input.providerPaymentId && !input.providerOrderId) {
      return null;
    }

    const payment = await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const paymentRow = await transaction.payment.findFirst({
          where: {
            OR: [
              ...(input.providerPaymentId
                ? [{ squarePaymentId: input.providerPaymentId }]
                : []),
              ...(input.providerOrderId
                ? [{ squareOrderId: input.providerOrderId }]
                : []),
            ],
          },
          include: {
            bookingRequest: true,
            attempts: {
              orderBy: {
                createdAt: "desc",
              },
            },
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
            },
            payout: true,
          },
        });

        if (!paymentRow) {
          return null;
        }

        const retryable = category === "transient";
        await transaction.payment.update({
          where: {
            id: paymentRow.id,
          },
          data: {
            status: retryable ? "failed_retryable" : "failed_final",
            failedAt: new Date(),
          },
        });

        if (paymentRow.attempts[0]) {
          await transaction.paymentAttempt.update({
            where: {
              id: paymentRow.attempts[0].id,
            },
            data: {
              status: retryable ? "failed_retryable" : "failed_final",
              failureCategory: category,
              failureCode: input.failureCode ?? null,
              failureMessage: input.failureMessage ?? null,
              responsePayload: input.raw as Prisma.InputJsonValue,
              nextRetryAt: retryable
                ? createExponentialBackoffDate(
                    paymentRow.attempts[0].retryCount + 1,
                    2_000,
                    5 * 60 * 1000,
                  )
                : null,
            },
          });
        }

        await transaction.bookingRequest.update({
          where: {
            id: paymentRow.bookingRequestId,
          },
          data: {
            status: "payment_failed",
            paymentFailedAt: new Date(),
          },
        });

        return transaction.payment.findUniqueOrThrow({
          where: {
            id: paymentRow.id,
          },
          include: {
            bookingRequest: true,
            attempts: {
              orderBy: {
                createdAt: "desc",
              },
            },
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
            },
            payout: true,
          },
        });
      }),
    );

    return payment ? this.mapPayment(payment) : null;
  }

  async listRetryCandidates(limit: number): Promise<PaymentRetryCandidate[]> {
    const rows = await this.executeAsync(() =>
      this.prisma.paymentAttempt.findMany({
        where: {
          status: "failed_retryable",
          nextRetryAt: {
            lte: new Date(),
          },
          retryCount: {
            lt: MAX_RETRY_ATTEMPTS,
          },
        },
        orderBy: [{ nextRetryAt: "asc" }, { createdAt: "asc" }],
        take: limit,
      }),
    );

    return rows.map((row) => ({
      attemptId: row.id,
      paymentId: row.paymentId,
      idempotencyKey: row.idempotencyKey,
      retryCount: row.retryCount,
    }));
  }

  async markAttemptForRetry(attemptId: string): Promise<{
    paymentId: string;
    bookingRequestId: string;
    idempotencyKey: string;
    amount: number;
    currency: string;
  } | null> {
    return this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const attempt = await transaction.paymentAttempt.findUnique({
          where: {
            id: attemptId,
          },
        });

        if (!attempt || attempt.status !== "failed_retryable") {
          return null;
        }

        const payment = await transaction.payment.findUniqueOrThrow({
          where: {
            id: attempt.paymentId,
          },
        });

        await transaction.paymentAttempt.update({
          where: {
            id: attemptId,
          },
          data: {
            status: "processing",
            nextRetryAt: null,
          },
        });

        await transaction.payment.update({
          where: {
            id: payment.id,
          },
          data: {
            status: "processing",
            lastAttemptedAt: new Date(),
          },
        });

        await transaction.bookingRequest.update({
          where: {
            id: payment.bookingRequestId,
          },
          data: {
            status: "payment_processing",
          },
        });

        return {
          paymentId: payment.id,
          bookingRequestId: payment.bookingRequestId,
          idempotencyKey: attempt.idempotencyKey,
          amount: Number(payment.totalAmount),
          currency: payment.pricingCurrency,
        };
      }),
    );
  }

  async listRepairCandidates(limit: number): Promise<PaymentRepairCandidate[]> {
    const staleProcessingThreshold = new Date(
      Date.now() - PAYMENT_PROCESSING_TIMEOUT_MINUTES * 60 * 1000,
    );

    const rows = await this.executeAsync(() =>
      this.prisma.payment.findMany({
        where: {
          OR: [
            {
              status: "succeeded",
              bookingRequest: {
                OR: [
                  {
                    paymentReconciliationRequired: true,
                  },
                  {
                    status: "paid",
                    renting: null,
                  },
                ],
              },
            },
            {
              status: "processing",
              lastAttemptedAt: {
                lte: staleProcessingThreshold,
              },
            },
          ],
        },
        include: {
          bookingRequest: true,
        },
        take: limit,
        orderBy: [{ updatedAt: "asc" }],
      }),
    );

    return rows.map((row) => ({
      paymentId: row.id,
      bookingRequestId: row.bookingRequestId,
      squarePaymentId: row.squarePaymentId ?? undefined,
      status: row.status,
      bookingStatus: row.bookingRequest.status,
    }));
  }

  async markBookingReconciliationRequired(paymentId: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.payment.update({
        where: {
          id: paymentId,
        },
        data: {
          bookingRequest: {
            update: {
              paymentReconciliationRequired: true,
            },
          },
        },
      }),
    );
  }

  async listDuePayouts(limit: number): Promise<PayoutRecord[]> {
    const rows = await this.executeAsync(() =>
      this.prisma.payout.findMany({
        where: {
          status: "scheduled",
          dueAt: {
            lte: new Date(),
          },
        },
        orderBy: [{ dueAt: "asc" }],
        take: limit,
      }),
    );

    return rows.map((row) => this.mapPayout(row));
  }

  async markPayoutReleased(payoutId: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.$transaction(async (transaction) => {
        const payout = await transaction.payout.findUniqueOrThrow({
          where: {
            id: payoutId,
          },
        });

        if (payout.status !== "scheduled") {
          return;
        }

        await transaction.payout.update({
          where: {
            id: payoutId,
          },
          data: {
            status: "released",
            releasedAt: new Date(),
            failedAt: null,
            failureMessage: null,
          },
        });

        const payment = await transaction.payment.findUniqueOrThrow({
          where: {
            id: payout.paymentId,
          },
        });

        await transaction.paymentLedgerEntry.create({
          data: {
            id: randomUUID(),
            paymentId: payment.id,
            type: "payout_released",
            amount: payout.amount,
            currency: payment.pricingCurrency,
            metadata: {
              payoutId,
            } as Prisma.InputJsonValue,
          },
        });
      }),
    );
  }

  async markPayoutFailed(payoutId: string, message: string): Promise<void> {
    await this.executeAsync(() =>
      this.prisma.payout.update({
        where: {
          id: payoutId,
        },
        data: {
          status: "failed",
          failedAt: new Date(),
          failureMessage: message.slice(0, 2048),
        },
      }),
    );
  }

  async listPayoutsForOrganization(
    input: ListPayoutsInput,
  ): Promise<PayoutListResult> {
    const where: Prisma.PayoutWhereInput = {
      organizationId: input.organizationId,
      ...(input.status ? { status: input.status } : {}),
    };
    const skip = (input.page - 1) * input.pageSize;
    const [rows, total] = await this.executeAsync(() =>
      Promise.all([
        this.prisma.payout.findMany({
          where,
          skip,
          take: input.pageSize,
          orderBy: [{ createdAt: "desc" }],
        }),
        this.prisma.payout.count({ where }),
      ]),
    );

    return {
      payouts: rows.map((row) => this.mapPayout(row)),
      pagination: this.createPagination(input.page, input.pageSize, total),
      ...(input.status ? { status: input.status } : {}),
    };
  }

  private mapPayment(payment: PaymentPersistence): PaymentRecord {
    return {
      id: payment.id,
      bookingRequestId: payment.bookingRequestId,
      postingId: payment.postingId,
      renterId: payment.renterId,
      ownerId: payment.ownerId,
      organizationId: payment.organizationId,
      provider: PAYMENT_PROVIDER,
      status: payment.status,
      pricingCurrency: payment.pricingCurrency,
      rentalSubtotalAmount: Number(payment.rentalSubtotalAmount),
      platformFeeAmount: Number(payment.platformFeeAmount),
      totalAmount: Number(payment.totalAmount),
      squarePaymentId: payment.squarePaymentId ?? undefined,
      squareOrderId: payment.squareOrderId ?? undefined,
      squareLocationId: payment.squareLocationId ?? undefined,
      checkoutUrl: payment.checkoutUrl ?? undefined,
      lastAttemptedAt: payment.lastAttemptedAt?.toISOString(),
      succeededAt: payment.succeededAt?.toISOString(),
      failedAt: payment.failedAt?.toISOString(),
      cancelledAt: payment.cancelledAt?.toISOString(),
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
      booking: {
        id: payment.bookingRequest.id,
        status: payment.bookingRequest.status,
        startAt: payment.bookingRequest.startAt.toISOString(),
        endAt: payment.bookingRequest.endAt.toISOString(),
        holdExpiresAt: payment.bookingRequest.holdExpiresAt.toISOString(),
        paymentReconciliationRequired:
          payment.bookingRequest.paymentReconciliationRequired,
      },
      attempts: payment.attempts.map((attempt) => ({
        id: attempt.id,
        paymentId: attempt.paymentId,
        idempotencyKey: attempt.idempotencyKey,
        status: attempt.status,
        retryCount: attempt.retryCount,
        failureCategory: attempt.failureCategory ?? undefined,
        failureCode: attempt.failureCode ?? undefined,
        failureMessage: attempt.failureMessage ?? undefined,
        providerRequestId: attempt.providerRequestId ?? undefined,
        squarePaymentId: attempt.squarePaymentId ?? undefined,
        nextRetryAt: attempt.nextRetryAt?.toISOString(),
        createdAt: attempt.createdAt.toISOString(),
        updatedAt: attempt.updatedAt.toISOString(),
      })),
      refunds: payment.refunds.map((refund) => ({
        id: refund.id,
        paymentId: refund.paymentId,
        status: refund.status,
        amount: Number(refund.amount),
        reason: refund.reason ?? undefined,
        idempotencyKey: refund.idempotencyKey,
        squareRefundId: refund.squareRefundId ?? undefined,
        createdAt: refund.createdAt.toISOString(),
        updatedAt: refund.updatedAt.toISOString(),
        completedAt: refund.completedAt?.toISOString(),
      })),
      payout: payment.payout ? this.mapPayout(payment.payout) : undefined,
    };
  }

  private mapPayout(payout: PayoutPersistence): PayoutRecord {
    return {
      id: payout.id,
      paymentId: payout.paymentId,
      ownerId: payout.ownerId,
      organizationId: payout.organizationId,
      status: payout.status,
      amount: Number(payout.amount),
      dueAt: payout.dueAt.toISOString(),
      releasedAt: payout.releasedAt?.toISOString(),
      failedAt: payout.failedAt?.toISOString(),
      squarePayoutId: payout.squarePayoutId ?? undefined,
      failureMessage: payout.failureMessage ?? undefined,
      createdAt: payout.createdAt.toISOString(),
      updatedAt: payout.updatedAt.toISOString(),
    };
  }

  private createPagination(page: number, pageSize: number, total: number) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }
}
