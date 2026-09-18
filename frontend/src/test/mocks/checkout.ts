import type {
  CheckoutSummary,
  PaymentAttemptRecord,
  PaymentRecord,
} from "@/lib/payments/api";

export function buildCheckoutSummary(
  overrides: Partial<CheckoutSummary> = {},
): CheckoutSummary {
  return {
    serverTime: "2026-09-17T12:00:00.000Z",
    booking: {
      id: "booking-1",
      status: "awaiting_payment",
      startAt: "2026-10-01T15:00:00.000Z",
      endAt: "2026-10-05T15:00:00.000Z",
      durationDays: 4,
      guestCount: 2,
      holdExpiresAt: "2026-09-20T12:00:00.000Z",
      dailyPriceAmount: 250,
      currency: "CAD",
    },
    posting: {
      id: "posting-1",
      name: "Junction Team Offsite Loft",
      primaryPhotoUrl: "https://example.com/loft.jpg",
    },
    pricing: {
      currency: "CAD",
      stayTotal: 1000,
      depositAmount: 250,
      platformFeeAmount: 25,
      totalDueNow: 275,
      remainingBalance: 750,
      depositBps: 2500,
      platformFeeBps: 1000,
      source: "quote",
    },
    cancellationPolicy: {
      code: "platform_default_v1",
      fullRefundCutoffHours: 48,
      partialRefundCutoffHours: 24,
      partialRefundPercent: 50,
      ownerCancellationFullRefund: true,
      refundBase: "total_paid",
      hostNotes: "Early check-in on request.",
    },
    checkout: { eligible: true },
    payment: null,
    paypal: {
      clientId: "sandbox-client",
      environment: "sandbox",
      enabledMethods: ["paypal", "paypal_guest", "card"],
    },
    ...overrides,
  };
}

export function buildCheckoutPayment(
  overrides: Partial<PaymentRecord> = {},
): PaymentRecord {
  return {
    id: "payment-1",
    bookingRequestId: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    organizationId: "org-1",
    provider: "paypal",
    status: "succeeded",
    pricingCurrency: "CAD",
    rentalSubtotalAmount: 250,
    platformFeeAmount: 25,
    totalAmount: 275,
    providerOrderId: "ORDER-2",
    createdAt: "2026-09-17T12:00:00.000Z",
    updatedAt: "2026-09-17T12:00:00.000Z",
    booking: {
      id: "booking-1",
      status: "paid",
      startAt: "2026-10-01T15:00:00.000Z",
      endAt: "2026-10-05T15:00:00.000Z",
      holdExpiresAt: "2026-09-20T12:00:00.000Z",
      paymentReconciliationRequired: false,
    },
    attempts: [],
    refunds: [],
    ...overrides,
  };
}

export function buildPaymentAttempt(
  overrides: Partial<PaymentAttemptRecord> = {},
): PaymentAttemptRecord {
  return {
    id: "attempt-1",
    paymentId: "payment-1",
    idempotencyKey: "key-1",
    status: "failed_final",
    retryCount: 0,
    createdAt: "2026-09-17T12:00:00.000Z",
    updatedAt: "2026-09-17T12:00:00.000Z",
    ...overrides,
  };
}
