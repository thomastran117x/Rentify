import { Prisma } from "@prisma/client";
import { PaymentsRepository } from "@/features/payments/payments.repository";

const FUTURE_HOLD_EXPIRES_AT = new Date("2099-04-21T00:00:00.000Z");

function createBookingPersistence(
  overrides?: Partial<Record<string, unknown>>,
) {
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

function createPaymentPersistence(
  overrides?: Partial<Record<string, unknown>>,
) {
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

function createPayoutPersistence(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "payout-1",
    paymentId: "payment-1",
    organizationId: "org-1",
    status: "scheduled",
    amount: new Prisma.Decimal(75),
    dueAt: new Date("2026-04-21T00:00:00.000Z"),
    releasedAt: null,
    failedAt: null,
    squarePayoutId: null,
    failureMessage: null,
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    updatedAt: new Date("2026-04-20T00:00:00.000Z"),
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
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };

    const repository = new PaymentsRepository(database as never);
    const result = await repository.createPaymentAttemptForBooking({
      bookingRequestId: "booking-1",
      renterId: "renter-1",
      idempotencyKey: "idem-1",
    });

    expect(createdPayments).toHaveLength(1);
    expect(
      (createdPayments[0]?.rentalSubtotalAmount as Prisma.Decimal).toNumber(),
    ).toBe(100);
    expect(
      (createdPayments[0]?.platformFeeAmount as Prisma.Decimal).toNumber(),
    ).toBe(10);
    expect((createdPayments[0]?.totalAmount as Prisma.Decimal).toNumber()).toBe(
      110,
    );
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
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
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
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
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
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
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
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
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
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
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
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
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

  it("attaches a checkout session and promotes the booking into payment processing", async () => {
    const bookingRequestUpdate = jest.fn(async () => undefined);
    const paymentRow = createPaymentPersistence({
      status: "processing",
      checkoutUrl: "https://square.test/checkout",
      squarePaymentId: "square-pay-1",
      squareOrderId: "square-order-1",
      squareLocationId: "location-1",
      lastAttemptedAt: new Date("2026-04-20T00:05:00.000Z"),
      attempts: [
        {
          id: "attempt-1",
          paymentId: "payment-1",
          idempotencyKey: "idem-1",
          status: "processing",
          retryCount: 0,
          failureCategory: null,
          failureCode: null,
          failureMessage: null,
          providerRequestId: "provider-request-1",
          squarePaymentId: "square-pay-1",
          nextRetryAt: null,
          createdAt: new Date("2026-04-20T00:00:00.000Z"),
          updatedAt: new Date("2026-04-20T00:05:00.000Z"),
          responsePayload: {},
        },
      ],
    });

    const transaction = {
      paymentAttempt: {
        update: jest.fn(async () => undefined),
      },
      payment: {
        update: jest.fn(async () => undefined),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({
            bookingRequestId: "booking-1",
          })
          .mockResolvedValueOnce(paymentRow),
      },
      bookingRequest: {
        update: bookingRequestUpdate,
      },
    };

    const repository = new PaymentsRepository({
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    } as never);

    const result = await repository.attachPaymentSession(
      "payment-1",
      "attempt-1",
      {
        providerRequestId: "provider-request-1",
        providerPaymentId: "square-pay-1",
        providerOrderId: "square-order-1",
        checkoutUrl: "https://square.test/checkout",
        locationId: "location-1",
        raw: {
          ok: true,
        },
      },
    );

    expect(bookingRequestUpdate).toHaveBeenCalledWith({
      where: {
        id: "booking-1",
      },
      data: {
        status: "payment_processing",
      },
    });
    expect(result).toMatchObject({
      status: "processing",
      checkoutUrl: "https://square.test/checkout",
      squarePaymentId: "square-pay-1",
      squareOrderId: "square-order-1",
    });
  });

  it("records a retryable attempt failure with the next retry scheduled", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-20T00:00:00.000Z"));
    const paymentRow = createPaymentPersistence({
      status: "failed_retryable",
      failedAt: new Date("2026-04-20T00:00:00.000Z"),
      attempts: [
        {
          id: "attempt-1",
          paymentId: "payment-1",
          idempotencyKey: "idem-1",
          status: "failed_retryable",
          retryCount: 1,
          failureCategory: "transient",
          failureCode: "TEMP_DOWN",
          failureMessage: "temporary outage",
          providerRequestId: null,
          squarePaymentId: null,
          nextRetryAt: new Date("2026-04-20T00:00:04.000Z"),
          createdAt: new Date("2026-04-20T00:00:00.000Z"),
          updatedAt: new Date("2026-04-20T00:00:01.000Z"),
        },
      ],
      bookingRequest: {
        ...createPaymentPersistence().bookingRequest,
        status: "payment_failed",
        paymentFailedAt: new Date("2026-04-20T00:00:00.000Z"),
      },
    });
    const attemptUpdates: Array<Record<string, unknown>> = [];

    const transaction = {
      paymentAttempt: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: "attempt-1",
          retryCount: 1,
        })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          attemptUpdates.push(data);
        }),
      },
      payment: {
        findUniqueOrThrow: jest.fn(async () => ({
          bookingRequestId: "booking-1",
        })),
        update: jest.fn(async () => undefined),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({
            bookingRequestId: "booking-1",
          })
          .mockResolvedValueOnce(paymentRow),
      },
      bookingRequest: {
        update: jest.fn(async () => undefined),
      },
    };

    const repository = new PaymentsRepository({
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    } as never);

    const result = await repository.recordAttemptFailure(
      "payment-1",
      "attempt-1",
      {
        category: "transient",
        code: "TEMP_DOWN",
        message: "temporary outage",
        retryable: true,
      },
    );

    expect(attemptUpdates[0]).toMatchObject({
      status: "failed_retryable",
      failureCategory: "transient",
      failureCode: "TEMP_DOWN",
      failureMessage: "temporary outage",
      nextRetryAt: expect.any(Date),
    });
    expect(result.status).toBe("failed_retryable");
    jest.useRealTimers();
  });

  it("forbids access to a payment owned by another renter", async () => {
    const repository = new PaymentsRepository({
      payment: {
        findUnique: jest.fn(async () =>
          createPaymentPersistence({
            renterId: "another-user",
          }),
        ),
      },
    } as never);

    await expect(
      repository.findAccessibleById("payment-1", "renter-1"),
    ).rejects.toThrow("You do not have access to this payment.");
  });

  it("returns an existing refund when the same idempotency key is reused", async () => {
    const repository = new PaymentsRepository({
      $transaction: async <T>(
        callback: (client: {
          payment: { findUnique: jest.Mock };
        }) => Promise<T>,
      ) =>
        callback({
          payment: {
            findUnique: jest.fn(async () => ({
              id: "payment-1",
              squarePaymentId: "square-pay-1",
              pricingCurrency: "CAD",
              totalAmount: new Prisma.Decimal(110),
              refunds: [
                {
                  id: "refund-1",
                  status: "pending",
                  amount: new Prisma.Decimal(10),
                  idempotencyKey: "refund-idem-1",
                },
              ],
            })),
          },
        } as never),
    } as never);

    const result = await repository.createRefundRecord({
      paymentId: "payment-1",
      actorUserId: "renter-1",
      amount: 10,
      idempotencyKey: "refund-idem-1",
    });

    expect(result).toEqual({
      refundId: "refund-1",
      paymentId: "payment-1",
      providerPaymentId: "square-pay-1",
      pricingCurrency: "CAD",
    });
  });

  it("rejects refund amounts above the remaining refundable total", async () => {
    const repository = new PaymentsRepository({
      $transaction: async <T>(
        callback: (client: {
          payment: { findUnique: jest.Mock };
        }) => Promise<T>,
      ) =>
        callback({
          payment: {
            findUnique: jest.fn(async () => ({
              id: "payment-1",
              squarePaymentId: "square-pay-1",
              pricingCurrency: "CAD",
              totalAmount: new Prisma.Decimal(110),
              refunds: [
                {
                  id: "refund-1",
                  status: "succeeded",
                  amount: new Prisma.Decimal(100),
                  idempotencyKey: "prior-refund",
                },
              ],
            })),
          },
        } as never),
    } as never);

    await expect(
      repository.createRefundRecord({
        paymentId: "payment-1",
        actorUserId: "renter-1",
        amount: 20,
      }),
    ).rejects.toThrow(
      "Refund amount cannot exceed the remaining refundable total.",
    );
  });

  it("marks provider failures as retryable payments when the category is transient", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-20T00:00:00.000Z"));
    const updatedAttempts: Array<Record<string, unknown>> = [];
    const paymentRow = createPaymentPersistence({
      status: "failed_retryable",
      failedAt: new Date("2026-04-20T00:00:00.000Z"),
      attempts: [
        {
          id: "attempt-1",
          paymentId: "payment-1",
          idempotencyKey: "idem-1",
          status: "failed_retryable",
          retryCount: 1,
          failureCategory: "transient",
          failureCode: "TEMP_DOWN",
          failureMessage: "temporary outage",
          providerRequestId: null,
          squarePaymentId: null,
          nextRetryAt: new Date("2026-04-20T00:00:04.000Z"),
          createdAt: new Date("2026-04-20T00:00:00.000Z"),
          updatedAt: new Date("2026-04-20T00:00:01.000Z"),
        },
      ],
      bookingRequest: {
        ...createPaymentPersistence().bookingRequest,
        status: "payment_failed",
        paymentFailedAt: new Date("2026-04-20T00:00:00.000Z"),
      },
    });
    const transaction = {
      payment: {
        findFirst: jest.fn(async () => ({
          ...paymentRow,
          attempts: [
            {
              id: "attempt-1",
              retryCount: 1,
            },
          ],
        })),
        update: jest.fn(async () => undefined),
        findUniqueOrThrow: jest.fn(async () => paymentRow),
      },
      paymentAttempt: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updatedAttempts.push(data);
        }),
      },
      bookingRequest: {
        update: jest.fn(async () => undefined),
      },
    };
    const repository = new PaymentsRepository({
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    } as never);

    const result = await repository.markPaymentFailed(
      {
        providerPaymentId: "square-pay-1",
        providerOrderId: "square-order-1",
        status: "FAILED",
        raw: {
          ok: false,
        },
        failureCode: "TEMP_DOWN",
        failureMessage: "temporary outage",
      },
      "transient",
    );

    expect(updatedAttempts[0]).toMatchObject({
      status: "failed_retryable",
      failureCategory: "transient",
      failureCode: "TEMP_DOWN",
      failureMessage: "temporary outage",
      nextRetryAt: expect.any(Date),
    });
    expect(result?.status).toBe("failed_retryable");
    jest.useRealTimers();
  });

  it("lists retry candidates ordered for processing", async () => {
    const repository = new PaymentsRepository({
      paymentAttempt: {
        findMany: jest.fn(async () => [
          {
            id: "attempt-1",
            paymentId: "payment-1",
            idempotencyKey: "idem-1",
            retryCount: 2,
          },
        ]),
      },
    } as never);

    const result = await repository.listRetryCandidates(5);

    expect(result).toEqual([
      {
        attemptId: "attempt-1",
        paymentId: "payment-1",
        idempotencyKey: "idem-1",
        retryCount: 2,
      },
    ]);
  });

  it("promotes a retry candidate back into processing", async () => {
    const paymentUpdates: Array<Record<string, unknown>> = [];
    const transaction = {
      paymentAttempt: {
        findUnique: jest.fn(async () => ({
          id: "attempt-1",
          paymentId: "payment-1",
          idempotencyKey: "idem-1",
          status: "failed_retryable",
        })),
        update: jest.fn(async () => undefined),
      },
      payment: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: "payment-1",
          bookingRequestId: "booking-1",
          totalAmount: new Prisma.Decimal(110),
          pricingCurrency: "CAD",
        })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          paymentUpdates.push(data);
        }),
      },
      bookingRequest: {
        update: jest.fn(async () => undefined),
      },
    };
    const repository = new PaymentsRepository({
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    } as never);

    const result = await repository.markAttemptForRetry("attempt-1");

    expect(paymentUpdates[0]).toMatchObject({
      status: "processing",
      lastAttemptedAt: expect.any(Date),
    });
    expect(result).toEqual({
      paymentId: "payment-1",
      bookingRequestId: "booking-1",
      idempotencyKey: "idem-1",
      amount: 110,
      currency: "CAD",
    });
  });

  it("lists repair candidates for stale processing and reconciliation work", async () => {
    const repository = new PaymentsRepository({
      payment: {
        findMany: jest.fn(async () => [
          {
            id: "payment-1",
            bookingRequestId: "booking-1",
            squarePaymentId: "square-pay-1",
            status: "processing",
            bookingRequest: {
              status: "payment_processing",
            },
          },
        ]),
      },
    } as never);

    const result = await repository.listRepairCandidates(3);

    expect(result).toEqual([
      {
        paymentId: "payment-1",
        bookingRequestId: "booking-1",
        squarePaymentId: "square-pay-1",
        status: "processing",
        bookingStatus: "payment_processing",
      },
    ]);
  });

  it("marks booking reconciliation required through a nested booking update", async () => {
    const update = jest.fn(async () => undefined);
    const repository = new PaymentsRepository({
      payment: {
        update,
      },
    } as never);

    await repository.markBookingReconciliationRequired("payment-1");

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "payment-1",
      },
      data: {
        bookingRequest: {
          update: {
            paymentReconciliationRequired: true,
          },
        },
      },
    });
  });

  it("releases scheduled payouts and records a ledger entry", async () => {
    const createdLedgerEntries: Array<Record<string, unknown>> = [];
    const transaction = {
      payout: {
        findUniqueOrThrow: jest.fn(async () => createPayoutPersistence()),
        update: jest.fn(async () => undefined),
      },
      payment: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: "payment-1",
          pricingCurrency: "CAD",
        })),
      },
      paymentLedgerEntry: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          createdLedgerEntries.push(data);
        }),
      },
    };
    const repository = new PaymentsRepository({
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    } as never);

    await repository.markPayoutReleased("payout-1");

    expect(createdLedgerEntries[0]).toMatchObject({
      paymentId: "payment-1",
      type: "payout_released",
      currency: "CAD",
      metadata: {
        payoutId: "payout-1",
      },
    });
  });

  it("lists payouts for an organization with pagination and status filters", async () => {
    const findMany = jest.fn(async () => [
      createPayoutPersistence({
        status: "released",
        releasedAt: new Date("2026-04-22T00:00:00.000Z"),
      }),
    ]);
    const count = jest.fn(async () => 3);
    const repository = new PaymentsRepository({
      payout: {
        findMany,
        count,
      },
    } as never);

    const result = await repository.listPayoutsForOrganization({
      actorUserId: "manager-1",
      organizationId: "org-1",
      page: 2,
      pageSize: 2,
      status: "released",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          status: "released",
        },
        skip: 2,
        take: 2,
      }),
    );
    expect(result.payouts[0]).toMatchObject({
      id: "payout-1",
      status: "released",
      amount: 75,
    });
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(result.status).toBe("released");
  });
});
