import { Prisma } from "@/generated/prisma/client";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import { PaymentsRepository } from "@/features/payments/payments.repository";
import { testUuid } from "../../support/uuid";
const BOOKING_1_ID = testUuid(9000, 996753);
const MANAGER_1_ID = testUuid(9000, 836503);
const PAYMENT_1_ID = testUuid(9000, 132102);
const RENTER_1_ID = testUuid(9000, 235000);

const ORG_1_ID = testUuid(9000, 9234);

const FUTURE_HOLD_EXPIRES_AT = new Date("2099-04-21T00:00:00.000Z");

function createBookingPersistence(
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    id: BOOKING_1_ID,
    postingId: "posting-1",
    renterId: RENTER_1_ID,
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
    id: PAYMENT_1_ID,
    bookingRequestId: BOOKING_1_ID,
    postingId: "posting-1",
    renterId: RENTER_1_ID,
    ownerId: "owner-1",
    provider: "paypal",
    status: "awaiting_method",
    pricingCurrency: "CAD",
    rentalSubtotalAmount: new Prisma.Decimal(100),
    platformFeeAmount: new Prisma.Decimal(10),
    totalAmount: new Prisma.Decimal(110),
    providerPaymentId: null,
    providerOrderId: null,
    checkoutUrl: null,
    lastAttemptedAt: null,
    succeededAt: null,
    failedAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    updatedAt: new Date("2026-04-20T00:00:00.000Z"),
    bookingRequest: {
      id: BOOKING_1_ID,
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
    paymentId: PAYMENT_1_ID,
    organizationId: ORG_1_ID,
    status: "scheduled",
    amount: new Prisma.Decimal(75),
    dueAt: new Date("2026-04-21T00:00:00.000Z"),
    releasedAt: null,
    failedAt: null,
    providerPayoutId: null,
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

    const repository = new PaymentsRepository(database as any);
    const result = await repository.createPaymentAttemptForBooking({
      bookingRequestId: BOOKING_1_ID,
      renterId: RENTER_1_ID,
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

    const repository = new PaymentsRepository(database as any);
    const result = await repository.markPaymentSucceeded({
      providerPaymentId: "capture-1",
      providerOrderId: "order-1",
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

    const repository = new PaymentsRepository(database as any);
    const result = await repository.markPaymentSucceeded({
      providerPaymentId: "capture-1",
      providerOrderId: "order-1",
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
      providerPaymentId: "capture-1",
      providerOrderId: "order-1",
      payout: {
        id: "payout-1",
        paymentId: PAYMENT_1_ID,
        ownerId: "owner-1",
        status: "scheduled",
        amount: new Prisma.Decimal(100),
        dueAt: new Date("2026-05-01T00:00:00.000Z"),
        releasedAt: null,
        failedAt: null,
        providerPayoutId: null,
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

    const repository = new PaymentsRepository(database as any);
    const result = await repository.markPaymentSucceeded({
      providerPaymentId: "capture-1",
      providerOrderId: "order-1",
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
      paymentId: PAYMENT_1_ID,
      amount: new Prisma.Decimal(110),
      status: "pending",
      reason: null,
      idempotencyKey: "refund-idem-1",
      providerRefundId: null,
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
          providerRefundId: "refund-provider-1",
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
            providerRefundId: "refund-provider-1",
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

    const repository = new PaymentsRepository(database as any);
    await repository.completeRefund("refund-1", {
      providerRefundId: "refund-provider-1",
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
      paymentId: PAYMENT_1_ID,
      amount: new Prisma.Decimal(110),
      status: "pending",
      reason: null,
      idempotencyKey: "refund-idem-1",
      providerRefundId: null,
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
          providerRefundId: "refund-provider-1",
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
            providerRefundId: "refund-provider-1",
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

    const repository = new PaymentsRepository(database as any);
    await repository.completeRefund("refund-1", {
      providerRefundId: "refund-provider-1",
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

  it("finds stored refunds by their provider refund id", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        id: "refund-1",
        paymentId: PAYMENT_1_ID,
        status: "pending",
      })
      .mockResolvedValueOnce(null);
    const repository = new PaymentsRepository({
      refund: { findUnique },
    } as any);

    await expect(
      repository.findRefundByProviderRefundId("refund-provider-1"),
    ).resolves.toEqual({
      refundId: "refund-1",
      paymentId: PAYMENT_1_ID,
      status: "pending",
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { providerRefundId: "refund-provider-1" },
      select: { id: true, paymentId: true, status: true },
    });
    await expect(
      repository.findRefundByProviderRefundId("missing"),
    ).resolves.toBeNull();
  });

  it("writes the refund ledger entry only when a refund first settles", async () => {
    const createLedgerEntry = jest.fn(async () => undefined);
    const storedRefund = {
      id: "refund-1",
      paymentId: PAYMENT_1_ID,
      amount: new Prisma.Decimal(50),
      status: "pending",
    };
    const findRefund = jest.fn(async () => storedRefund);
    const transaction = {
      refund: {
        findUniqueOrThrow: findRefund,
        update: jest.fn(async () => undefined),
        findMany: jest.fn(async () => []),
      },
      payment: {
        findUniqueOrThrow: jest.fn(async () =>
          createPaymentPersistence({ status: "succeeded" }),
        ),
        update: jest.fn(async () => undefined),
      },
      bookingRequest: {
        update: jest.fn(async () => undefined),
      },
      postingAvailabilityBlock: {
        deleteMany: jest.fn(async () => undefined),
      },
      paymentLedgerEntry: {
        create: createLedgerEntry,
      },
    };
    const repository = new PaymentsRepository({
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    } as any);

    await repository.completeRefund("refund-1", {
      providerRefundId: "refund-provider-1",
      status: "PENDING",
      raw: {},
    });
    expect(createLedgerEntry).not.toHaveBeenCalled();

    await repository.completeRefund("refund-1", {
      providerRefundId: "refund-provider-1",
      status: "COMPLETED",
      raw: { ok: true },
    });
    expect(createLedgerEntry).toHaveBeenCalledTimes(1);

    findRefund.mockResolvedValueOnce({ ...storedRefund, status: "succeeded" });
    await repository.completeRefund("refund-1", {
      providerRefundId: "refund-provider-1",
      status: "COMPLETED",
      raw: { ok: true },
    });
    expect(createLedgerEntry).toHaveBeenCalledTimes(1);
  });

  it("can preserve the current booking status while recording a successful refund", async () => {
    const bookingUpdates: Array<Record<string, unknown>> = [];
    const deletedBlocks: string[] = [];
    const refund = {
      id: "refund-1",
      paymentId: PAYMENT_1_ID,
      amount: new Prisma.Decimal(110),
      status: "pending",
      reason: null,
      idempotencyKey: "refund-idem-1",
      providerRefundId: null,
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
          providerRefundId: "refund-provider-1",
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
            providerRefundId: "refund-provider-1",
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

    const repository = new PaymentsRepository(database as any);
    await repository.completeRefund(
      "refund-1",
      {
        providerRefundId: "refund-provider-1",
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
      checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=order-1",
      providerPaymentId: "capture-1",
      providerOrderId: "order-1",
      lastAttemptedAt: new Date("2026-04-20T00:05:00.000Z"),
      attempts: [
        {
          id: "attempt-1",
          paymentId: PAYMENT_1_ID,
          idempotencyKey: "idem-1",
          status: "processing",
          retryCount: 0,
          failureCategory: null,
          failureCode: null,
          failureMessage: null,
          providerRequestId: "provider-request-1",
          providerPaymentId: "capture-1",
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
            bookingRequestId: BOOKING_1_ID,
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
    } as any);

    const result = await repository.attachPaymentSession(
      PAYMENT_1_ID,
      "attempt-1",
      {
        providerRequestId: "provider-request-1",
        providerPaymentId: "capture-1",
        providerOrderId: "order-1",
        checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=order-1",
        raw: {
          ok: true,
        },
      },
    );

    expect(bookingRequestUpdate).toHaveBeenCalledWith({
      where: {
        id: BOOKING_1_ID,
      },
      data: {
        status: "payment_processing",
      },
    });
    expect(result).toMatchObject({
      status: "processing",
      checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=order-1",
      providerPaymentId: "capture-1",
      providerOrderId: "order-1",
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
          paymentId: PAYMENT_1_ID,
          idempotencyKey: "idem-1",
          status: "failed_retryable",
          retryCount: 1,
          failureCategory: "transient",
          failureCode: "TEMP_DOWN",
          failureMessage: "temporary outage",
          providerRequestId: null,
          providerPaymentId: null,
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
        update: jest.fn(async () => undefined),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({
            bookingRequestId: BOOKING_1_ID,
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
    } as any);

    const result = await repository.recordAttemptFailure(
      PAYMENT_1_ID,
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
    } as any);

    await expect(
      repository.findAccessibleById(PAYMENT_1_ID, RENTER_1_ID),
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
              id: PAYMENT_1_ID,
              providerPaymentId: "capture-1",
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
        } as any),
    } as any);

    const result = await repository.createRefundRecord({
      paymentId: PAYMENT_1_ID,
      actorUserId: RENTER_1_ID,
      amount: 10,
      idempotencyKey: "refund-idem-1",
    });

    expect(result).toEqual({
      refundId: "refund-1",
      paymentId: PAYMENT_1_ID,
      providerPaymentId: "capture-1",
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
              id: PAYMENT_1_ID,
              providerPaymentId: "capture-1",
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
        } as any),
    } as any);

    await expect(
      repository.createRefundRecord({
        paymentId: PAYMENT_1_ID,
        actorUserId: RENTER_1_ID,
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
          paymentId: PAYMENT_1_ID,
          idempotencyKey: "idem-1",
          status: "failed_retryable",
          retryCount: 1,
          failureCategory: "transient",
          failureCode: "TEMP_DOWN",
          failureMessage: "temporary outage",
          providerRequestId: null,
          providerPaymentId: null,
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
    } as any);

    const result = await repository.markPaymentFailed(
      {
        providerPaymentId: "capture-1",
        providerOrderId: "order-1",
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
            paymentId: PAYMENT_1_ID,
            idempotencyKey: "idem-1",
            retryCount: 2,
          },
        ]),
      },
    } as any);

    const result = await repository.listRetryCandidates(5);

    expect(result).toEqual([
      {
        attemptId: "attempt-1",
        paymentId: PAYMENT_1_ID,
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
          paymentId: PAYMENT_1_ID,
          idempotencyKey: "idem-1",
          status: "failed_retryable",
        })),
        update: jest.fn(async () => undefined),
      },
      payment: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: PAYMENT_1_ID,
          bookingRequestId: BOOKING_1_ID,
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
    } as any);

    const result = await repository.markAttemptForRetry("attempt-1");

    expect(paymentUpdates[0]).toMatchObject({
      status: "processing",
      lastAttemptedAt: expect.any(Date),
    });
    expect(result).toEqual({
      paymentId: PAYMENT_1_ID,
      bookingRequestId: BOOKING_1_ID,
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
            id: PAYMENT_1_ID,
            bookingRequestId: BOOKING_1_ID,
            providerPaymentId: "capture-1",
            status: "processing",
            bookingRequest: {
              status: "payment_processing",
            },
          },
        ]),
      },
    } as any);

    const result = await repository.listRepairCandidates(3);

    expect(result).toEqual([
      {
        paymentId: PAYMENT_1_ID,
        bookingRequestId: BOOKING_1_ID,
        providerPaymentId: "capture-1",
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
    } as any);

    await repository.markBookingReconciliationRequired(PAYMENT_1_ID);

    expect(update).toHaveBeenCalledWith({
      where: {
        id: PAYMENT_1_ID,
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
          id: PAYMENT_1_ID,
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
    } as any);

    await repository.markPayoutReleased("payout-1");

    expect(createdLedgerEntries[0]).toMatchObject({
      paymentId: PAYMENT_1_ID,
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
    } as any);

    const result = await repository.listPayoutsForOrganization({
      actorUserId: MANAGER_1_ID,
      organizationId: ORG_1_ID,
      page: 2,
      pageSize: 2,
      status: "released",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_1_ID,
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
  describe("embedded checkout", () => {
    function inTransaction<T extends Record<string, unknown>>(transaction: T) {
      return {
        $transaction: async <R>(callback: (client: T) => Promise<R>) =>
          callback(transaction),
      };
    }

    function attemptPersistence(overrides: Record<string, unknown> = {}) {
      return {
        id: "attempt-1",
        paymentId: PAYMENT_1_ID,
        idempotencyKey: "idem-1",
        status: "processing",
        retryCount: 0,
        failureCategory: null,
        failureCode: null,
        failureMessage: null,
        providerRequestId: "debug-1",
        providerPaymentId: null,
        providerOrderId: "order-1",
        paymentMethod: "paypal",
        nextRetryAt: null,
        createdAt: new Date("2026-04-20T00:00:00.000Z"),
        updatedAt: new Date("2026-04-20T00:00:00.000Z"),
        ...overrides,
      };
    }

    function inFlightBooking(paymentOverrides: Record<string, unknown> = {}) {
      return createBookingPersistence({
        status: "payment_processing",
        payment: createPaymentPersistence({
          status: "processing",
          providerOrderId: "order-1",
          rentalSubtotalAmount: new Prisma.Decimal(100),
          platformFeeAmount: new Prisma.Decimal(10),
          totalAmount: new Prisma.Decimal(110),
          attempts: [attemptPersistence()],
          ...paymentOverrides,
        }),
      });
    }

    it("answers a replayed idempotency key before checking the booking status", async () => {
      const transaction = {
        bookingRequest: {
          findUnique: jest.fn(async () => inFlightBooking()),
        },
        paymentAttempt: {
          create: jest.fn(),
        },
      };
      const repository = new PaymentsRepository(
        inTransaction(transaction) as any,
      );

      const result = await repository.createPaymentAttemptForBooking({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        idempotencyKey: "idem-1",
        method: "paypal",
      });

      expect(result.attemptId).toBe("attempt-1");
      expect(result.amount).toBe(110);
      expect(result.payment.attempts[0]).toMatchObject({
        providerOrderId: "order-1",
        paymentMethod: "paypal",
      });
      expect(transaction.paymentAttempt.create).not.toHaveBeenCalled();
    });

    it("rejects a replayed idempotency key used for another method", async () => {
      const transaction = {
        bookingRequest: {
          findUnique: jest.fn(async () => inFlightBooking()),
        },
      };
      const repository = new PaymentsRepository(
        inTransaction(transaction) as any,
      );

      await expect(
        repository.createPaymentAttemptForBooking({
          bookingRequestId: BOOKING_1_ID,
          renterId: RENTER_1_ID,
          idempotencyKey: "idem-1",
          method: "card",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("treats attempts recorded before methods existed as redirect checkouts", async () => {
      const transaction = {
        bookingRequest: {
          findUnique: jest.fn(async () =>
            inFlightBooking({
              attempts: [attemptPersistence({ paymentMethod: null })],
            }),
          ),
        },
      };
      const repository = new PaymentsRepository(
        inTransaction(transaction) as any,
      );

      const result = await repository.createPaymentAttemptForBooking({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        idempotencyKey: "idem-1",
      });

      expect(result.payment.attempts[0]?.paymentMethod).toBeUndefined();
    });

    it("refuses a second order while one is in flight unless superseding", async () => {
      const transaction = {
        bookingRequest: {
          findUnique: jest.fn(async () => inFlightBooking()),
        },
      };
      const repository = new PaymentsRepository(
        inTransaction(transaction) as any,
      );

      await expect(
        repository.createPaymentAttemptForBooking({
          bookingRequestId: BOOKING_1_ID,
          renterId: RENTER_1_ID,
          idempotencyKey: "idem-2",
          method: "card",
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("reports a busy checkout when the open order changed underneath", async () => {
      const transaction = {
        bookingRequest: {
          findUnique: jest.fn(async () => inFlightBooking()),
        },
        paymentAttempt: {
          updateMany: jest.fn(),
        },
      };
      const repository = new PaymentsRepository(
        inTransaction(transaction) as any,
      );

      const error = await repository
        .createPaymentAttemptForBooking({
          bookingRequestId: BOOKING_1_ID,
          renterId: RENTER_1_ID,
          idempotencyKey: "idem-2",
          method: "card",
          supersede: { expectedProviderOrderId: "order-other" },
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).details).toEqual({
        reason: "checkout_busy",
      });
      expect(transaction.paymentAttempt.updateMany).not.toHaveBeenCalled();
    });

    it("supersedes the open order and charges the stored amounts", async () => {
      const attemptCreates: Array<Record<string, unknown>> = [];
      const booking = inFlightBooking({
        // Stored amounts from an older formula must still be what is charged.
        rentalSubtotalAmount: new Prisma.Decimal(90),
        platformFeeAmount: new Prisma.Decimal(9),
        totalAmount: new Prisma.Decimal(99),
      });
      const transaction = {
        bookingRequest: {
          findUnique: jest.fn(async () => booking),
          update: jest.fn(),
        },
        payment: {
          create: jest.fn(),
          update: jest.fn(async () => undefined),
          findUniqueOrThrow: jest.fn(async () => booking.payment),
        },
        paymentAttempt: {
          updateMany: jest.fn(async () => ({ count: 1 })),
          create: jest.fn(
            async ({ data }: { data: Record<string, unknown> }) => {
              attemptCreates.push(data);
              return { id: "attempt-2" };
            },
          ),
        },
        paymentLedgerEntry: {
          create: jest.fn(async () => undefined),
        },
      };
      const repository = new PaymentsRepository(
        inTransaction(transaction) as any,
      );

      const result = await repository.createPaymentAttemptForBooking({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        idempotencyKey: "idem-2",
        method: "card",
        supersede: { expectedProviderOrderId: "order-1" },
      });

      expect(transaction.paymentAttempt.updateMany).toHaveBeenCalledWith({
        where: {
          paymentId: PAYMENT_1_ID,
          status: { in: ["pending", "processing", "failed_retryable"] },
        },
        data: expect.objectContaining({
          status: "failed_final",
          failureCode: "CHECKOUT_SUPERSEDED",
        }),
      });
      expect(transaction.payment.update).toHaveBeenCalledWith({
        where: { id: PAYMENT_1_ID },
        data: {
          status: "awaiting_method",
          providerOrderId: null,
          checkoutUrl: null,
        },
      });
      expect(transaction.payment.create).not.toHaveBeenCalled();
      expect(transaction.bookingRequest.update).not.toHaveBeenCalled();
      expect(attemptCreates[0]).toMatchObject({
        idempotencyKey: "idem-2",
        paymentMethod: "card",
        status: "pending",
      });
      expect(result.amount).toBe(99);
    });

    it("skips order marking when a supersede finds nothing in flight", async () => {
      const booking = createBookingPersistence({
        status: "payment_failed",
        payment: createPaymentPersistence({ status: "failed_final" }),
      });
      const transaction = {
        bookingRequest: {
          findUnique: jest.fn(async () => booking),
        },
        payment: {
          findUniqueOrThrow: jest.fn(async () => booking.payment),
        },
        paymentAttempt: {
          updateMany: jest.fn(),
          create: jest.fn(async () => ({ id: "attempt-2" })),
        },
        paymentLedgerEntry: {
          create: jest.fn(async () => undefined),
        },
      };
      const repository = new PaymentsRepository(
        inTransaction(transaction) as any,
      );

      await repository.createPaymentAttemptForBooking({
        bookingRequestId: BOOKING_1_ID,
        renterId: RENTER_1_ID,
        idempotencyKey: "idem-2",
        method: "paypal",
        supersede: { expectedProviderOrderId: null },
      });

      expect(transaction.paymentAttempt.updateMany).not.toHaveBeenCalled();
    });

    it("stores the provider order on the attempt when a session attaches", async () => {
      const attemptUpdate = jest.fn(async () => undefined);
      const transaction = {
        paymentAttempt: {
          update: attemptUpdate,
        },
        payment: {
          update: jest.fn(async () => undefined),
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValueOnce({ bookingRequestId: BOOKING_1_ID })
            .mockResolvedValueOnce(createPaymentPersistence()),
        },
        bookingRequest: {
          update: jest.fn(async () => undefined),
        },
      };
      const repository = new PaymentsRepository(
        inTransaction(transaction) as any,
      );

      await repository.attachPaymentSession(PAYMENT_1_ID, "attempt-1", {
        providerOrderId: "order-2",
        raw: {},
      });

      expect(attemptUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ providerOrderId: "order-2" }),
        }),
      );
    });

    it("does not schedule retries for embedded checkout failures", async () => {
      const attemptUpdates: Array<Record<string, unknown>> = [];
      const transaction = {
        paymentAttempt: {
          findUniqueOrThrow: jest.fn(async () => ({
            id: "attempt-1",
            retryCount: 0,
          })),
          update: jest.fn(
            async ({ data }: { data: Record<string, unknown> }) => {
              attemptUpdates.push(data);
            },
          ),
        },
        payment: {
          update: jest.fn(async () => undefined),
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValueOnce({ bookingRequestId: BOOKING_1_ID })
            .mockResolvedValueOnce(createPaymentPersistence()),
        },
        bookingRequest: {
          update: jest.fn(async () => undefined),
        },
      };
      const repository = new PaymentsRepository(
        inTransaction(transaction) as any,
      );

      await repository.recordAttemptFailure(
        PAYMENT_1_ID,
        "attempt-1",
        {
          category: "transient",
          message: "paypal down",
          retryable: true,
        },
        { scheduleRetry: false },
      );

      expect(attemptUpdates[0]).toMatchObject({
        status: "failed_final",
        nextRetryAt: null,
      });
    });

    describe("rejectCheckoutAttempt", () => {
      function rejectionTransaction(paymentRow: Record<string, unknown>) {
        return {
          payment: {
            findUniqueOrThrow: jest.fn(async () => paymentRow),
            update: jest.fn(async () => undefined),
          },
          paymentAttempt: {
            update: jest.fn(async () => undefined),
          },
          bookingRequest: {
            update: jest.fn(async () => undefined),
          },
        };
      }

      it("fails the current order's attempt, payment, and payable booking", async () => {
        const paymentRow = createPaymentPersistence({
          status: "processing",
          providerOrderId: "order-2",
          attempts: [
            attemptPersistence({ id: "attempt-2", providerOrderId: "order-2" }),
            attemptPersistence({ id: "attempt-1", providerOrderId: "order-1" }),
          ],
          bookingRequest: {
            ...createPaymentPersistence().bookingRequest,
            status: "payment_processing",
          },
        });
        const transaction = rejectionTransaction(paymentRow);
        const repository = new PaymentsRepository(
          inTransaction(transaction) as any,
        );

        await repository.rejectCheckoutAttempt({
          paymentId: PAYMENT_1_ID,
          providerOrderId: "order-2",
          failureCode: "CARD_AUTHENTICATION_FAILED",
          failureMessage: "Verification failed.",
        });

        expect(transaction.paymentAttempt.update).toHaveBeenCalledWith({
          where: { id: "attempt-2" },
          data: expect.objectContaining({
            status: "failed_final",
            failureCode: "CARD_AUTHENTICATION_FAILED",
          }),
        });
        expect(transaction.payment.update).toHaveBeenCalledWith({
          where: { id: PAYMENT_1_ID },
          data: expect.objectContaining({ status: "failed_final" }),
        });
        expect(transaction.bookingRequest.update).toHaveBeenCalledWith({
          where: { id: BOOKING_1_ID },
          data: expect.objectContaining({ status: "payment_failed" }),
        });
      });

      it("leaves an expired booking expired", async () => {
        const paymentRow = createPaymentPersistence({
          status: "processing",
          providerOrderId: "order-1",
          attempts: [attemptPersistence()],
          bookingRequest: {
            ...createPaymentPersistence().bookingRequest,
            status: "expired",
          },
        });
        const transaction = rejectionTransaction(paymentRow);
        const repository = new PaymentsRepository(
          inTransaction(transaction) as any,
        );

        await repository.rejectCheckoutAttempt({
          paymentId: PAYMENT_1_ID,
          providerOrderId: "order-1",
          failureCode: "HOLD_EXPIRED",
          failureMessage: "Hold expired.",
        });

        expect(transaction.payment.update).toHaveBeenCalled();
        expect(transaction.bookingRequest.update).not.toHaveBeenCalled();
      });

      it("only ends the attempt when the order is no longer current", async () => {
        const paymentRow = createPaymentPersistence({
          status: "processing",
          providerOrderId: "order-2",
          attempts: [],
        });
        const transaction = rejectionTransaction(paymentRow);
        const repository = new PaymentsRepository(
          inTransaction(transaction) as any,
        );

        await repository.rejectCheckoutAttempt({
          paymentId: PAYMENT_1_ID,
          providerOrderId: "order-1",
          failureCode: "ORDER_MISMATCH",
          failureMessage: "Mismatch.",
        });

        expect(transaction.paymentAttempt.update).not.toHaveBeenCalled();
        expect(transaction.payment.update).not.toHaveBeenCalled();
        expect(transaction.bookingRequest.update).not.toHaveBeenCalled();
      });
    });

    describe("markPaymentSucceeded", () => {
      it("flags reconciliation when an old order captures after the payment already succeeded", async () => {
        const bookingUpdate = jest.fn(async () => undefined);
        const payment = createPaymentPersistence({
          status: "succeeded",
          providerOrderId: "order-2",
          providerPaymentId: "capture-2",
        });
        const transaction = {
          payment: {
            findFirst: jest.fn(async () => payment),
            update: jest.fn(),
          },
          bookingRequest: {
            update: bookingUpdate,
          },
          paymentLedgerEntry: {
            create: jest.fn(),
          },
        };
        const repository = new PaymentsRepository(
          inTransaction(transaction) as any,
        );

        const result = await repository.markPaymentSucceeded({
          providerOrderId: "order-1",
          providerPaymentId: "capture-1",
          status: "COMPLETED",
          raw: {},
        });

        expect(result.reconciliationRequired).toBe(true);
        expect(bookingUpdate).toHaveBeenCalledWith({
          where: { id: BOOKING_1_ID },
          data: { paymentReconciliationRequired: true },
        });
        expect(transaction.payment.update).not.toHaveBeenCalled();
        expect(transaction.paymentLedgerEntry.create).not.toHaveBeenCalled();
        const where = (
          transaction.payment.findFirst.mock.calls[0] as unknown as [
            { where: { OR: unknown[] } },
          ]
        )[0].where;
        expect(where.OR).toContainEqual({
          attempts: { some: { providerOrderId: "order-1" } },
        });
      });

      it("marks the attempt that created the captured order", async () => {
        const attemptUpdate = jest.fn(async () => undefined);
        const payment = createPaymentPersistence({
          status: "processing",
          providerOrderId: "order-1",
          attempts: [
            attemptPersistence({ id: "attempt-2", providerOrderId: "order-2" }),
            attemptPersistence({ id: "attempt-1", providerOrderId: "order-1" }),
          ],
        });
        const booking = createBookingPersistence({
          convertedAt: new Date("2026-04-21T00:00:00.000Z"),
          renting: { id: "renting-1" },
        });
        const transaction = {
          payment: {
            findFirst: jest.fn(async () => payment),
            update: jest.fn(async () => undefined),
            findUniqueOrThrow: jest.fn(async () => payment),
          },
          paymentAttempt: {
            update: attemptUpdate,
          },
          bookingRequest: {
            findUniqueOrThrow: jest.fn(async () => booking),
          },
          paymentLedgerEntry: {
            create: jest.fn(async () => undefined),
          },
          payout: {
            create: jest.fn(async () => undefined),
          },
        };
        const repository = new PaymentsRepository(
          inTransaction(transaction) as any,
        );

        await repository.markPaymentSucceeded({
          providerOrderId: "order-1",
          status: "COMPLETED",
          raw: {},
        });

        expect(attemptUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: "attempt-1" } }),
        );
      });
    });

    describe("findCheckoutContext", () => {
      it("returns null for unknown bookings", async () => {
        const repository = new PaymentsRepository({
          bookingRequest: {
            findUnique: jest.fn(async () => null),
          },
        } as any);

        await expect(
          repository.findCheckoutContext(BOOKING_1_ID),
        ).resolves.toBeNull();
      });

      it("maps the booking, posting summary, and payment", async () => {
        const repository = new PaymentsRepository({
          bookingRequest: {
            findUnique: jest.fn(async () =>
              createBookingPersistence({
                organizationId: ORG_1_ID,
                convertedAt: null,
                renting: null,
                posting: {
                  id: "posting-1",
                  name: "Lakeside cabin",
                  cancellationPolicyNotes: "No parties.",
                  photos: [{ blobUrl: "https://blob.example/1.jpg" }],
                },
                payment: createPaymentPersistence({
                  attempts: [attemptPersistence({ paymentMethod: "bogus" })],
                }),
              }),
            ),
          },
        } as any);

        const context = await repository.findCheckoutContext(BOOKING_1_ID);

        expect(context?.booking).toMatchObject({
          id: BOOKING_1_ID,
          renterId: RENTER_1_ID,
          durationDays: 3,
          guestCount: 2,
          dailyPriceAmount: 120,
          estimatedTotal: 400,
          converted: false,
        });
        expect(context?.posting).toEqual({
          id: "posting-1",
          name: "Lakeside cabin",
          primaryPhotoUrl: "https://blob.example/1.jpg",
          cancellationPolicyNotes: "No parties.",
        });
        expect(context?.payment?.id).toBe(PAYMENT_1_ID);
        expect(context?.payment?.attempts[0]?.paymentMethod).toBeUndefined();
      });

      it("handles postings without photos or notes, and converted bookings", async () => {
        const repository = new PaymentsRepository({
          bookingRequest: {
            findUnique: jest.fn(async () =>
              createBookingPersistence({
                convertedAt: new Date("2026-04-21T00:00:00.000Z"),
                posting: {
                  id: "posting-1",
                  name: "Loft",
                  cancellationPolicyNotes: null,
                  photos: [],
                },
              }),
            ),
          },
        } as any);

        const context = await repository.findCheckoutContext(BOOKING_1_ID);

        expect(context?.booking.converted).toBe(true);
        expect(context?.posting.primaryPhotoUrl).toBeUndefined();
        expect(context?.posting.cancellationPolicyNotes).toBeUndefined();
        expect(context?.payment).toBeNull();
      });
    });

    it("only retries redirect checkouts in the background", async () => {
      const findMany = jest.fn(async () => []);
      const repository = new PaymentsRepository({
        paymentAttempt: {
          findMany,
        },
      } as any);

      await repository.listRetryCandidates(5);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ paymentMethod: null }, { paymentMethod: "paypal_redirect" }],
          }),
        }),
      );
    });
  });
});
