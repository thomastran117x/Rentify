import { Prisma } from "@prisma/client";
import { PaymentsRepository } from "@/features/payments/payments.repository";

const FUTURE_HOLD_EXPIRES_AT = new Date("2099-04-21T00:00:00.000Z");

function createBookingPersistence(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    ownerId: "owner-1",
    status: "awaiting_payment",
    startAt: new Date("2026-05-01T00:00:00.000Z"),
    endAt: new Date("2026-05-04T00:00:00.000Z"),
    durationDays: 3,
    guestCount: 2,
    pricingCurrency: "CAD",
    pricingSnapshot: {
      currency: "CAD",
      daily: {
        amount: 120,
      },
    },
    dailyPriceAmount: new Prisma.Decimal(120),
    estimatedTotal: new Prisma.Decimal(400),
    holdExpiresAt: FUTURE_HOLD_EXPIRES_AT,
    paymentReconciliationRequired: false,
    convertedAt: null,
    holdBlockId: null,
    conversionReservedAt: null,
    conversionReservationExpiresAt: null,
    renting: null,
    payment: null,
    ...overrides,
  };
}

function createPaymentPersistence(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "payment-1",
    bookingRequestId: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    ownerId: "owner-1",
    provider: "square",
    status: "awaiting_method",
    pricingCurrency: "CAD",
    rentalSubtotalAmount: new Prisma.Decimal(100),
    platformFeeAmount: new Prisma.Decimal(10),
    totalAmount: new Prisma.Decimal(110),
    squarePaymentId: null,
    squareOrderId: null,
    squareLocationId: null,
    checkoutUrl: null,
    lastAttemptedAt: null,
    succeededAt: null,
    failedAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    updatedAt: new Date("2026-04-20T00:00:00.000Z"),
    bookingRequest: {
      id: "booking-1",
      status: "awaiting_payment",
      startAt: new Date("2026-05-01T00:00:00.000Z"),
      endAt: new Date("2026-05-04T00:00:00.000Z"),
      holdExpiresAt: FUTURE_HOLD_EXPIRES_AT,
      paymentReconciliationRequired: false,
      holdBlockId: null,
    },
    attempts: [],
    refunds: [],
    payout: null,
    ...overrides,
  };
}

describe("PaymentsRepository", () => {
  it("creates a deposit-sized payment attempt instead of charging the full estimated total", async () => {
    const createdPayments: Array<Record<string, unknown>> = [];
    const createdLedgerEntries: Array<Record<string, unknown>> = [];
    const booking = createBookingPersistence();
    const payment = createPaymentPersistence();
    const attempt = {
      id: "attempt-1",
    };

    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => booking),
      },
      payment: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          createdPayments.push(data);
          return payment;
        }),
        findUniqueOrThrow: jest.fn(async () => payment),
      },
      paymentAttempt: {
        create: jest.fn(async () => attempt),
      },
      paymentLedgerEntry: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          createdLedgerEntries.push(data);
        }),
      },
    };

    const database = {
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };

    const repository = new PaymentsRepository(database as never);
    const result = await repository.createPaymentAttemptForBooking({
      bookingRequestId: "booking-1",
      renterId: "renter-1",
      idempotencyKey: "idem-1",
    });

    expect(createdPayments).toHaveLength(1);
    expect((createdPayments[0]?.rentalSubtotalAmount as Prisma.Decimal).toNumber()).toBe(100);
    expect((createdPayments[0]?.platformFeeAmount as Prisma.Decimal).toNumber()).toBe(10);
    expect((createdPayments[0]?.totalAmount as Prisma.Decimal).toNumber()).toBe(110);
    expect(createdLedgerEntries).toHaveLength(1);
    expect(result.amount).toBe(110);
  });

  it("marks a successful payment as a paid reservation without auto-creating a renting", async () => {
    const blockCreates: Array<Record<string, unknown>> = [];
    const bookingUpdates: Array<Record<string, unknown>> = [];
    const rentingCreate = jest.fn();

    const payment = createPaymentPersistence({
      status: "processing",
      attempts: [
        {
          id: "attempt-1",
          status: "processing",
        },
      ],
      payout: null,
    });
    const booking = createBookingPersistence({
      status: "payment_processing",
      holdBlockId: null,
      renting: null,
    });
    const refreshedPayment = createPaymentPersistence({
      status: "succeeded",
      succeededAt: new Date("2026-04-20T01:00:00.000Z"),
      bookingRequest: {
        ...payment.bookingRequest,
        status: "paid",
        holdBlockId: "block-1",
      },
    });

    const transaction = {
      payment: {
        findFirst: jest.fn(async () => payment),
        update: jest.fn(async () => undefined),
        findUniqueOrThrow: jest.fn(async () => refreshedPayment),
      },
      paymentAttempt: {
        update: jest.fn(async () => undefined),
      },
      bookingRequest: {
        findUniqueOrThrow: jest.fn(async () => booking),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          bookingUpdates.push(data);
        }),
      },
      postingAvailabilityBlock: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          blockCreates.push(data);
          return {
            id: "block-1",
          };
        }),
      },
      renting: {
        create: rentingCreate,
        findFirst: jest.fn(async () => null),
      },
      paymentLedgerEntry: {
        create: jest.fn(async () => undefined),
      },
      payout: {
        create: jest.fn(async () => undefined),
      },
    };

    const database = {
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };

    const repository = new PaymentsRepository(database as never);
    const result = await repository.markPaymentSucceeded({
      providerPaymentId: "square-pay-1",
      providerOrderId: "square-order-1",
      status: "COMPLETED",
      raw: {
        ok: true,
      },
    });

    expect(result.payment?.booking.status).toBe("paid");
    expect(result.reconciliationRequired).toBe(false);
    expect(blockCreates).toHaveLength(1);
    expect(bookingUpdates[0]).toMatchObject({
      status: "paid",
      holdBlockId: "block-1",
    });
    expect(rentingCreate).not.toHaveBeenCalled();
  });

  it("flags reconciliation when payment success finds a conflicting hold or renting", async () => {
    const bookingUpdates: Array<Record<string, unknown>> = [];
    const payment = createPaymentPersistence({
      status: "processing",
      attempts: [
        {
          id: "attempt-1",
          status: "processing",
        },
      ],
    });
    const booking = createBookingPersistence({
      status: "payment_processing",
      holdBlockId: null,
      renting: null,
    });
    const refreshedPayment = createPaymentPersistence({
      status: "succeeded",
      bookingRequest: {
        ...payment.bookingRequest,
        status: "payment_processing",
        paymentReconciliationRequired: true,
      },
    });

    const transaction = {
      payment: {
        findFirst: jest.fn(async () => payment),
        update: jest.fn(async () => undefined),
        findUniqueOrThrow: jest.fn(async () => refreshedPayment),
      },
      paymentAttempt: {
        update: jest.fn(async () => undefined),
      },
      bookingRequest: {
        findUniqueOrThrow: jest.fn(async () => booking),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          bookingUpdates.push(data);
        }),
      },
      postingAvailabilityBlock: {
        findFirst: jest.fn(async () => ({
          id: "conflict-block",
        })),
      },
      renting: {
        findFirst: jest.fn(async () => null),
      },
      paymentLedgerEntry: {
        create: jest.fn(async () => undefined),
      },
      payout: {
        create: jest.fn(async () => undefined),
      },
    };

    const database = {
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };

    const repository = new PaymentsRepository(database as never);
    const result = await repository.markPaymentSucceeded({
      providerPaymentId: "square-pay-1",
      providerOrderId: "square-order-1",
      status: "COMPLETED",
      raw: {
        ok: true,
      },
    });

    expect(result.reconciliationRequired).toBe(true);
    expect(bookingUpdates[0]).toMatchObject({
      paymentReconciliationRequired: true,
    });
    expect(result.payment?.booking.paymentReconciliationRequired).toBe(true);
  });

  it("treats duplicate payment success after conversion as idempotent", async () => {
    const bookingUpdate = jest.fn();
    const blockCreate = jest.fn();
    const ledgerCreate = jest.fn();
    const payoutCreate = jest.fn();
    const payment = createPaymentPersistence({
      status: "succeeded",
      succeededAt: new Date("2026-04-20T01:00:00.000Z"),
      payout: {
        id: "payout-1",
        paymentId: "payment-1",
        ownerId: "owner-1",
        status: "scheduled",
        amount: new Prisma.Decimal(100),
        dueAt: new Date("2026-05-01T00:00:00.000Z"),
        releasedAt: null,
        failedAt: null,
        squarePayoutId: null,
        failureMessage: null,
        createdAt: new Date("2026-04-20T01:00:00.000Z"),
        updatedAt: new Date("2026-04-20T01:00:00.000Z"),
      },
    });
    const booking = createBookingPersistence({
      status: "paid",
      convertedAt: new Date("2026-04-21T00:00:00.000Z"),
      renting: {
        id: "renting-1",
      },
      holdBlockId: null,
    });

    const transaction = {
      payment: {
        findFirst: jest.fn(async () => payment),
        update: jest.fn(async () => undefined),
        findUniqueOrThrow: jest.fn(async () => payment),
      },
      paymentAttempt: {
        update: jest.fn(async () => undefined),
      },
      bookingRequest: {
        findUniqueOrThrow: jest.fn(async () => booking),
        update: bookingUpdate,
      },
      postingAvailabilityBlock: {
        create: blockCreate,
      },
      paymentLedgerEntry: {
        create: ledgerCreate,
      },
      payout: {
        create: payoutCreate,
      },
    };

    const database = {
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };

    const repository = new PaymentsRepository(database as never);
    const result = await repository.markPaymentSucceeded({
      providerPaymentId: "square-pay-1",
      providerOrderId: "square-order-1",
      status: "COMPLETED",
      raw: {
        ok: true,
      },
    });

    expect(result.reconciliationRequired).toBe(false);
    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(blockCreate).not.toHaveBeenCalled();
    expect(ledgerCreate).not.toHaveBeenCalled();
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it("removes the reservation block when a paid booking is fully refunded", async () => {
    const bookingUpdates: Array<Record<string, unknown>> = [];
    const deletedBlocks: string[] = [];
    const refund = {
      id: "refund-1",
      paymentId: "payment-1",
      amount: new Prisma.Decimal(110),
      status: "pending",
      reason: null,
      idempotencyKey: "refund-idem-1",
      squareRefundId: null,
      createdAt: new Date("2026-04-20T00:00:00.000Z"),
      updatedAt: new Date("2026-04-20T00:00:00.000Z"),
      completedAt: new Date("2026-04-20T00:10:00.000Z"),
    };
    const payment = createPaymentPersistence({
      status: "succeeded",
      bookingRequest: {
        ...createPaymentPersistence().bookingRequest,
        status: "paid",
        holdBlockId: "block-1",
      },
      refunds: [
        {
          id: "refund-1",
          status: "succeeded",
          amount: new Prisma.Decimal(110),
          reason: null,
          idempotencyKey: "refund-idem-1",
          squareRefundId: "square-refund-1",
          createdAt: new Date("2026-04-20T00:00:00.000Z"),
          updatedAt: new Date("2026-04-20T00:10:00.000Z"),
          completedAt: new Date("2026-04-20T00:10:00.000Z"),
        },
      ],
    });

    const transaction = {
      refund: {
        findUniqueOrThrow: jest.fn(async () => refund),
        update: jest.fn(async () => undefined),
        findMany: jest.fn(async () => [
          {
            id: "refund-1",
            status: "succeeded",
            amount: new Prisma.Decimal(110),
            reason: null,
            idempotencyKey: "refund-idem-1",
            squareRefundId: "square-refund-1",
            createdAt: new Date("2026-04-20T00:00:00.000Z"),
            updatedAt: new Date("2026-04-20T00:10:00.000Z"),
            completedAt: new Date("2026-04-20T00:10:00.000Z"),
          },
        ]),
      },
      payment: {
        findUniqueOrThrow: jest.fn(async () => payment),
        update: jest.fn(async () => undefined),
      },
      bookingRequest: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          bookingUpdates.push(data);
        }),
      },
      postingAvailabilityBlock: {
        deleteMany: jest.fn(async ({ where }: { where: { id: string } }) => {
          deletedBlocks.push(where.id);
        }),
      },
      paymentLedgerEntry: {
        create: jest.fn(async () => undefined),
      },
    };

    const database = {
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };

    const repository = new PaymentsRepository(database as never);
    await repository.completeRefund("refund-1", {
      providerRefundId: "square-refund-1",
      status: "COMPLETED",
      raw: {
        ok: true,
      },
    });

    expect(bookingUpdates[0]).toMatchObject({
      status: "refunded",
      holdBlockId: null,
    });
    expect(deletedBlocks).toEqual(["block-1"]);
  });

  it("preserves an explicitly cancelled booking when refund completion succeeds", async () => {
    const bookingUpdates: Array<Record<string, unknown>> = [];
    const refund = {
      id: "refund-1",
      paymentId: "payment-1",
      amount: new Prisma.Decimal(110),
      status: "pending",
      reason: null,
      idempotencyKey: "refund-idem-1",
      squareRefundId: null,
      createdAt: new Date("2026-04-20T00:00:00.000Z"),
      updatedAt: new Date("2026-04-20T00:00:00.000Z"),
      completedAt: new Date("2026-04-20T00:10:00.000Z"),
    };
    const payment = createPaymentPersistence({
      status: "succeeded",
      bookingRequest: {
        ...createPaymentPersistence().bookingRequest,
        status: "cancelled",
        holdBlockId: null,
      },
      refunds: [
        {
          id: "refund-1",
          status: "succeeded",
          amount: new Prisma.Decimal(110),
          reason: null,
          idempotencyKey: "refund-idem-1",
          squareRefundId: "square-refund-1",
          createdAt: new Date("2026-04-20T00:00:00.000Z"),
          updatedAt: new Date("2026-04-20T00:10:00.000Z"),
          completedAt: new Date("2026-04-20T00:10:00.000Z"),
        },
      ],
    });

    const transaction = {
      refund: {
        findUniqueOrThrow: jest.fn(async () => refund),
        update: jest.fn(async () => undefined),
        findMany: jest.fn(async () => [
          {
            id: "refund-1",
            status: "succeeded",
            amount: new Prisma.Decimal(110),
            reason: null,
            idempotencyKey: "refund-idem-1",
            squareRefundId: "square-refund-1",
            createdAt: new Date("2026-04-20T00:00:00.000Z"),
            updatedAt: new Date("2026-04-20T00:10:00.000Z"),
            completedAt: new Date("2026-04-20T00:10:00.000Z"),
          },
        ]),
      },
      payment: {
        findUniqueOrThrow: jest.fn(async () => payment),
        update: jest.fn(async () => undefined),
      },
      bookingRequest: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          bookingUpdates.push(data);
        }),
      },
      postingAvailabilityBlock: {
        deleteMany: jest.fn(async () => undefined),
      },
      paymentLedgerEntry: {
        create: jest.fn(async () => undefined),
      },
    };

    const database = {
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };

    const repository = new PaymentsRepository(database as never);
    await repository.completeRefund("refund-1", {
      providerRefundId: "square-refund-1",
      status: "COMPLETED",
      raw: {
        ok: true,
      },
    });

    expect(bookingUpdates[0]).toMatchObject({
      refundedAt: expect.any(Date),
      holdBlockId: null,
    });
    expect(bookingUpdates[0]).not.toHaveProperty("status");
  });

  it("can preserve the current booking status while recording a successful refund", async () => {
    const bookingUpdates: Array<Record<string, unknown>> = [];
    const deletedBlocks: string[] = [];
    const refund = {
      id: "refund-1",
      paymentId: "payment-1",
      amount: new Prisma.Decimal(110),
      status: "pending",
      reason: null,
      idempotencyKey: "refund-idem-1",
      squareRefundId: null,
      createdAt: new Date("2026-04-20T00:00:00.000Z"),
      updatedAt: new Date("2026-04-20T00:00:00.000Z"),
      completedAt: new Date("2026-04-20T00:10:00.000Z"),
    };
    const payment = createPaymentPersistence({
      status: "succeeded",
      bookingRequest: {
        ...createPaymentPersistence().bookingRequest,
        status: "paid",
        holdBlockId: "block-1",
      },
      refunds: [
        {
          id: "refund-1",
          status: "succeeded",
          amount: new Prisma.Decimal(110),
          reason: null,
          idempotencyKey: "refund-idem-1",
          squareRefundId: "square-refund-1",
          createdAt: new Date("2026-04-20T00:00:00.000Z"),
          updatedAt: new Date("2026-04-20T00:10:00.000Z"),
          completedAt: new Date("2026-04-20T00:10:00.000Z"),
        },
      ],
    });

    const transaction = {
      refund: {
        findUniqueOrThrow: jest.fn(async () => refund),
        update: jest.fn(async () => undefined),
        findMany: jest.fn(async () => [
          {
            id: "refund-1",
            status: "succeeded",
            amount: new Prisma.Decimal(110),
            reason: null,
            idempotencyKey: "refund-idem-1",
            squareRefundId: "square-refund-1",
            createdAt: new Date("2026-04-20T00:00:00.000Z"),
            updatedAt: new Date("2026-04-20T00:10:00.000Z"),
            completedAt: new Date("2026-04-20T00:10:00.000Z"),
          },
        ]),
      },
      payment: {
        findUniqueOrThrow: jest.fn(async () => payment),
        update: jest.fn(async () => undefined),
      },
      bookingRequest: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          bookingUpdates.push(data);
        }),
      },
      postingAvailabilityBlock: {
        deleteMany: jest.fn(async ({ where }: { where: { id: string } }) => {
          deletedBlocks.push(where.id);
        }),
      },
      paymentLedgerEntry: {
        create: jest.fn(async () => undefined),
      },
    };

    const database = {
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };

    const repository = new PaymentsRepository(database as never);
    await repository.completeRefund(
      "refund-1",
      {
        providerRefundId: "square-refund-1",
        status: "COMPLETED",
        raw: {
          ok: true,
        },
      },
      {
        preserveBookingStatus: true,
      },
    );

    expect(bookingUpdates[0]).toMatchObject({
      refundedAt: expect.any(Date),
    });
    expect(bookingUpdates[0]).not.toHaveProperty("status");
    expect(bookingUpdates[0]).not.toHaveProperty("holdBlockId");
    expect(deletedBlocks).toEqual([]);
  });
});
