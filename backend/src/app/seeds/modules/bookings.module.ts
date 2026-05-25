import { SEED_BOOKINGS } from "@/seeds/fixtures/bookings";
import type { SeedModule } from "@/seeds/types";

function isDefined<TValue>(value: TValue | undefined): value is TValue {
  return value !== undefined;
}

function calculateDurationDays(startAt: string, endAt: string): number {
  return Math.max(
    1,
    Math.round(
      (new Date(endAt).getTime() - new Date(startAt).getTime()) /
        (1000 * 60 * 60 * 24),
    ),
  );
}

function buildPricingSnapshot(fixture: (typeof SEED_BOOKINGS)[number]) {
  return {
    currency: fixture.pricingCurrency,
    daily: {
      amount: fixture.dailyPriceAmount,
    },
    estimatedTotal: fixture.estimatedTotal,
    durationDays: calculateDurationDays(fixture.startAt, fixture.endAt),
  };
}

export const bookingsSeedModule: SeedModule = {
  name: "bookings",
  async run({ logger, prisma, state }) {
    const bookingIds = SEED_BOOKINGS.map((fixture) => fixture.id);
    const paymentIds = SEED_BOOKINGS.map(
      (fixture) => fixture.payment?.id,
    ).filter(isDefined);
    const rentingIds = SEED_BOOKINGS.map(
      (fixture) => fixture.renting?.id,
    ).filter(isDefined);
    const rentingDisputeIds = SEED_BOOKINGS.map(
      (fixture) => fixture.renting?.dispute?.id,
    ).filter(isDefined);
    const blockIds = SEED_BOOKINGS.flatMap((fixture) =>
      [fixture.holdBlock?.id, fixture.rentingBlock?.id].filter(isDefined),
    );
    const attemptIds = SEED_BOOKINGS.flatMap(
      (fixture) => fixture.payment?.attempts.map((attempt) => attempt.id) ?? [],
    );
    const refundIds = SEED_BOOKINGS.flatMap(
      (fixture) => fixture.payment?.refunds.map((refund) => refund.id) ?? [],
    );
    const payoutIds = SEED_BOOKINGS.flatMap((fixture) =>
      fixture.payment?.payout ? [fixture.payment.payout.id] : [],
    );
    const webhookIds = SEED_BOOKINGS.flatMap(
      (fixture) =>
        fixture.payment?.webhookEvents.map((event) => event.id) ?? [],
    );
    const ledgerIds = SEED_BOOKINGS.flatMap(
      (fixture) =>
        fixture.payment?.ledgerEntries.map((entry) => entry.id) ?? [],
    );

    await prisma.rentingDispute.deleteMany({
      where: {
        id: {
          in: rentingDisputeIds,
        },
      },
    });
    await prisma.refund.deleteMany({
      where: {
        id: {
          in: refundIds,
        },
      },
    });
    await prisma.payout.deleteMany({
      where: {
        id: {
          in: payoutIds,
        },
      },
    });
    await prisma.paymentLedgerEntry.deleteMany({
      where: {
        id: {
          in: ledgerIds,
        },
      },
    });
    await prisma.paymentWebhookEvent.deleteMany({
      where: {
        id: {
          in: webhookIds,
        },
      },
    });
    await prisma.paymentAttempt.deleteMany({
      where: {
        id: {
          in: attemptIds,
        },
      },
    });
    await prisma.payment.deleteMany({
      where: {
        id: {
          in: paymentIds,
        },
      },
    });
    await prisma.renting.deleteMany({
      where: {
        id: {
          in: rentingIds,
        },
      },
    });
    await prisma.bookingRequest.deleteMany({
      where: {
        id: {
          in: bookingIds,
        },
      },
    });
    await prisma.postingAvailabilityBlock.deleteMany({
      where: {
        id: {
          in: blockIds,
        },
      },
    });

    for (const fixture of SEED_BOOKINGS) {
      const ownerId = state.postingOwnerIdsByPostingId.get(fixture.postingId);
      const renterId = state.userIdsByEmail.get(fixture.renterEmail);

      if (!ownerId) {
        throw new Error(
          `Missing seeded posting owner for booking ${fixture.id}.`,
        );
      }

      if (!renterId) {
        throw new Error(`Missing seeded renter for booking ${fixture.id}.`);
      }

      if (fixture.holdBlock) {
        await prisma.postingAvailabilityBlock.create({
          data: {
            id: fixture.holdBlock.id,
            postingId: fixture.postingId,
            startAt: new Date(fixture.holdBlock.startAt),
            endAt: new Date(fixture.holdBlock.endAt),
            note: fixture.holdBlock.note ?? null,
            source: fixture.holdBlock.source,
          },
        });
      }

      if (fixture.rentingBlock) {
        await prisma.postingAvailabilityBlock.create({
          data: {
            id: fixture.rentingBlock.id,
            postingId: fixture.postingId,
            startAt: new Date(fixture.rentingBlock.startAt),
            endAt: new Date(fixture.rentingBlock.endAt),
            note: fixture.rentingBlock.note ?? null,
            source: fixture.rentingBlock.source,
          },
        });
      }

      await prisma.bookingRequest.create({
        data: {
          id: fixture.id,
          postingId: fixture.postingId,
          renterId,
          ownerId,
          status: fixture.status,
          startAt: new Date(fixture.startAt),
          endAt: new Date(fixture.endAt),
          durationDays: calculateDurationDays(fixture.startAt, fixture.endAt),
          guestCount: fixture.guestCount,
          contactName: fixture.contactName,
          contactEmail: fixture.contactEmail,
          contactPhoneNumber: fixture.contactPhoneNumber ?? null,
          note: fixture.note ?? null,
          pricingCurrency: fixture.pricingCurrency,
          pricingSnapshot: buildPricingSnapshot(fixture) as never,
          dailyPriceAmount: fixture.dailyPriceAmount,
          estimatedTotal: fixture.estimatedTotal,
          decisionNote: fixture.decisionNote ?? null,
          approvedAt: fixture.approvedAt ? new Date(fixture.approvedAt) : null,
          paymentRequiredAt: fixture.paymentRequiredAt
            ? new Date(fixture.paymentRequiredAt)
            : null,
          paymentFailedAt: fixture.paymentFailedAt
            ? new Date(fixture.paymentFailedAt)
            : null,
          cancelledAt: fixture.cancelledAt
            ? new Date(fixture.cancelledAt)
            : null,
          refundedAt: fixture.refundedAt ? new Date(fixture.refundedAt) : null,
          declinedAt: fixture.declinedAt ? new Date(fixture.declinedAt) : null,
          expiredAt: fixture.expiredAt ? new Date(fixture.expiredAt) : null,
          convertedAt: fixture.convertedAt
            ? new Date(fixture.convertedAt)
            : null,
          conversionReservedAt: fixture.conversionReservedAt
            ? new Date(fixture.conversionReservedAt)
            : null,
          conversionReservationExpiresAt: fixture.conversionReservationExpiresAt
            ? new Date(fixture.conversionReservationExpiresAt)
            : null,
          holdExpiresAt: new Date(fixture.holdExpiresAt),
          holdBlockId: fixture.holdBlock?.id ?? null,
          paymentReconciliationRequired:
            fixture.paymentReconciliationRequired ?? false,
          createdAt: new Date(fixture.createdAt),
        },
      });

      if (fixture.payment) {
        await prisma.payment.create({
          data: {
            id: fixture.payment.id,
            bookingRequestId: fixture.id,
            postingId: fixture.postingId,
            renterId,
            ownerId,
            provider: fixture.payment.provider,
            status: fixture.payment.status,
            pricingCurrency: fixture.payment.pricingCurrency,
            rentalSubtotalAmount: fixture.payment.rentalSubtotalAmount,
            platformFeeAmount: fixture.payment.platformFeeAmount,
            totalAmount: fixture.payment.totalAmount,
            squarePaymentId: fixture.payment.squarePaymentId ?? null,
            squareOrderId: fixture.payment.squareOrderId ?? null,
            squareLocationId: fixture.payment.squareLocationId ?? null,
            checkoutUrl: fixture.payment.checkoutUrl ?? null,
            lastAttemptedAt: fixture.payment.lastAttemptedAt
              ? new Date(fixture.payment.lastAttemptedAt)
              : null,
            succeededAt: fixture.payment.succeededAt
              ? new Date(fixture.payment.succeededAt)
              : null,
            failedAt: fixture.payment.failedAt
              ? new Date(fixture.payment.failedAt)
              : null,
            cancelledAt: fixture.payment.cancelledAt
              ? new Date(fixture.payment.cancelledAt)
              : null,
            createdAt: new Date(fixture.payment.createdAt),
          },
        });

        for (const attempt of fixture.payment.attempts) {
          await prisma.paymentAttempt.create({
            data: {
              id: attempt.id,
              paymentId: fixture.payment.id,
              idempotencyKey: attempt.idempotencyKey,
              status: attempt.status,
              retryCount: attempt.retryCount ?? 0,
              failureCategory: attempt.failureCategory ?? null,
              failureCode: attempt.failureCode ?? null,
              failureMessage: attempt.failureMessage ?? null,
              providerRequestId: attempt.providerRequestId ?? null,
              squarePaymentId: attempt.squarePaymentId ?? null,
              requestPayload: attempt.requestPayload
                ? (attempt.requestPayload as never)
                : undefined,
              responsePayload: attempt.responsePayload
                ? (attempt.responsePayload as never)
                : undefined,
              nextRetryAt: attempt.nextRetryAt
                ? new Date(attempt.nextRetryAt)
                : null,
              createdAt: new Date(attempt.createdAt),
            },
          });
        }

        for (const refund of fixture.payment.refunds) {
          await prisma.refund.create({
            data: {
              id: refund.id,
              paymentId: fixture.payment.id,
              issuedByUserId: refund.issuedByUserEmail
                ? (state.userIdsByEmail.get(refund.issuedByUserEmail) ?? null)
                : null,
              status: refund.status,
              amount: refund.amount,
              reason: refund.reason ?? null,
              idempotencyKey: refund.idempotencyKey,
              squareRefundId: refund.squareRefundId ?? null,
              createdAt: new Date(refund.createdAt),
              completedAt: refund.completedAt
                ? new Date(refund.completedAt)
                : null,
            },
          });
        }

        if (fixture.payment.payout) {
          await prisma.payout.create({
            data: {
              id: fixture.payment.payout.id,
              paymentId: fixture.payment.id,
              ownerId,
              status: fixture.payment.payout.status,
              amount: fixture.payment.payout.amount,
              dueAt: new Date(fixture.payment.payout.dueAt),
              releasedAt: fixture.payment.payout.releasedAt
                ? new Date(fixture.payment.payout.releasedAt)
                : null,
              failedAt: fixture.payment.payout.failedAt
                ? new Date(fixture.payment.payout.failedAt)
                : null,
              squarePayoutId: fixture.payment.payout.squarePayoutId ?? null,
              failureMessage: fixture.payment.payout.failureMessage ?? null,
              createdAt: new Date(fixture.payment.payout.createdAt),
            },
          });
        }

        for (const event of fixture.payment.webhookEvents) {
          await prisma.paymentWebhookEvent.create({
            data: {
              id: event.id,
              paymentId: fixture.payment.id,
              provider: "square",
              providerEventId: event.providerEventId,
              eventType: event.eventType,
              signatureValid: event.signatureValid,
              rawPayload: event.rawPayload as never,
              processedAt: event.processedAt
                ? new Date(event.processedAt)
                : null,
              createdAt: new Date(event.createdAt),
            },
          });
        }

        for (const entry of fixture.payment.ledgerEntries) {
          await prisma.paymentLedgerEntry.create({
            data: {
              id: entry.id,
              paymentId: fixture.payment.id,
              type: entry.type,
              amount: entry.amount,
              currency: entry.currency,
              metadata: entry.metadata ? (entry.metadata as never) : undefined,
              createdAt: new Date(entry.createdAt),
            },
          });
        }
      }

      if (fixture.renting) {
        await prisma.renting.create({
          data: {
            id: fixture.renting.id,
            postingId: fixture.postingId,
            bookingRequestId: fixture.id,
            renterId,
            ownerId,
            status: fixture.renting.status,
            startAt: new Date(fixture.startAt),
            endAt: new Date(fixture.endAt),
            durationDays: calculateDurationDays(fixture.startAt, fixture.endAt),
            guestCount: fixture.guestCount,
            pricingCurrency: fixture.pricingCurrency,
            pricingSnapshot: buildPricingSnapshot(fixture) as never,
            dailyPriceAmount: fixture.dailyPriceAmount,
            estimatedTotal: fixture.estimatedTotal,
            confirmedAt: new Date(fixture.renting.confirmedAt),
            pickupInstructions: fixture.renting.pickupInstructions ?? null,
            returnInstructions: fixture.renting.returnInstructions ?? null,
            checkInReadyAt: fixture.renting.checkInReadyAt
              ? new Date(fixture.renting.checkInReadyAt)
              : null,
            checkInCompletedAt: fixture.renting.checkInCompletedAt
              ? new Date(fixture.renting.checkInCompletedAt)
              : null,
            returnDueAt: fixture.renting.returnDueAt
              ? new Date(fixture.renting.returnDueAt)
              : null,
            completedAt: fixture.renting.completedAt
              ? new Date(fixture.renting.completedAt)
              : null,
            disputedAt: fixture.renting.disputedAt
              ? new Date(fixture.renting.disputedAt)
              : null,
            cancelledAt: fixture.renting.cancelledAt
              ? new Date(fixture.renting.cancelledAt)
              : null,
            createdAt: new Date(fixture.renting.createdAt),
          },
        });

        if (fixture.renting.dispute) {
          await prisma.rentingDispute.create({
            data: {
              id: fixture.renting.dispute.id,
              rentingId: fixture.renting.id,
              openedByUserId:
                state.userIdsByEmail.get(
                  fixture.renting.dispute.openedByUserEmail,
                ) ?? renterId,
              reason: fixture.renting.dispute.reason,
              details: fixture.renting.dispute.details ?? null,
              createdAt: new Date(fixture.renting.dispute.createdAt),
            },
          });
        }
      }
    }

    logger.info(
      `Seeded ${SEED_BOOKINGS.length} booking lifecycles with payments and rentings.`,
    );
  },
};
