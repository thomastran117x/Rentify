import { Prisma } from "@prisma/client";
import ConflictError from "@/errors/http/conflict.error";
import { BookingsRepository } from "@/features/bookings/bookings.repository";

function createBookingRequestPersistence(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    organizationId: "org-1",
    status: "pending",
    startAt: new Date("2026-05-01T00:00:00.000Z"),
    endAt: new Date("2026-05-04T00:00:00.000Z"),
    durationDays: 3,
    guestCount: 2,
    contactName: "Jordan Lee",
    contactEmail: "jordan@example.com",
    contactPhoneNumber: null,
    note: null,
    pricingCurrency: "CAD",
    pricingSnapshot: {
      currency: "CAD",
      daily: {
        amount: 120,
      },
    },
    dailyPriceAmount: new Prisma.Decimal(120),
    estimatedTotal: new Prisma.Decimal(360),
    decisionNote: null,
    approvedAt: null,
    paymentRequiredAt: null,
    paymentFailedAt: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationActor: null,
    cancellationReason: null,
    cancellationPolicyCode: null,
    cancellationRefundAmount: null,
    refundedAt: null,
    declinedAt: null,
    expiredAt: null,
    convertedAt: null,
    conversionReservedAt: null,
    conversionReservationExpiresAt: null,
    holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
    holdBlockId: null,
    paymentReconciliationRequired: false,
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    updatedAt: new Date("2026-04-21T00:00:00.000Z"),
    renting: null,
    posting: {
      id: "posting-1",
      name: "Sunny loft",
      maxBookingDurationDays: null,
      photos: [
        {
          blobUrl: "https://example.test/posting-1.jpg",
        },
      ],
    },
    ...overrides,
  };
}

describe("BookingsRepository", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("creates a booking request and maps decimal and optional fields", async () => {
    const create = jest.fn(async () =>
      createBookingRequestPersistence({
        contactPhoneNumber: "555-0100",
        note: "Please confirm quickly",
      }),
    );
    const repository = new BookingsRepository({
      bookingRequest: {
        create,
      },
    } as never);

    const result = await repository.create({
      postingId: "posting-1",
      renterId: "renter-1",
      organizationId: "org-1",
      startAt: new Date("2026-05-01T00:00:00.000Z"),
      endAt: new Date("2026-05-04T00:00:00.000Z"),
      durationDays: 3,
      guestCount: 2,
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
      contactPhoneNumber: "555-0100",
      note: "Please confirm quickly",
      pricingCurrency: "CAD",
      pricingSnapshot: {
        currency: "CAD",
        daily: {
          amount: 120,
        },
      },
      dailyPriceAmount: 120,
      estimatedTotal: 360,
      holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postingId: "posting-1",
          renterId: "renter-1",
          organizationId: "org-1",
          dailyPriceAmount: expect.any(Prisma.Decimal),
          estimatedTotal: expect.any(Prisma.Decimal),
        }),
      }),
    );
    expect(result).toMatchObject({
      id: "booking-1",
      contactPhoneNumber: "555-0100",
      note: "Please confirm quickly",
      dailyPriceAmount: 120,
      estimatedTotal: 360,
      posting: {
        id: "posting-1",
        name: "Sunny loft",
        primaryPhotoUrl: "https://example.test/posting-1.jpg",
        effectiveMaxBookingDurationDays: 30,
      },
    });
  });

  it("does not create a booking request when the active-request cap is already reached", async () => {
    const create = jest.fn();
    const transaction = {
      bookingRequest: {
        count: jest.fn(async () => 2),
        create,
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };

    const repository = new BookingsRepository(database as never);
    const result = await repository.createIfWithinActiveRequestLimit(
      {
        postingId: "posting-1",
        renterId: "renter-1",
        ownerId: "owner-1",
        startAt: new Date("2026-05-01T00:00:00.000Z"),
        endAt: new Date("2026-05-04T00:00:00.000Z"),
        durationDays: 3,
        guestCount: 2,
        contactName: "Jordan Lee",
        contactEmail: "jordan@example.com",
        pricingCurrency: "CAD",
        pricingSnapshot: {
          currency: "CAD",
          daily: {
            amount: 120,
          },
        },
        dailyPriceAmount: 120,
        estimatedTotal: 360,
        holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
      },
      2,
    );

    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("lists booking requests for a renter with filters and pagination", async () => {
    const findMany = jest.fn(async () => [
      createBookingRequestPersistence({
        id: "booking-2",
        status: "approved",
      }),
    ]);
    const count = jest.fn(async () => 3);
    const repository = new BookingsRepository({
      bookingRequest: {
        findMany,
        count,
      },
    } as never);

    const result = await repository.listByRenter({
      renterId: "renter-1",
      page: 2,
      pageSize: 2,
      status: "approved",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          renterId: "renter-1",
          status: "approved",
        },
        skip: 2,
        take: 2,
      }),
    );
    expect(result.bookingRequests[0]).toMatchObject({
      id: "booking-2",
      status: "approved",
    });
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(result.status).toBe("approved");
  });

  it("deduplicates dashboard posting options by posting id", async () => {
    const findMany = jest.fn(async () => [
      {
        postingId: "posting-2",
        posting: {
          name: "Alpine cabin",
        },
      },
      {
        postingId: "posting-1",
        posting: {
          name: "City loft",
        },
      },
      {
        postingId: "posting-1",
        posting: {
          name: "City loft",
        },
      },
    ]);
    const repository = new BookingsRepository({
      bookingRequest: {
        findMany,
      },
    } as never);

    const result =
      await repository.listDashboardPostingOptionsByOrganization("org-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
        },
      }),
    );
    expect(result).toEqual([
      {
        id: "posting-2",
        name: "Alpine cabin",
      },
      {
        id: "posting-1",
        name: "City loft",
      },
    ]);
  });

  it("checks official reservation overlap with optional exclude and renter filters", async () => {
    const findFirst = jest.fn(async () => ({
      id: "booking-2",
    }));
    const repository = new BookingsRepository({
      bookingRequest: {
        findFirst,
      },
    } as never);

    const result = await repository.hasOfficialReservationOverlap({
      postingId: "posting-1",
      renterId: "renter-1",
      excludeBookingRequestId: "booking-1",
      startAt: new Date("2026-06-01T00:00:00.000Z"),
      endAt: new Date("2026-06-03T00:00:00.000Z"),
    });

    expect(result).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        postingId: "posting-1",
        status: "paid",
        convertedAt: null,
        id: {
          not: "booking-1",
        },
        renterId: "renter-1",
        startAt: {
          lt: new Date("2026-06-03T00:00:00.000Z"),
        },
        endAt: {
          gt: new Date("2026-06-01T00:00:00.000Z"),
        },
      },
      select: {
        id: true,
      },
    });
  });

  it("counts active requests for a renter and posting while excluding a current booking", async () => {
    const count = jest.fn(async () => 4);
    const repository = new BookingsRepository({
      bookingRequest: {
        count,
      },
    } as never);

    const result = await repository.countActiveRequestsForRenterPosting({
      postingId: "posting-1",
      renterId: "renter-1",
      excludeBookingRequestId: "booking-1",
    });

    expect(result).toBe(4);
    expect(count).toHaveBeenCalledWith({
      where: {
        postingId: "posting-1",
        renterId: "renter-1",
        status: {
          in: [
            "pending",
            "approved",
            "awaiting_payment",
            "payment_processing",
            "payment_failed",
            "paid",
          ],
        },
        convertedAt: null,
        id: {
          not: "booking-1",
        },
      },
    });
  });

  it("returns null when a pending update loses its conditional updateMany write", async () => {
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => ({
          id: "booking-1",
          renterId: "renter-1",
          status: "pending",
          holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
        })),
        updateMany: jest.fn(async () => ({
          count: 0,
        })),
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };

    const repository = new BookingsRepository(database as never);
    const result = await repository.updatePending("booking-1", "renter-1", {
      startAt: new Date("2026-05-01T00:00:00.000Z"),
      endAt: new Date("2026-05-04T00:00:00.000Z"),
      durationDays: 3,
      guestCount: 2,
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
      pricingCurrency: "CAD",
      pricingSnapshot: {
        currency: "CAD",
        daily: {
          amount: 120,
        },
      },
      dailyPriceAmount: 120,
      estimatedTotal: 360,
    });

    expect(result).toBeNull();
  });

  it("returns null when approve loses its conditional updateMany write", async () => {
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () =>
          createBookingRequestPersistence({
            holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
          }),
        ),
        updateMany: jest.fn(async () => ({
          count: 0,
        })),
      },
      postingAvailabilityBlock: {
        findFirst: jest.fn(async () => null),
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };

    const repository = new BookingsRepository(database as never);
    const result = await repository.approve(
      "booking-1",
      "org-1",
      "Approved",
      new Date("2026-05-21T12:00:00.000Z"),
    );

    expect(result).toBeNull();
  });

  it("returns null when decline loses its conditional updateMany write", async () => {
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => ({
          id: "booking-1",
          organizationId: "org-1",
          status: "pending",
        })),
        updateMany: jest.fn(async () => ({
          count: 0,
        })),
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };

    const repository = new BookingsRepository(database as never);
    const result = await repository.decline("booking-1", "org-1", "Declined");

    expect(result).toBeNull();
  });

  it("returns null when cancel loses its conditional updateMany write", async () => {
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => ({
          id: "booking-1",
          renterId: "renter-1",
          organizationId: "org-1",
          status: "pending",
          holdBlockId: null,
          convertedAt: null,
        })),
        updateMany: jest.fn(async () => ({
          count: 0,
        })),
      },
      postingAvailabilityBlock: {
        deleteMany: jest.fn(async () => undefined),
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };

    const repository = new BookingsRepository(database as never);
    const result = await repository.cancel({
      bookingRequestId: "booking-1",
      actorUserId: "renter-1",
      actor: "renter",
      expectedStatus: "pending",
      cancellationPolicyCode: "flexible",
      cancellationRefundAmount: 0,
    });

    expect(result).toBeNull();
  });

  it("expires an unpaid hold and clears the availability block", async () => {
    const deleteMany = jest.fn(async () => undefined);
    const updateMany = jest.fn(async () => ({
      count: 1,
    }));
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => ({
          id: "booking-1",
          status: "awaiting_payment",
          holdExpiresAt: new Date("2026-05-19T12:00:00.000Z"),
          holdBlockId: "block-1",
          convertedAt: null,
          conversionReservationExpiresAt: null,
        })),
        updateMany,
      },
      postingAvailabilityBlock: {
        deleteMany,
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };

    const repository = new BookingsRepository(database as never);
    const result = await repository.expire("booking-1");

    expect(result).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "booking-1",
          status: "awaiting_payment",
        }),
        data: expect.objectContaining({
          status: "expired",
          holdBlockId: null,
          conversionReservedAt: null,
          conversionReservationExpiresAt: null,
        }),
      }),
    );
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: "block-1",
      },
    });
  });

  it("creates a conversion reservation when the booking is available", async () => {
    const updateMany = jest.fn(async () => ({
      count: 1,
    }));
    const repository = new BookingsRepository({
      bookingRequest: {
        updateMany,
      },
    } as never);
    const reservationExpiresAt = new Date("2026-05-20T12:05:00.000Z");

    const result = await repository.reserveForConversion(
      "booking-1",
      "org-1",
      reservationExpiresAt,
    );

    expect(result).toEqual({
      reservedAt: new Date("2026-05-20T12:00:00.000Z"),
      reservationExpiresAt,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking-1",
        organizationId: "org-1",
        status: "paid",
        convertedAt: null,
        OR: [
          {
            conversionReservationExpiresAt: null,
          },
          {
            conversionReservationExpiresAt: {
              lte: new Date("2026-05-20T12:00:00.000Z"),
            },
          },
        ],
      },
      data: {
        conversionReservedAt: new Date("2026-05-20T12:00:00.000Z"),
        conversionReservationExpiresAt: reservationExpiresAt,
      },
    });
  });

  it("throws when a conversion reservation is already held", async () => {
    const repository = new BookingsRepository({
      bookingRequest: {
        updateMany: jest.fn(async () => ({
          count: 0,
        })),
      },
    } as never);

    await expect(
      repository.reserveForConversion(
        "booking-1",
        "org-1",
        new Date("2026-05-20T12:05:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("releases a conversion reservation only when the token matches", async () => {
    const updateMany = jest.fn(async () => ({
      count: 1,
    }));
    const repository = new BookingsRepository({
      bookingRequest: {
        updateMany,
      },
    } as never);
    const reservation = {
      reservedAt: new Date("2026-05-20T12:00:00.000Z"),
      reservationExpiresAt: new Date("2026-05-20T12:05:00.000Z"),
    };

    await repository.releaseConversionReservation(
      "booking-1",
      "org-1",
      reservation,
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking-1",
        organizationId: "org-1",
        conversionReservedAt: reservation.reservedAt,
        conversionReservationExpiresAt: reservation.reservationExpiresAt,
      },
      data: {
        conversionReservedAt: null,
        conversionReservationExpiresAt: null,
      },
    });
  });
});
