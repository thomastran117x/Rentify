import {
  createFixtureId,
  type SeedBookingFixture,
  type SeedPaymentAttemptFixture,
  type SeedPaymentFixture,
  type SeedPaymentLedgerEntryFixture,
  type SeedRentingDisputeFixture,
  type SeedPaymentWebhookEventFixture,
  type SeedPayoutFixture,
  type SeedRefundFixture,
  type SeedRentingFixture,
} from "@/seeds/types";

type BookingLifecycle =
  | "pending"
  | "approved"
  | "awaiting_payment"
  | "processing"
  | "paid"
  | "paid_confirmed"
  | "failed_retryable"
  | "failed_final"
  | "declined"
  | "expired"
  | "cancelled"
  | "refunded";

type BookingSpec = {
  index: number;
  postingIndex: number;
  renterEmail: string;
  lifecycle: BookingLifecycle;
  startAt: string;
  endAt: string;
  guestCount: number;
  dailyPriceAmount: number;
  contactName: string;
  note: string;
};

const PAYMENT_PROVIDER = "square" as const;
const PAYMENT_LOCATION_ID = "seed-square-location";
const REFUND_ISSUER_EMAIL = "admin1@rentify.local";

function addHours(value: string, hours: number): string {
  const next = new Date(value);
  next.setUTCHours(next.getUTCHours() + hours);
  return next.toISOString();
}

function addDays(value: string, days: number): string {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

function subtractDays(value: string, days: number): string {
  return addDays(value, -days);
}

function calculateDurationDays(startAt: string, endAt: string): number {
  const diffMs = new Date(endAt).getTime() - new Date(startAt).getTime();
  return Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// BOOKING_SPECS below encodes each booking's startAt/endAt as fixed dates in a
// hardcoded May-Aug 2026 template calendar so the relative spacing between
// specs (and thus their lifecycle semantics, e.g. how far a hold sits from
// its expiry) is easy to read and edit. That template is translated to real
// time at module-load by shifting every date by a constant offset, anchored
// so the template's earliest date lands a few days after "now" - this keeps
// the whole dataset perpetually valid instead of going stale once real time
// catches up to the literals, which is what broke the payments integration
// test (a booking's hold had actually expired by the time the test ran).
const SEED_DATE_TEMPLATE_ANCHOR = Date.parse("2026-05-12T12:00:00.000Z");
const SEED_DATE_RUNTIME_ANCHOR_BUFFER_DAYS = 3;
const SEED_DATE_RUNTIME_OFFSET_MS =
  Date.now() +
  SEED_DATE_RUNTIME_ANCHOR_BUFFER_DAYS * 24 * 60 * 60 * 1000 -
  SEED_DATE_TEMPLATE_ANCHOR;

function toRuntimeDate(templateIso: string): string {
  return new Date(
    Date.parse(templateIso) + SEED_DATE_RUNTIME_OFFSET_MS,
  ).toISOString();
}

function createLedgerEntries(
  index: number,
  currency: string,
  subtotal: number,
  fee: number,
  lifecycle: BookingLifecycle,
): SeedPaymentLedgerEntryFixture[] {
  const entries: SeedPaymentLedgerEntryFixture[] = [
    {
      id: createFixtureId(3350, index),
      type: "charge_created",
      amount: subtotal + fee,
      currency,
      metadata: { source: "seed", lifecycle },
      createdAt: addHours(`2026-04-01T12:00:00.000Z`, index),
    },
  ];

  if (
    ["processing", "paid", "paid_confirmed", "refunded"].includes(lifecycle)
  ) {
    entries.push({
      id: createFixtureId(3351, index),
      type: "charge_succeeded",
      amount: subtotal + fee,
      currency,
      metadata: { source: "seed", lifecycle },
      createdAt: addHours(`2026-04-01T13:00:00.000Z`, index),
    });
  }

  if (["paid", "paid_confirmed"].includes(lifecycle)) {
    entries.push({
      id: createFixtureId(3352, index),
      type: "payout_scheduled",
      amount: subtotal,
      currency,
      metadata: { source: "seed" },
      createdAt: addHours(`2026-04-01T14:00:00.000Z`, index),
    });
  }

  if (lifecycle === "refunded") {
    entries.push({
      id: createFixtureId(3353, index),
      type: "refund_issued",
      amount: subtotal,
      currency,
      metadata: { source: "seed", reason: "guest_request" },
      createdAt: addHours(`2026-04-01T15:00:00.000Z`, index),
    });
  }

  return entries;
}

function createPaymentAttemptFixtures(
  index: number,
  lifecycle: BookingLifecycle,
  squarePaymentId?: string,
): SeedPaymentAttemptFixture[] {
  const baseCreatedAt = addHours(`2026-04-02T09:00:00.000Z`, index);

  if (lifecycle === "awaiting_payment") {
    return [];
  }

  if (lifecycle === "processing") {
    return [
      {
        id: createFixtureId(3310, index),
        idempotencyKey: `seed-payment-attempt-${index}-1`,
        status: "processing",
        retryCount: 0,
        providerRequestId: `seed-request-${index}`,
        requestPayload: { source: "seed", attempt: 1 },
        createdAt: baseCreatedAt,
      },
    ];
  }

  if (lifecycle === "failed_retryable") {
    return [
      {
        id: createFixtureId(3310, index),
        idempotencyKey: `seed-payment-attempt-${index}-1`,
        status: "failed_retryable",
        retryCount: 1,
        failureCategory: "transient",
        failureCode: "gateway-timeout",
        failureMessage: "Payment provider timed out.",
        providerRequestId: `seed-request-${index}`,
        requestPayload: { source: "seed", attempt: 1 },
        responsePayload: { message: "gateway timeout" },
        nextRetryAt: addHours(baseCreatedAt, 6),
        createdAt: baseCreatedAt,
      },
    ];
  }

  if (lifecycle === "failed_final") {
    return [
      {
        id: createFixtureId(3310, index),
        idempotencyKey: `seed-payment-attempt-${index}-1`,
        status: "failed_final",
        retryCount: 0,
        failureCategory: "permanent",
        failureCode: "card-declined",
        failureMessage: "Card was declined by the issuer.",
        providerRequestId: `seed-request-${index}`,
        requestPayload: { source: "seed", attempt: 1 },
        responsePayload: { message: "card declined" },
        createdAt: baseCreatedAt,
      },
    ];
  }

  return [
    {
      id: createFixtureId(3310, index),
      idempotencyKey: `seed-payment-attempt-${index}-1`,
      status: "succeeded",
      retryCount: 0,
      providerRequestId: `seed-request-${index}`,
      squarePaymentId,
      requestPayload: { source: "seed", attempt: 1 },
      responsePayload: { result: "captured" },
      createdAt: baseCreatedAt,
    },
  ];
}

function createWebhookEvents(
  index: number,
  lifecycle: BookingLifecycle,
  createdAt: string,
): SeedPaymentWebhookEventFixture[] {
  if (
    ![
      "processing",
      "paid",
      "paid_confirmed",
      "failed_retryable",
      "failed_final",
      "refunded",
    ].includes(lifecycle)
  ) {
    return [];
  }

  const eventType =
    lifecycle === "refunded"
      ? "payment.refunded"
      : lifecycle === "failed_retryable" || lifecycle === "failed_final"
        ? "payment.failed"
        : "payment.updated";

  return [
    {
      id: createFixtureId(3340, index),
      providerEventId: `seed-webhook-${index}`,
      eventType,
      signatureValid: true,
      rawPayload: { lifecycle, source: "seed" },
      processedAt: createdAt,
      createdAt,
    },
  ];
}

function createRefundFixtures(
  index: number,
  lifecycle: BookingLifecycle,
  subtotal: number,
): SeedRefundFixture[] {
  if (lifecycle !== "refunded") {
    return [];
  }

  return [
    {
      id: createFixtureId(3320, index),
      issuedByUserEmail: REFUND_ISSUER_EMAIL,
      status: "succeeded",
      amount: subtotal,
      reason: "Guest cancelled after charge capture.",
      idempotencyKey: `seed-refund-${index}`,
      squareRefundId: `sq-refund-${index}`,
      createdAt: addHours(`2026-04-03T10:00:00.000Z`, index),
      completedAt: addHours(`2026-04-03T11:00:00.000Z`, index),
    },
  ];
}

function createPayoutFixture(
  index: number,
  lifecycle: BookingLifecycle,
  subtotal: number,
): SeedPayoutFixture | undefined {
  if (!["paid", "paid_confirmed"].includes(lifecycle)) {
    return undefined;
  }

  return {
    id: createFixtureId(3330, index),
    status: "released",
    amount: subtotal,
    dueAt: addDays(`2026-04-04T09:00:00.000Z`, index),
    releasedAt: addDays(`2026-04-05T09:00:00.000Z`, index),
    squarePayoutId: `sq-payout-${index}`,
    createdAt: addHours(`2026-04-04T08:00:00.000Z`, index),
  };
}

function createPaymentFixture(
  index: number,
  lifecycle: BookingLifecycle,
  pricingCurrency: string,
  estimatedTotal: number,
  createdAt: string,
): SeedPaymentFixture | undefined {
  if (
    ["pending", "approved", "declined", "expired", "cancelled"].includes(
      lifecycle,
    )
  ) {
    return undefined;
  }

  const rentalSubtotalAmount = estimatedTotal;
  const platformFeeAmount = roundMoney(estimatedTotal * 0.12);
  const totalAmount = roundMoney(rentalSubtotalAmount + platformFeeAmount);
  const squarePaymentId =
    lifecycle === "awaiting_payment" ? undefined : `sq-payment-${index}`;
  const statusByLifecycle: Record<
    Exclude<
      BookingLifecycle,
      "pending" | "approved" | "declined" | "expired" | "cancelled"
    >,
    SeedPaymentFixture["status"]
  > = {
    awaiting_payment: "awaiting_method",
    processing: "processing",
    paid: "succeeded",
    paid_confirmed: "succeeded",
    failed_retryable: "failed_retryable",
    failed_final: "failed_final",
    refunded: "refunded",
  };

  return {
    id: createFixtureId(3300, index),
    provider: PAYMENT_PROVIDER,
    status:
      lifecycle === "awaiting_payment" ||
      lifecycle === "processing" ||
      lifecycle === "paid" ||
      lifecycle === "paid_confirmed" ||
      lifecycle === "failed_retryable" ||
      lifecycle === "failed_final" ||
      lifecycle === "refunded"
        ? statusByLifecycle[lifecycle]
        : "awaiting_method",
    pricingCurrency,
    rentalSubtotalAmount,
    platformFeeAmount,
    totalAmount,
    squarePaymentId,
    squareOrderId: `sq-order-${index}`,
    squareLocationId: PAYMENT_LOCATION_ID,
    checkoutUrl:
      lifecycle === "awaiting_payment" || lifecycle === "processing"
        ? `https://checkout.square.local/seed-${index}`
        : undefined,
    lastAttemptedAt:
      lifecycle === "awaiting_payment" ? undefined : addHours(createdAt, 2),
    succeededAt:
      lifecycle === "paid" ||
      lifecycle === "paid_confirmed" ||
      lifecycle === "refunded"
        ? addHours(createdAt, 4)
        : undefined,
    failedAt:
      lifecycle === "failed_retryable" || lifecycle === "failed_final"
        ? addHours(createdAt, 3)
        : undefined,
    createdAt,
    attempts: createPaymentAttemptFixtures(index, lifecycle, squarePaymentId),
    refunds: createRefundFixtures(index, lifecycle, rentalSubtotalAmount),
    payout: createPayoutFixture(index, lifecycle, rentalSubtotalAmount),
    webhookEvents: createWebhookEvents(
      index,
      lifecycle,
      addHours(createdAt, 5),
    ),
    ledgerEntries: createLedgerEntries(
      index,
      pricingCurrency,
      rentalSubtotalAmount,
      platformFeeAmount,
      lifecycle,
    ),
  };
}

function createRentingFixture(
  index: number,
  lifecycle: BookingLifecycle,
  renterEmail: string,
  createdAt: string,
): SeedRentingFixture | undefined {
  if (!["paid", "paid_confirmed"].includes(lifecycle)) {
    return undefined;
  }

  const confirmedAt = addHours(createdAt, 8);
  const statusByIndex: Partial<Record<number, SeedRentingFixture["status"]>> = {
    8: "check_in_ready",
    9: "active",
    10: "return_due",
    11: "completed",
    14: "disputed",
  };
  const status = statusByIndex[index] ?? "confirmed";
  const pickupInstructions = `Meet at the main entrance for renting fixture ${index}.`;
  const returnInstructions = `Return the item to the same handoff point for fixture ${index}.`;
  const checkInReadyAt = [
    "check_in_ready",
    "active",
    "return_due",
    "completed",
    "disputed",
  ].includes(status)
    ? addHours(confirmedAt, 12)
    : undefined;
  const checkInCompletedAt = [
    "active",
    "return_due",
    "completed",
    "disputed",
  ].includes(status)
    ? addHours(confirmedAt, 24)
    : undefined;
  const returnDueAt = ["return_due", "completed", "disputed"].includes(status)
    ? addDays(confirmedAt, 3)
    : undefined;
  const completedAt = ["completed", "disputed"].includes(status)
    ? addHours(returnDueAt ?? addDays(confirmedAt, 3), 6)
    : undefined;
  const dispute =
    status === "disputed"
      ? createRentingDisputeFixture(
          index,
          renterEmail,
          completedAt ?? addDays(confirmedAt, 3),
        )
      : undefined;

  return {
    id: createFixtureId(3400, index),
    status,
    confirmedAt,
    createdAt: confirmedAt,
    pickupInstructions,
    returnInstructions,
    checkInReadyAt,
    checkInCompletedAt,
    returnDueAt,
    completedAt,
    disputedAt: dispute?.createdAt,
    dispute,
  };
}

function createRentingDisputeFixture(
  index: number,
  openedByUserEmail: string,
  createdAt: string,
): SeedRentingDisputeFixture {
  return {
    id: createFixtureId(3410, index),
    openedByUserEmail,
    reason: "Item condition did not match the agreed handoff.",
    details: `Seeded dispute details for renting fixture ${index}.`,
    createdAt,
  };
}

function createBookingFixture(spec: BookingSpec): SeedBookingFixture {
  const pricingCurrency = "CAD";
  const startAt = toRuntimeDate(spec.startAt);
  const endAt = toRuntimeDate(spec.endAt);
  const durationDays = calculateDurationDays(startAt, endAt);
  const estimatedTotal = roundMoney(durationDays * spec.dailyPriceAmount);
  const createdAt = subtractDays(startAt, 7);
  const approvedAt = addHours(createdAt, 6);
  const paymentRequiredAt = subtractDays(startAt, 2);
  const holdExpiresAt = addDays(createdAt, 2);
  const payment = createPaymentFixture(
    spec.index,
    spec.lifecycle,
    pricingCurrency,
    estimatedTotal,
    createdAt,
  );
  const renting = createRentingFixture(
    spec.index,
    spec.lifecycle,
    spec.renterEmail,
    createdAt,
  );

  const booking: SeedBookingFixture = {
    id: createFixtureId(3000, spec.index),
    postingId: createFixtureId(2000, spec.postingIndex),
    renterEmail: spec.renterEmail,
    status:
      spec.lifecycle === "processing"
        ? "payment_processing"
        : spec.lifecycle === "failed_retryable" ||
            spec.lifecycle === "failed_final"
          ? "payment_failed"
          : spec.lifecycle === "paid_confirmed"
            ? "paid"
            : spec.lifecycle,
    startAt,
    endAt,
    guestCount: spec.guestCount,
    contactName: spec.contactName,
    contactEmail: spec.renterEmail,
    contactPhoneNumber: "+14165550999",
    note: spec.note,
    pricingCurrency,
    dailyPriceAmount: spec.dailyPriceAmount,
    estimatedTotal,
    holdExpiresAt,
    createdAt,
    payment,
    renting,
  };

  if (
    [
      "pending",
      "approved",
      "awaiting_payment",
      "processing",
      "failed_retryable",
    ].includes(spec.lifecycle)
  ) {
    booking.holdBlock = {
      id: createFixtureId(3200, spec.index),
      startAt,
      endAt,
      note: `Temporary booking hold for fixture ${spec.index}.`,
      source: "booking_hold",
    };
  }

  if (
    [
      "approved",
      "awaiting_payment",
      "processing",
      "paid",
      "paid_confirmed",
      "failed_retryable",
      "failed_final",
      "refunded",
    ].includes(spec.lifecycle)
  ) {
    booking.approvedAt = approvedAt;
  }

  if (
    [
      "awaiting_payment",
      "processing",
      "paid",
      "paid_confirmed",
      "failed_retryable",
      "failed_final",
      "refunded",
    ].includes(spec.lifecycle)
  ) {
    booking.paymentRequiredAt = paymentRequiredAt;
  }

  if (
    spec.lifecycle === "failed_retryable" ||
    spec.lifecycle === "failed_final"
  ) {
    booking.paymentFailedAt = addHours(createdAt, 5);
    booking.paymentReconciliationRequired = spec.lifecycle === "failed_final";
  }

  if (spec.lifecycle === "declined") {
    booking.declinedAt = addHours(createdAt, 8);
    booking.decisionNote =
      "Owner declined due to conflicting offline commitment.";
  }

  if (spec.lifecycle === "expired") {
    booking.expiredAt = addHours(createdAt, 48);
    booking.decisionNote = "Payment window expired before completion.";
  }

  if (spec.lifecycle === "cancelled") {
    booking.cancelledAt = addHours(createdAt, 18);
    booking.decisionNote = "Cancelled by renter after schedule change.";
  }

  if (spec.lifecycle === "refunded") {
    booking.refundedAt = addHours(createdAt, 30);
    booking.decisionNote = "Refund issued after post-payment cancellation.";
  }

  if (["paid", "paid_confirmed"].includes(spec.lifecycle)) {
    booking.convertedAt = addHours(createdAt, 9);
    booking.conversionReservedAt = addHours(createdAt, 7);
    booking.conversionReservationExpiresAt = addHours(createdAt, 11);
    booking.rentingBlock = {
      id: createFixtureId(3201, spec.index),
      startAt,
      endAt,
      note: `Confirmed renting window for fixture ${spec.index}.`,
      source: "renting",
    };
  }

  return booking;
}

const BOOKING_SPECS: BookingSpec[] = [
  {
    index: 1,
    postingIndex: 1,
    renterEmail: "user1@rentify.local",
    lifecycle: "pending",
    startAt: "2026-05-12T16:00:00.000Z",
    endAt: "2026-05-15T16:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 180,
    contactName: "Jordan Lee",
    note: "Need a quiet space for a photo project.",
  },
  {
    index: 2,
    postingIndex: 8,
    renterEmail: "user2@rentify.local",
    lifecycle: "pending",
    startAt: "2026-05-18T13:00:00.000Z",
    endAt: "2026-05-19T21:00:00.000Z",
    guestCount: 6,
    dailyPriceAmount: 145,
    contactName: "Priya Nair",
    note: "Team planning session with hybrid AV setup.",
  },
  {
    index: 3,
    postingIndex: 20,
    renterEmail: "user3@rentify.local",
    lifecycle: "pending",
    startAt: "2026-05-21T14:00:00.000Z",
    endAt: "2026-05-23T14:00:00.000Z",
    guestCount: 1,
    dailyPriceAmount: 52,
    contactName: "Sam Turner",
    note: "Family biking weekend around Ottawa.",
  },
  {
    index: 4,
    postingIndex: 3,
    renterEmail: "user4@rentify.local",
    lifecycle: "approved",
    startAt: "2026-05-14T19:00:00.000Z",
    endAt: "2026-05-17T19:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 85,
    contactName: "Avery Kim",
    note: "Visiting for a short work trip.",
  },
  {
    index: 5,
    postingIndex: 11,
    renterEmail: "user1@rentify.local",
    lifecycle: "approved",
    startAt: "2026-05-26T13:00:00.000Z",
    endAt: "2026-05-27T22:00:00.000Z",
    guestCount: 4,
    dailyPriceAmount: 120,
    contactName: "Jordan Lee",
    note: "Need a workshop for prototype review.",
  },
  {
    index: 6,
    postingIndex: 21,
    renterEmail: "user2@rentify.local",
    lifecycle: "approved",
    startAt: "2026-05-30T15:00:00.000Z",
    endAt: "2026-06-01T15:00:00.000Z",
    guestCount: 5,
    dailyPriceAmount: 210,
    contactName: "Priya Nair",
    note: "Two-day brand shoot with client walkthroughs.",
  },
  {
    index: 7,
    postingIndex: 4,
    renterEmail: "user3@rentify.local",
    lifecycle: "paid_confirmed",
    startAt: "2026-06-04T14:00:00.000Z",
    endAt: "2026-06-07T14:00:00.000Z",
    guestCount: 1,
    dailyPriceAmount: 55,
    contactName: "Sam Turner",
    note: "Weekend renovation project.",
  },
  {
    index: 8,
    postingIndex: 13,
    renterEmail: "user4@rentify.local",
    lifecycle: "paid_confirmed",
    startAt: "2026-05-28T12:00:00.000Z",
    endAt: "2026-05-30T12:00:00.000Z",
    guestCount: 3,
    dailyPriceAmount: 78,
    contactName: "Avery Kim",
    note: "Family visit and errands.",
  },
  {
    index: 9,
    postingIndex: 29,
    renterEmail: "user1@rentify.local",
    lifecycle: "paid_confirmed",
    startAt: "2026-05-22T16:00:00.000Z",
    endAt: "2026-05-25T16:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 172,
    contactName: "Jordan Lee",
    note: "Small editorial content shoot.",
  },
  {
    index: 10,
    postingIndex: 6,
    renterEmail: "user2@rentify.local",
    lifecycle: "paid_confirmed",
    startAt: "2026-05-18T14:00:00.000Z",
    endAt: "2026-05-22T14:00:00.000Z",
    guestCount: 1,
    dailyPriceAmount: 58,
    contactName: "Priya Nair",
    note: "Testing a weekend trail ride.",
  },
  {
    index: 11,
    postingIndex: 15,
    renterEmail: "user3@rentify.local",
    lifecycle: "paid_confirmed",
    startAt: "2026-05-12T12:00:00.000Z",
    endAt: "2026-05-15T12:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 95,
    contactName: "Sam Turner",
    note: "Portable setup for a neighborhood event.",
  },
  {
    index: 12,
    postingIndex: 1,
    renterEmail: "user1@rentify.local",
    lifecycle: "paid",
    startAt: "2026-06-26T16:00:00.000Z",
    endAt: "2026-06-29T16:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 180,
    contactName: "Jordan Lee",
    note: "Booked and paid for a weekend shoot.",
  },
  {
    index: 13,
    postingIndex: 18,
    renterEmail: "user4@rentify.local",
    lifecycle: "paid",
    startAt: "2026-06-27T12:00:00.000Z",
    endAt: "2026-06-29T12:00:00.000Z",
    guestCount: 1,
    dailyPriceAmount: 72,
    contactName: "Avery Kim",
    note: "Field interview package secured.",
  },
  {
    index: 14,
    postingIndex: 11,
    renterEmail: "user2@rentify.local",
    lifecycle: "paid_confirmed",
    startAt: "2026-05-17T13:00:00.000Z",
    endAt: "2026-05-20T22:00:00.000Z",
    guestCount: 5,
    dailyPriceAmount: 120,
    contactName: "Priya Nair",
    note: "Confirmed team workshop rental.",
  },
  {
    index: 15,
    postingIndex: 16,
    renterEmail: "user3@rentify.local",
    lifecycle: "paid_confirmed",
    startAt: "2026-07-05T15:00:00.000Z",
    endAt: "2026-07-08T15:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 165,
    contactName: "Sam Turner",
    note: "Confirmed stay for canal-side visit.",
  },
  {
    index: 16,
    postingIndex: 21,
    renterEmail: "user4@rentify.local",
    lifecycle: "paid_confirmed",
    startAt: "2026-07-08T16:00:00.000Z",
    endAt: "2026-07-10T16:00:00.000Z",
    guestCount: 4,
    dailyPriceAmount: 210,
    contactName: "Avery Kim",
    note: "Confirmed production booking with client.",
  },
  {
    index: 17,
    postingIndex: 23,
    renterEmail: "user1@rentify.local",
    lifecycle: "failed_final",
    startAt: "2026-07-12T15:00:00.000Z",
    endAt: "2026-07-14T15:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 96,
    contactName: "Jordan Lee",
    note: "Payment timed out during EV reservation.",
  },
  {
    index: 18,
    postingIndex: 27,
    renterEmail: "user2@rentify.local",
    lifecycle: "failed_final",
    startAt: "2026-07-16T13:00:00.000Z",
    endAt: "2026-07-18T13:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 54,
    contactName: "Priya Nair",
    note: "Card declined for bike rental.",
  },
  {
    index: 19,
    postingIndex: 30,
    renterEmail: "user3@rentify.local",
    lifecycle: "failed_final",
    startAt: "2026-07-19T12:00:00.000Z",
    endAt: "2026-07-21T12:00:00.000Z",
    guestCount: 3,
    dailyPriceAmount: 84,
    contactName: "Sam Turner",
    note: "Audio booking failed after issuer decline.",
  },
  {
    index: 20,
    postingIndex: 20,
    renterEmail: "user4@rentify.local",
    lifecycle: "declined",
    startAt: "2026-07-23T14:00:00.000Z",
    endAt: "2026-07-25T14:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 52,
    contactName: "Avery Kim",
    note: "Owner declined due to overlap with maintenance.",
  },
  {
    index: 21,
    postingIndex: 25,
    renterEmail: "user1@rentify.local",
    lifecycle: "declined",
    startAt: "2026-07-24T15:00:00.000Z",
    endAt: "2026-07-26T15:00:00.000Z",
    guestCount: 1,
    dailyPriceAmount: 88,
    contactName: "Jordan Lee",
    note: "Tool booking declined after owner review.",
  },
  {
    index: 22,
    postingIndex: 9,
    renterEmail: "user2@rentify.local",
    lifecycle: "expired",
    startAt: "2026-07-28T13:00:00.000Z",
    endAt: "2026-07-31T13:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 82,
    contactName: "Priya Nair",
    note: "Payment link expired before completion.",
  },
  {
    index: 23,
    postingIndex: 28,
    renterEmail: "user3@rentify.local",
    lifecycle: "expired",
    startAt: "2026-08-01T14:00:00.000Z",
    endAt: "2026-08-04T14:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 46,
    contactName: "Sam Turner",
    note: "Storage request expired without payment.",
  },
  {
    index: 24,
    postingIndex: 3,
    renterEmail: "user4@rentify.local",
    lifecycle: "cancelled",
    startAt: "2026-08-05T16:00:00.000Z",
    endAt: "2026-08-07T16:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 85,
    contactName: "Avery Kim",
    note: "Renter cancelled after travel plans changed.",
  },
  {
    index: 25,
    postingIndex: 13,
    renterEmail: "user1@rentify.local",
    lifecycle: "cancelled",
    startAt: "2026-08-08T12:00:00.000Z",
    endAt: "2026-08-11T12:00:00.000Z",
    guestCount: 3,
    dailyPriceAmount: 78,
    contactName: "Jordan Lee",
    note: "Cancelled before capture after itinerary shift.",
  },
  {
    index: 26,
    postingIndex: 29,
    renterEmail: "user2@rentify.local",
    lifecycle: "refunded",
    startAt: "2026-08-12T16:00:00.000Z",
    endAt: "2026-08-15T16:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 172,
    contactName: "Priya Nair",
    note: "Charged, then refunded after owner issue.",
  },
  {
    index: 27,
    postingIndex: 23,
    renterEmail: "user3@rentify.local",
    lifecycle: "refunded",
    startAt: "2026-08-18T15:00:00.000Z",
    endAt: "2026-08-20T15:00:00.000Z",
    guestCount: 2,
    dailyPriceAmount: 96,
    contactName: "Sam Turner",
    note: "Refunded due to charging access problem.",
  },
];

export const SEED_BOOKINGS: SeedBookingFixture[] =
  BOOKING_SPECS.map(createBookingFixture);
