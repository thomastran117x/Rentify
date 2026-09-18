import { buildApiPath } from "@/configuration/http/api-path";
import { SEED_BOOKINGS } from "@/seeds/fixtures/bookings";
import {
  createAuthenticatedRequestContext,
  createPersistenceTestApp,
  resetPersistenceState,
  teardownPersistenceTestApp,
  type PersistenceTestApp,
} from "../../support/persistence-test-app";
import { testUuid } from "../../support/uuid";

// Well-formed but never seeded, so the handler reaches its not-found path.
const ABSENT_BOOKING_ID = testUuid(1020, 999);

async function getPaymentForBooking(
  persistenceApp: PersistenceTestApp,
  bookingRequestId: string,
) {
  return persistenceApp.prisma.payment.findUniqueOrThrow({
    where: {
      bookingRequestId,
    },
    include: {
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
      bookingRequest: true,
      payout: true,
    },
  });
}

describe("Payments persistence integration", () => {
  let persistenceApp: PersistenceTestApp;

  beforeAll(async () => {
    persistenceApp = await createPersistenceTestApp();
  }, 180_000);

  beforeEach(async () => {
    await resetPersistenceState();
  }, 180_000);

  afterAll(async () => {
    await teardownPersistenceTestApp();
  }, 180_000);

  it("persists payment session creation and retry attempts", async () => {
    const retryableBooking = SEED_BOOKINGS[16]!;
    const renter = await createAuthenticatedRequestContext({
      email: retryableBooking.renterEmail,
    });
    const beforeCreatePayment = await getPaymentForBooking(
      persistenceApp,
      retryableBooking.id,
    );

    const createSessionResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${retryableBooking.id}/payment-session`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          idempotencyKey: "persistence-create-session-1",
        }),
      },
    );

    expect(createSessionResponse.status).toBe(201);
    const afterCreatePayment = await getPaymentForBooking(
      persistenceApp,
      retryableBooking.id,
    );
    expect(afterCreatePayment.status).toBe("processing");
    expect(afterCreatePayment.attempts.length).toBeGreaterThan(
      beforeCreatePayment.attempts.length,
    );
    expect(afterCreatePayment.attempts[0]).toMatchObject({
      status: "processing",
      providerRequestId: expect.any(String),
    });
    expect(afterCreatePayment.bookingRequest.status).toBe("payment_processing");

    const retryBooking = SEED_BOOKINGS[17]!;
    const retryRenter = await createAuthenticatedRequestContext({
      email: retryBooking.renterEmail,
    });
    const beforeRetryPayment = await getPaymentForBooking(
      persistenceApp,
      retryBooking.id,
    );

    const retryResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${beforeRetryPayment.id}/retry`)}`,
      {
        method: "POST",
        headers: retryRenter.headers(),
        body: JSON.stringify({
          idempotencyKey: "persistence-retry-1",
        }),
      },
    );

    expect(retryResponse.status).toBe(200);
    const afterRetryPayment = await getPaymentForBooking(
      persistenceApp,
      retryBooking.id,
    );
    expect(afterRetryPayment.status).toBe("processing");
    expect(afterRetryPayment.attempts.length).toBeGreaterThan(
      beforeRetryPayment.attempts.length,
    );
    expect(afterRetryPayment.attempts[0]).toMatchObject({
      status: "processing",
      providerRequestId: expect.any(String),
    });
  });

  it("records abandoned checkouts so the renter can restart them", async () => {
    const booking = SEED_BOOKINGS[16]!;
    const renter = await createAuthenticatedRequestContext({
      email: booking.renterEmail,
    });

    const createResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${booking.id}/payment-session`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          idempotencyKey: "persistence-cancel-checkout-1",
        }),
      },
    );
    expect(createResponse.status).toBe(201);

    const payment = await getPaymentForBooking(persistenceApp, booking.id);
    persistenceApp.stubs.paymentProvider.getPaymentStatus.mockResolvedValueOnce(
      {
        providerOrderId: payment.providerOrderId,
        status: "PENDING",
        raw: { source: "test" },
      },
    );

    const cancelResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${payment.id}/cancel-checkout`)}`,
      {
        method: "POST",
        headers: renter.headers(),
      },
    );

    expect(cancelResponse.status).toBe(200);
    expect(
      await getPaymentForBooking(persistenceApp, booking.id),
    ).toMatchObject({
      status: "failed_final",
      bookingRequest: {
        status: "payment_failed",
      },
    });

    const retryResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${payment.id}/retry`)}`,
      {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          idempotencyKey: "persistence-cancel-checkout-retry-1",
        }),
      },
    );

    expect(retryResponse.status).toBe(200);
    expect(
      await getPaymentForBooking(persistenceApp, booking.id),
    ).toMatchObject({
      status: "processing",
    });
  });

  it("captures approved orders through the return endpoint and enforces access", async () => {
    const captureBooking = SEED_BOOKINGS[18]!;
    const renter = await createAuthenticatedRequestContext({
      email: captureBooking.renterEmail,
    });
    const payment = await getPaymentForBooking(
      persistenceApp,
      captureBooking.id,
    );
    const strangerEmail = ["user6@rentify.local", "user5@rentify.local"].find(
      (email) => email !== captureBooking.renterEmail,
    )!;
    const stranger = await createAuthenticatedRequestContext({
      email: strangerEmail,
    });

    const forbiddenResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${payment.id}/capture`)}`,
      {
        method: "POST",
        headers: stranger.headers(),
      },
    );

    expect([403, 404]).toContain(forbiddenResponse.status);

    const captureResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${payment.id}/capture`)}`,
      {
        method: "POST",
        headers: renter.headers(),
      },
    );

    expect(captureResponse.status).toBe(200);
    expect(
      await getPaymentForBooking(persistenceApp, captureBooking.id),
    ).toMatchObject({
      status: "succeeded",
      providerPaymentId: expect.any(String),
      bookingRequest: {
        status: "paid",
      },
    });
  });

  it("persists refunds, reconciliations, webhook effects, and admin repairs", async () => {
    const managedBooking = SEED_BOOKINGS[11]!;
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const managedPayment = await getPaymentForBooking(
      persistenceApp,
      managedBooking.id,
    );
    const beforeRefundCount = await persistenceApp.prisma.refund.count({
      where: {
        paymentId: managedPayment.id,
      },
    });

    const refundResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${managedPayment.id}/refunds`)}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          amount: 50,
          reason: "Partial goodwill refund",
          idempotencyKey: "persistence-refund-1",
        }),
      },
    );

    expect(refundResponse.status).toBe(201);
    const refundedPayment = await getPaymentForBooking(
      persistenceApp,
      managedBooking.id,
    );
    expect(refundedPayment.status).toBe("partially_refunded");
    expect(
      await persistenceApp.prisma.refund.count({
        where: {
          paymentId: managedPayment.id,
        },
      }),
    ).toBe(beforeRefundCount + 1);
    const persistedRefund = await persistenceApp.prisma.refund.findFirstOrThrow(
      {
        where: {
          paymentId: managedPayment.id,
          reason: "Partial goodwill refund",
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    );

    expect(persistedRefund.status).toBe("succeeded");
    expect(persistedRefund.providerRefundId).toEqual(expect.any(String));
    expect(Number(persistedRefund.amount)).toBe(50);

    const reconcileBooking = SEED_BOOKINGS[18]!;
    const reconcileRenter = await createAuthenticatedRequestContext({
      email: reconcileBooking.renterEmail,
    });
    const reconcilePayment = await getPaymentForBooking(
      persistenceApp,
      reconcileBooking.id,
    );

    const reconcileResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${reconcilePayment.id}/reconcile`)}`,
      {
        method: "POST",
        headers: reconcileRenter.headers(),
      },
    );

    expect(reconcileResponse.status).toBe(200);
    expect(
      await getPaymentForBooking(persistenceApp, reconcileBooking.id),
    ).toMatchObject({
      status: "succeeded",
      bookingRequest: {
        status: "paid",
      },
    });

    const webhookBooking = SEED_BOOKINGS[16]!;
    const webhookPayment = await getPaymentForBooking(
      persistenceApp,
      webhookBooking.id,
    );

    const webhookResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/payments/webhooks/paypal")}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "paypal-transmission-sig": "signature-ok",
        },
        body: JSON.stringify({
          id: "evt-persistence-1",
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: {
            id: webhookPayment.providerPaymentId,
            status: "COMPLETED",
            supplementary_data: {
              related_ids: {
                order_id: webhookPayment.providerOrderId,
              },
            },
          },
        }),
      },
    );

    expect(webhookResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.payment.findUniqueOrThrow({
        where: {
          id: webhookPayment.id,
        },
      }),
    ).toMatchObject({
      status: "succeeded",
    });
    expect(
      await persistenceApp.prisma.paymentWebhookEvent.findUniqueOrThrow({
        where: {
          providerEventId: "evt-persistence-1",
        },
      }),
    ).toMatchObject({
      paymentId: webhookPayment.id,
      signatureValid: true,
      processedAt: expect.any(Date),
    });

    const repairBooking = SEED_BOOKINGS[17]!;
    const repairPayment = await getPaymentForBooking(
      persistenceApp,
      repairBooking.id,
    );
    const admin = await createAuthenticatedRequestContext({
      email: "admin1@rentify.local",
    });

    const repairResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${repairPayment.id}/repair`)}`,
      {
        method: "POST",
        headers: admin.headers(),
      },
    );

    expect(repairResponse.status).toBe(200);
    expect(
      await persistenceApp.prisma.payment.findUniqueOrThrow({
        where: {
          id: repairPayment.id,
        },
      }),
    ).toMatchObject({
      status: "succeeded",
    });
  });

  it("returns a payment by booking request for the renter and org members but not strangers", async () => {
    const booking = SEED_BOOKINGS[11]!;
    const payment = await getPaymentForBooking(persistenceApp, booking.id);

    const renter = await createAuthenticatedRequestContext({
      email: booking.renterEmail,
    });
    const renterResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${booking.id}/payment`)}`,
      {
        method: "GET",
        headers: renter.headers(),
      },
    );

    expect(renterResponse.status).toBe(200);
    await expect(renterResponse.json()).resolves.toMatchObject({
      data: {
        id: payment.id,
        bookingRequestId: booking.id,
        rentalSubtotalAmount: expect.any(Number),
        platformFeeAmount: expect.any(Number),
        totalAmount: expect.any(Number),
      },
    });

    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const ownerResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${booking.id}/payment`)}`,
      {
        method: "GET",
        headers: owner.headers(),
      },
    );

    expect(ownerResponse.status).toBe(200);

    const stranger = await createAuthenticatedRequestContext({
      email: "user5@rentify.local",
    });
    const strangerResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${booking.id}/payment`)}`,
      {
        method: "GET",
        headers: stranger.headers(),
      },
    );

    expect(strangerResponse.status).toBe(403);

    // A well-formed identifier that no row uses still reaches the handler and
    // comes back as a 404. Kept distinct from the malformed case below so the
    // route-parameter check cannot quietly swallow the not-found path.
    const missingResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/booking-requests/${ABSENT_BOOKING_ID}/payment`)}`,
      {
        method: "GET",
        headers: renter.headers(),
      },
    );

    expect(missingResponse.status).toBe(404);

    const malformedResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/booking-requests/booking-does-not-exist/payment")}`,
      {
        method: "GET",
        headers: renter.headers(),
      },
    );

    expect(malformedResponse.status).toBe(400);
    await expect(malformedResponse.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("does not persist invalid refunds or forbidden repair attempts", async () => {
    const refundBooking = SEED_BOOKINGS[11]!;
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const refundPayment = await getPaymentForBooking(
      persistenceApp,
      refundBooking.id,
    );
    const beforeRefundCount = await persistenceApp.prisma.refund.count({
      where: {
        paymentId: refundPayment.id,
      },
    });

    const invalidRefundResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${refundPayment.id}/refunds`)}`,
      {
        method: "POST",
        headers: owner.headers(),
        body: JSON.stringify({
          amount: 0,
          reason: "",
        }),
      },
    );

    expect(invalidRefundResponse.status).toBe(400);
    expect(
      await persistenceApp.prisma.refund.count({
        where: {
          paymentId: refundPayment.id,
        },
      }),
    ).toBe(beforeRefundCount);

    const repairBooking = SEED_BOOKINGS[16]!;
    const repairPayment = await getPaymentForBooking(
      persistenceApp,
      repairBooking.id,
    );
    const beforeRepairStatus = repairPayment.status;

    const forbiddenRepairResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${repairPayment.id}/repair`)}`,
      {
        method: "POST",
        headers: owner.headers(),
      },
    );

    expect(forbiddenRepairResponse.status).toBe(403);
    expect(
      await persistenceApp.prisma.payment.findUniqueOrThrow({
        where: {
          id: repairPayment.id,
        },
      }),
    ).toMatchObject({
      status: beforeRepairStatus,
    });
  });

  it("serves payment detail and owner payout listings with authorization limits", async () => {
    const paidBooking = SEED_BOOKINGS[16]!;
    const payment = await getPaymentForBooking(persistenceApp, paidBooking.id);
    expect(payment).not.toBeNull();

    const renter = await createAuthenticatedRequestContext({
      email: paidBooking.renterEmail,
    });
    const owner = await createAuthenticatedRequestContext({
      email: "owner1@rentify.local",
    });
    const stranger = await createAuthenticatedRequestContext({
      email: "user5@rentify.local",
    });

    const detailResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${payment!.id}`)}`,
      { headers: renter.headers() },
    );
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      data: { id: payment!.id, bookingRequestId: paidBooking.id },
    });

    // A payment belongs to its renter and the owning organization only.
    const forbiddenDetailResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath(`/payments/${payment!.id}`)}`,
      { headers: stranger.headers() },
    );
    expect(forbiddenDetailResponse.status).toBeGreaterThanOrEqual(400);

    const payoutsResponse = await persistenceApp.app.request(
      `http://rent.test${buildApiPath("/payouts/me")}`,
      { headers: owner.headers() },
    );
    expect(payoutsResponse.status).toBe(200);
    const payouts = (await payoutsResponse.json()) as {
      data: { payouts: Array<{ id: string; organizationId: string }> };
    };
    expect(Array.isArray(payouts.data.payouts)).toBe(true);
  });
  describe("embedded checkout", () => {
    // Seeded for renter-five, who is not a member of the owning organization.
    const awaitingPaymentBooking = SEED_BOOKINGS.find(
      (booking) =>
        booking.note === "Team offsite; approved and waiting on checkout.",
    )!;

    it("serves the checkout summary to the renter only", async () => {
      const renter = await createAuthenticatedRequestContext({
        email: awaitingPaymentBooking.renterEmail,
      });
      const summaryResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${awaitingPaymentBooking.id}/checkout`)}`,
        {
          method: "GET",
          headers: renter.headers(),
        },
      );

      expect(summaryResponse.status).toBe(200);
      const stayTotal = awaitingPaymentBooking.estimatedTotal;
      const depositAmount = Math.round(stayTotal * 0.25 * 100) / 100;
      const platformFeeAmount = Math.round(depositAmount * 0.1 * 100) / 100;
      await expect(summaryResponse.json()).resolves.toMatchObject({
        data: {
          booking: {
            id: awaitingPaymentBooking.id,
            status: "awaiting_payment",
            guestCount: awaitingPaymentBooking.guestCount,
            currency: "CAD",
          },
          posting: {
            id: awaitingPaymentBooking.postingId,
            name: expect.any(String),
          },
          pricing: {
            currency: "CAD",
            stayTotal,
            depositAmount,
            platformFeeAmount,
            totalDueNow:
              Math.round((depositAmount + platformFeeAmount) * 100) / 100,
            depositBps: 2500,
            platformFeeBps: 1000,
            source: "quote",
          },
          cancellationPolicy: {
            code: "platform_default_v1",
            hostNotes: expect.any(String),
          },
          checkout: { eligible: true },
          payment: null,
          paypal: {
            environment: "sandbox",
            enabledMethods: expect.arrayContaining(["paypal", "card"]),
          },
        },
      });

      const owner = await createAuthenticatedRequestContext({
        email: "owner1@rentify.local",
      });
      const ownerResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${awaitingPaymentBooking.id}/checkout`)}`,
        {
          method: "GET",
          headers: owner.headers(),
        },
      );
      expect(ownerResponse.status).toBe(403);

      const missingResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${ABSENT_BOOKING_ID}/checkout`)}`,
        {
          method: "GET",
          headers: renter.headers(),
        },
      );
      expect(missingResponse.status).toBe(404);

      const paidBooking = SEED_BOOKINGS[11]!;
      const paidRenter = await createAuthenticatedRequestContext({
        email: paidBooking.renterEmail,
      });
      const paidResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${paidBooking.id}/checkout`)}`,
        {
          method: "GET",
          headers: paidRenter.headers(),
        },
      );
      expect(paidResponse.status).toBe(200);
      await expect(paidResponse.json()).resolves.toMatchObject({
        data: {
          checkout: { eligible: false, reason: "converted" },
          pricing: { source: "payment" },
        },
      });
    });

    it("creates embedded orders, supersedes unapproved ones, and only captures the current order", async () => {
      persistenceApp.stubs.paymentProvider.capturePayment.mockClear();
      const renter = await createAuthenticatedRequestContext({
        email: awaitingPaymentBooking.renterEmail,
      });

      const cardResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${awaitingPaymentBooking.id}/payment-session`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify({
            idempotencyKey: "embedded-card-1",
            method: "card",
          }),
        },
      );

      expect(cardResponse.status).toBe(201);
      const cardPayment = await getPaymentForBooking(
        persistenceApp,
        awaitingPaymentBooking.id,
      );
      const firstOrderId = cardPayment.providerOrderId!;
      expect(cardPayment).toMatchObject({
        status: "processing",
        bookingRequest: { status: "payment_processing" },
      });
      expect(cardPayment.attempts[0]).toMatchObject({
        paymentMethod: "card",
        providerOrderId: firstOrderId,
      });
      expect(
        persistenceApp.stubs.paymentProvider.createPaymentSession,
      ).toHaveBeenLastCalledWith(expect.objectContaining({ method: "card" }));

      // Replaying the same request returns the same order instead of a 400.
      const replayResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${awaitingPaymentBooking.id}/payment-session`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify({
            idempotencyKey: "embedded-card-1",
            method: "card",
          }),
        },
      );
      expect(replayResponse.status).toBe(201);
      await expect(replayResponse.json()).resolves.toMatchObject({
        data: { providerOrderId: firstOrderId },
      });

      // The renter closes the card flow and picks PayPal instead.
      persistenceApp.stubs.paymentProvider.getPaymentStatus.mockResolvedValueOnce(
        {
          providerOrderId: firstOrderId,
          status: "PENDING",
          raw: { source: "test" },
        },
      );
      const paypalResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${awaitingPaymentBooking.id}/payment-session`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify({
            idempotencyKey: "embedded-paypal-1",
            method: "paypal",
          }),
        },
      );

      expect(paypalResponse.status).toBe(201);
      const superseded = await getPaymentForBooking(
        persistenceApp,
        awaitingPaymentBooking.id,
      );
      const secondOrderId = superseded.providerOrderId!;
      expect(secondOrderId).not.toBe(firstOrderId);
      expect(superseded.bookingRequest.status).toBe("payment_processing");
      expect(superseded.attempts).toEqual([
        expect.objectContaining({
          paymentMethod: "paypal",
          providerOrderId: secondOrderId,
          status: "processing",
        }),
        expect.objectContaining({
          paymentMethod: "card",
          providerOrderId: firstOrderId,
          status: "failed_final",
          failureCode: "CHECKOUT_SUPERSEDED",
        }),
      ]);

      const staleCapture = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/payments/${superseded.id}/capture`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify({ orderId: firstOrderId }),
        },
      );
      expect(staleCapture.status).toBe(409);
      await expect(staleCapture.json()).resolves.toMatchObject({
        error: { details: { reason: "stale_order" } },
      });
      expect(
        persistenceApp.stubs.paymentProvider.capturePayment,
      ).not.toHaveBeenCalled();

      persistenceApp.stubs.paymentProvider.getPaymentStatus.mockResolvedValueOnce(
        {
          providerOrderId: secondOrderId,
          status: "APPROVED",
          order: {
            paymentSource: "paypal",
            customId: superseded.id,
            amount: Number(superseded.totalAmount),
            currency: superseded.pricingCurrency,
          },
          raw: { source: "test" },
        },
      );
      const captureResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/payments/${superseded.id}/capture`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify({ orderId: secondOrderId }),
        },
      );

      expect(captureResponse.status).toBe(200);
      expect(
        persistenceApp.stubs.paymentProvider.capturePayment,
      ).toHaveBeenCalledWith({
        providerOrderId: secondOrderId,
        idempotencyKey: `capture-${secondOrderId}`,
      });
      expect(
        await getPaymentForBooking(persistenceApp, awaitingPaymentBooking.id),
      ).toMatchObject({
        status: "succeeded",
        bookingRequest: { status: "paid" },
      });

      const paidSummary = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${awaitingPaymentBooking.id}/checkout`)}`,
        {
          method: "GET",
          headers: renter.headers(),
        },
      );
      await expect(paidSummary.json()).resolves.toMatchObject({
        data: {
          checkout: { eligible: false, reason: "already_paid" },
          payment: { status: "succeeded", method: "paypal" },
        },
      });
    });

    it("refuses to cancel a checkout that a newer order replaced", async () => {
      const renter = await createAuthenticatedRequestContext({
        email: awaitingPaymentBooking.renterEmail,
      });
      const path = buildApiPath(
        `/booking-requests/${awaitingPaymentBooking.id}/payment-session`,
      );

      await persistenceApp.app.request(`http://rent.test${path}`, {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          idempotencyKey: "cancel-first",
          method: "paypal",
        }),
      });
      const first = await getPaymentForBooking(
        persistenceApp,
        awaitingPaymentBooking.id,
      );

      persistenceApp.stubs.paymentProvider.getPaymentStatus.mockResolvedValueOnce(
        {
          providerOrderId: first.providerOrderId,
          status: "PENDING",
          raw: { source: "test" },
        },
      );
      await persistenceApp.app.request(`http://rent.test${path}`, {
        method: "POST",
        headers: renter.headers(),
        body: JSON.stringify({
          idempotencyKey: "cancel-second",
          method: "card",
        }),
      });
      const second = await getPaymentForBooking(
        persistenceApp,
        awaitingPaymentBooking.id,
      );
      expect(second.providerOrderId).not.toBe(first.providerOrderId);

      // The renter now follows the first order's cancel URL.
      const staleCancel = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/payments/${second.id}/cancel-checkout`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify({ orderId: first.providerOrderId }),
        },
      );

      expect(staleCancel.status).toBe(409);
      await expect(staleCancel.json()).resolves.toMatchObject({
        error: { details: { reason: "stale_order" } },
      });
      expect(
        await getPaymentForBooking(persistenceApp, awaitingPaymentBooking.id),
      ).toMatchObject({
        status: "processing",
        providerOrderId: second.providerOrderId,
        bookingRequest: { status: "payment_processing" },
      });
    });

    it("refuses to capture card orders that failed 3-D Secure", async () => {
      persistenceApp.stubs.paymentProvider.capturePayment.mockClear();
      const renter = await createAuthenticatedRequestContext({
        email: awaitingPaymentBooking.renterEmail,
      });
      const sessionResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/booking-requests/${awaitingPaymentBooking.id}/payment-session`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify({
            idempotencyKey: "embedded-card-3ds",
            method: "card",
          }),
        },
      );
      expect(sessionResponse.status).toBe(201);
      const payment = await getPaymentForBooking(
        persistenceApp,
        awaitingPaymentBooking.id,
      );

      persistenceApp.stubs.paymentProvider.getPaymentStatus.mockResolvedValueOnce(
        {
          providerOrderId: payment.providerOrderId,
          status: "APPROVED",
          order: {
            paymentSource: "card",
            customId: payment.id,
            amount: Number(payment.totalAmount),
            currency: payment.pricingCurrency,
            cardAuthentication: {
              liabilityShift: "NO",
              enrollmentStatus: "Y",
              authenticationStatus: "R",
            },
          },
          raw: { source: "test" },
        },
      );
      const captureResponse = await persistenceApp.app.request(
        `http://rent.test${buildApiPath(`/payments/${payment.id}/capture`)}`,
        {
          method: "POST",
          headers: renter.headers(),
          body: JSON.stringify({ orderId: payment.providerOrderId }),
        },
      );

      expect(captureResponse.status).toBe(200);
      expect(
        persistenceApp.stubs.paymentProvider.capturePayment,
      ).not.toHaveBeenCalled();
      const rejected = await getPaymentForBooking(
        persistenceApp,
        awaitingPaymentBooking.id,
      );
      expect(rejected).toMatchObject({
        status: "failed_final",
        bookingRequest: { status: "payment_failed" },
      });
      expect(rejected.attempts[0]).toMatchObject({
        failureCode: "CARD_AUTHENTICATION_FAILED",
      });
    });
  });
});
