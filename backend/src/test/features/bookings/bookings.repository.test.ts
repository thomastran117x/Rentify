import { Prisma } from "@prisma/client";
import BadRequestError from "@/errors/http/bad-request.error";
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

function createBookingRequestInput(overrides: Record<string, unknown> = {}) {
  return {
    postingId: "posting-1",
    renterId: "renter-1",
    organizationId: "org-1",
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
    dailyPriceAmount: 120,
    estimatedTotal: 360,
    holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
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
    } as any);

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

    const repository = new BookingsRepository(database as any);
    const result = await repository.createIfWithinActiveRequestLimit(
      {
        postingId: "posting-1",
        renterId: "renter-1",
        organizationId: "org-1",
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

  it("creates a booking request when active-request capacity remains", async () => {
    const create = jest.fn(async () =>
      createBookingRequestPersistence({
        id: "booking-allowed",
        contactPhoneNumber: "555-0100",
        note: "Allowed request",
      }),
    );
    const transaction = {
      bookingRequest: {
        count: jest.fn(async () => 1),
        create,
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };

    const repository = new BookingsRepository(database as any);
    const result = await repository.createIfWithinActiveRequestLimit(
      createBookingRequestInput({
        contactPhoneNumber: "555-0100",
        note: "Allowed request",
      }),
      2,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postingId: "posting-1",
          renterId: "renter-1",
          dailyPriceAmount: expect.any(Prisma.Decimal),
          estimatedTotal: expect.any(Prisma.Decimal),
          contactPhoneNumber: "555-0100",
          note: "Allowed request",
        }),
      }),
    );
    expect(result).toMatchObject({
      id: "booking-allowed",
      contactPhoneNumber: "555-0100",
      note: "Allowed request",
      dailyPriceAmount: 120,
      estimatedTotal: 360,
    });
  });

  it("finds a booking request by id and returns null when it does not exist", async () => {
    const findUnique = jest
      .fn(async () => createBookingRequestPersistence({ id: "booking-found" }))
      .mockResolvedValueOnce(
        createBookingRequestPersistence({ id: "booking-found" }),
      )
      .mockResolvedValueOnce(null as any);
    const repository = new BookingsRepository({
      bookingRequest: {
        findUnique,
      },
    } as any);

    await expect(repository.findById("booking-found")).resolves.toMatchObject({
      id: "booking-found",
      posting: {
        id: "posting-1",
        name: "Sunny loft",
      },
    });
    await expect(repository.findById("booking-missing")).resolves.toBeNull();
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
    } as any);

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

  it("updates a pending booking request when the renter still owns an active hold", async () => {
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => ({
          id: "booking-1",
          renterId: "renter-1",
          status: "pending",
          holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
        })),
        updateMany: jest.fn(async () => ({
          count: 1,
        })),
        findUniqueOrThrow: jest.fn(async () =>
          createBookingRequestPersistence({
            contactPhoneNumber: "555-0101",
            note: "Updated booking",
            dailyPriceAmount: new Prisma.Decimal(150),
            estimatedTotal: new Prisma.Decimal(450),
          }),
        ),
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };
    const repository = new BookingsRepository(database as any);

    const result = await repository.updatePending("booking-1", "renter-1", {
      ...createBookingRequestInput({
        contactPhoneNumber: "555-0101",
        note: "Updated booking",
        dailyPriceAmount: 150,
        estimatedTotal: 450,
        holdExpiresAt: undefined,
      }),
    });

    expect(transaction.bookingRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking-1",
        renterId: "renter-1",
        status: "pending",
        holdExpiresAt: {
          gt: new Date("2026-05-20T12:00:00.000Z"),
        },
      },
      data: expect.objectContaining({
        startAt: new Date("2026-05-01T00:00:00.000Z"),
        endAt: new Date("2026-05-04T00:00:00.000Z"),
        contactPhoneNumber: "555-0101",
        note: "Updated booking",
        dailyPriceAmount: expect.any(Prisma.Decimal),
        estimatedTotal: expect.any(Prisma.Decimal),
      }),
    });
    expect(result).toMatchObject({
      id: "booking-1",
      contactPhoneNumber: "555-0101",
      note: "Updated booking",
      dailyPriceAmount: 150,
      estimatedTotal: 450,
    });
  });

  it("returns null when a pending update does not belong to the renter or has already expired", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        id: "booking-1",
        renterId: "someone-else",
        status: "pending",
        holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "booking-1",
        renterId: "renter-1",
        status: "approved",
        holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "booking-1",
        renterId: "renter-1",
        status: "pending",
        holdExpiresAt: new Date("2026-05-19T12:00:00.000Z"),
      });
    const updateMany = jest.fn(async () => ({
      count: 1,
    }));
    const transaction = {
      bookingRequest: {
        findUnique,
        updateMany,
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };
    const repository = new BookingsRepository(database as any);
    const input = createBookingRequestInput({ holdExpiresAt: undefined });

    await expect(
      repository.updatePending("booking-1", "renter-1", input),
    ).resolves.toBeNull();
    await expect(
      repository.updatePending("booking-1", "renter-1", input),
    ).resolves.toBeNull();
    await expect(
      repository.updatePending("booking-1", "renter-1", input),
    ).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
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
    } as any);

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

  it("lists booking requests for an owner scoped to one posting", async () => {
    const findMany = jest.fn(async () => [
      createBookingRequestPersistence({
        id: "booking-owner-posting",
        status: "pending",
      }),
    ]);
    const count = jest.fn(async () => 1);
    const repository = new BookingsRepository({
      bookingRequest: {
        findMany,
        count,
      },
    } as any);

    const result = await repository.listByOwnerAndPosting({
      actorUserId: "owner-1",
      organizationId: "org-1",
      postingId: "posting-1",
      page: 1,
      pageSize: 10,
      status: "pending",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          postingId: "posting-1",
          status: "pending",
        },
      }),
    );
    expect(result).toMatchObject({
      status: "pending",
      bookingRequests: [{ id: "booking-owner-posting", status: "pending" }],
    });
  });

  it("lists booking requests for an owner across all postings", async () => {
    const findMany = jest.fn(async () => [
      createBookingRequestPersistence({
        id: "booking-owner-1",
      }),
    ]);
    const count = jest.fn(async () => 1);
    const repository = new BookingsRepository({
      bookingRequest: {
        findMany,
        count,
      },
    } as any);

    const result = await repository.listByOwner({
      actorUserId: "owner-1",
      organizationId: "org-1",
      page: 1,
      pageSize: 25,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
        },
      }),
    );
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    expect(result.bookingRequests[0]).toMatchObject({
      id: "booking-owner-1",
    });
  });

  it("lists dashboard booking requests for renters and owners", async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        createBookingRequestPersistence({
          id: "dashboard-renter",
          status: "pending",
        }),
      ])
      .mockResolvedValueOnce([
        createBookingRequestPersistence({
          id: "dashboard-owner",
          status: "approved",
          postingId: "posting-2",
          posting: {
            id: "posting-2",
            name: "Lake house",
            maxBookingDurationDays: 14,
            photos: [],
          },
        }),
      ]);
    const repository = new BookingsRepository({
      bookingRequest: {
        findMany,
      },
    } as any);

    await expect(
      repository.listDashboardByRenter({
        renterId: "renter-1",
        status: "pending",
      }),
    ).resolves.toMatchObject([{ id: "dashboard-renter", status: "pending" }]);
    await expect(
      repository.listDashboardByOwner({
        organizationId: "org-1",
        status: "approved",
        postingId: "posting-2",
      }),
    ).resolves.toMatchObject([
      {
        id: "dashboard-owner",
        status: "approved",
        posting: {
          id: "posting-2",
          effectiveMaxBookingDurationDays: 14,
        },
      },
    ]);
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          renterId: "renter-1",
          status: "pending",
        },
      }),
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          status: "approved",
          postingId: "posting-2",
        },
      }),
    );
  });

  it("checks official reservation overlap with optional exclude and renter filters", async () => {
    const findFirst = jest.fn(async () => ({
      id: "booking-2",
    }));
    const repository = new BookingsRepository({
      bookingRequest: {
        findFirst,
      },
    } as any);

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
    } as any);

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

    const repository = new BookingsRepository(database as any);
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

    const repository = new BookingsRepository(database as any);
    const result = await repository.approve(
      "booking-1",
      "org-1",
      "Approved",
      new Date("2026-05-21T12:00:00.000Z"),
    );

    expect(result).toBeNull();
  });

  it("approves a pending booking request when the dates remain available", async () => {
    const approvedAt = new Date("2026-05-20T12:00:00.000Z");
    const paymentRequiredAt = new Date("2026-05-20T12:00:00.000Z");
    const newHoldExpiresAt = new Date("2026-05-21T12:00:00.000Z");
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () =>
          createBookingRequestPersistence({
            holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
          }),
        ),
        updateMany: jest.fn(async () => ({
          count: 1,
        })),
        findUniqueOrThrow: jest.fn(async () =>
          createBookingRequestPersistence({
            status: "awaiting_payment",
            approvedAt,
            paymentRequiredAt,
            decisionNote: "Approved",
            holdExpiresAt: newHoldExpiresAt,
          }),
        ),
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

    const repository = new BookingsRepository(database as any);
    const result = await repository.approve(
      "booking-1",
      "org-1",
      "Approved",
      newHoldExpiresAt,
    );

    expect(transaction.bookingRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: "booking-1",
        organizationId: "org-1",
        status: "pending",
        holdExpiresAt: {
          gt: new Date("2026-05-20T12:00:00.000Z"),
        },
      },
      data: {
        status: "awaiting_payment",
        paymentRequiredAt: new Date("2026-05-20T12:00:00.000Z"),
        paymentFailedAt: null,
        approvedAt: new Date("2026-05-20T12:00:00.000Z"),
        decisionNote: "Approved",
        holdExpiresAt: newHoldExpiresAt,
        holdBlockId: null,
      },
    });
    expect(result).toMatchObject({
      id: "booking-1",
      status: "awaiting_payment",
      decisionNote: "Approved",
      approvedAt: approvedAt.toISOString(),
      paymentRequiredAt: paymentRequiredAt.toISOString(),
      holdExpiresAt: newHoldExpiresAt.toISOString(),
    });
  });

  it("returns null when approve targets a different organization or an expired booking request", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(
        createBookingRequestPersistence({
          organizationId: "org-2",
        }),
      )
      .mockResolvedValueOnce(
        createBookingRequestPersistence({
          status: "approved",
        }),
      )
      .mockResolvedValueOnce(
        createBookingRequestPersistence({
          holdExpiresAt: new Date("2026-05-20T11:59:00.000Z"),
        }),
      );
    const updateMany = jest.fn(async () => ({
      count: 1,
    }));
    const transaction = {
      bookingRequest: {
        findUnique,
        updateMany,
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

    const repository = new BookingsRepository(database as any);

    await expect(
      repository.approve(
        "booking-1",
        "org-1",
        "Approved",
        new Date("2026-05-21T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();
    await expect(
      repository.approve(
        "booking-1",
        "org-1",
        "Approved",
        new Date("2026-05-21T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();
    await expect(
      repository.approve(
        "booking-1",
        "org-1",
        "Approved",
        new Date("2026-05-21T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects approval when another availability block already overlaps the dates", async () => {
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () =>
          createBookingRequestPersistence({
            holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
          }),
        ),
      },
      postingAvailabilityBlock: {
        findFirst: jest.fn(async () => ({
          id: "block-2",
        })),
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };

    const repository = new BookingsRepository(database as any);

    await expect(
      repository.approve(
        "booking-1",
        "org-1",
        null,
        new Date("2026-05-21T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("returns null when approve encounters a missing record after its transactional write", async () => {
    const missingError = new Prisma.PrismaClientKnownRequestError("missing", {
      code: "P2025",
      clientVersion: "test",
    });
    const database = {
      $transaction: jest.fn(async () => {
        throw missingError;
      }),
    };
    const repository = new BookingsRepository(database as any);

    await expect(
      repository.approve(
        "booking-1",
        "org-1",
        "Approved",
        new Date("2026-05-21T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();
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

    const repository = new BookingsRepository(database as any);
    const result = await repository.decline("booking-1", "org-1", "Declined");

    expect(result).toBeNull();
  });

  it("declines a pending booking request for the matching organization", async () => {
    const declinedAt = new Date("2026-05-20T12:00:00.000Z");
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => ({
          id: "booking-1",
          organizationId: "org-1",
          status: "pending",
        })),
        updateMany: jest.fn(async () => ({
          count: 1,
        })),
        findUniqueOrThrow: jest.fn(async () =>
          createBookingRequestPersistence({
            status: "declined",
            declinedAt,
            decisionNote: "Declined",
          }),
        ),
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };

    const repository = new BookingsRepository(database as any);
    const result = await repository.decline("booking-1", "org-1", "Declined");

    expect(result).toMatchObject({
      id: "booking-1",
      status: "declined",
      decisionNote: "Declined",
      declinedAt: declinedAt.toISOString(),
    });
  });

  it("returns null when decline targets another organization or a non-pending booking request", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        id: "booking-1",
        organizationId: "org-2",
        status: "pending",
      })
      .mockResolvedValueOnce({
        id: "booking-1",
        organizationId: "org-1",
        status: "approved",
      });
    const updateMany = jest.fn(async () => ({
      count: 1,
    }));
    const transaction = {
      bookingRequest: {
        findUnique,
        updateMany,
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };
    const repository = new BookingsRepository(database as any);

    await expect(
      repository.decline("booking-1", "org-1", null),
    ).resolves.toBeNull();
    await expect(
      repository.decline("booking-1", "org-1", null),
    ).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
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

    const repository = new BookingsRepository(database as any);
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

  it("cancels a booking request and clears its hold block for an authorized owner", async () => {
    const deleteMany = jest.fn(async () => undefined);
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => ({
          id: "booking-1",
          renterId: "renter-1",
          organizationId: "org-1",
          status: "awaiting_payment",
          holdBlockId: "block-1",
          convertedAt: null,
        })),
        updateMany: jest.fn(async () => ({
          count: 1,
        })),
        findUniqueOrThrow: jest.fn(async () =>
          createBookingRequestPersistence({
            status: "cancelled",
            cancelledAt: new Date("2026-05-20T12:00:00.000Z"),
            cancelledByUserId: "owner-user-1",
            cancellationActor: "owner",
            cancellationReason: "Owner unavailable",
            cancellationPolicyCode: "strict",
            cancellationRefundAmount: new Prisma.Decimal(75),
            holdBlockId: null,
          }),
        ),
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
    const repository = new BookingsRepository(database as any);

    const result = await repository.cancel({
      bookingRequestId: "booking-1",
      actorUserId: "owner-user-1",
      actor: "owner",
      actorOrganizationId: "org-1",
      expectedStatus: "awaiting_payment",
      reason: "Owner unavailable",
      cancellationPolicyCode: "strict",
      cancellationRefundAmount: 75,
    });

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: "block-1",
      },
    });
    expect(result).toMatchObject({
      id: "booking-1",
      status: "cancelled",
      cancelledByUserId: "owner-user-1",
      cancellationActor: "owner",
      cancellationReason: "Owner unavailable",
      cancellationPolicyCode: "strict",
      cancellationRefundAmount: 75,
    });
  });

  it("returns null when cancel cannot find the booking, authorize the actor, or cancel a converted request", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "booking-1",
        renterId: "renter-1",
        organizationId: "org-1",
        status: "awaiting_payment",
        holdBlockId: null,
        convertedAt: null,
      })
      .mockResolvedValueOnce({
        id: "booking-1",
        renterId: "renter-1",
        organizationId: "org-1",
        status: "awaiting_payment",
        holdBlockId: null,
        convertedAt: new Date("2026-05-20T11:00:00.000Z"),
      });
    const updateMany = jest.fn(async () => ({
      count: 1,
    }));
    const transaction = {
      bookingRequest: {
        findUnique,
        updateMany,
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
    const repository = new BookingsRepository(database as any);

    await expect(
      repository.cancel({
        bookingRequestId: "booking-1",
        actorUserId: "owner-user-1",
        actor: "owner",
        actorOrganizationId: "org-1",
        expectedStatus: "awaiting_payment",
        cancellationPolicyCode: "strict",
        cancellationRefundAmount: 75,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.cancel({
        bookingRequestId: "booking-1",
        actorUserId: "someone-else",
        actor: "renter",
        expectedStatus: "awaiting_payment",
        cancellationPolicyCode: "strict",
        cancellationRefundAmount: 75,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.cancel({
        bookingRequestId: "booking-1",
        actorUserId: "owner-user-1",
        actor: "owner",
        actorOrganizationId: "org-1",
        expectedStatus: "awaiting_payment",
        cancellationPolicyCode: "strict",
        cancellationRefundAmount: 75,
      }),
    ).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
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

    const repository = new BookingsRepository(database as any);
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

  it("lists expired booking request candidates and normalizes nullable hold block ids", async () => {
    const findMany = jest.fn(async () => [
      {
        id: "booking-1",
        postingId: "posting-1",
        organizationId: "org-1",
        status: "pending",
        holdBlockId: null,
      },
      {
        id: "booking-2",
        postingId: "posting-2",
        organizationId: "org-2",
        status: "payment_failed",
        holdBlockId: "block-2",
      },
    ]);
    const repository = new BookingsRepository({
      bookingRequest: {
        findMany,
      },
    } as any);

    const result = await repository.listExpiredCandidates(5);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
        where: expect.objectContaining({
          convertedAt: null,
          holdExpiresAt: {
            lte: new Date("2026-05-20T12:00:00.000Z"),
          },
        }),
      }),
    );
    expect(result).toEqual([
      {
        id: "booking-1",
        postingId: "posting-1",
        organizationId: "org-1",
        status: "pending",
      },
      {
        id: "booking-2",
        postingId: "posting-2",
        organizationId: "org-2",
        status: "payment_failed",
        holdBlockId: "block-2",
      },
    ]);
  });

  it("checks blocking availability overlap with and without an excluded booking request", async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: "block-1" })
      .mockResolvedValueOnce(null as any);
    const repository = new BookingsRepository({
      postingAvailabilityBlock: {
        findFirst,
      },
    } as any);

    await expect(
      repository.hasBlockingAvailabilityOverlap({
        postingId: "posting-1",
        startAt: new Date("2026-06-01T00:00:00.000Z"),
        endAt: new Date("2026-06-03T00:00:00.000Z"),
        excludeBookingRequestId: "booking-1",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.hasBlockingAvailabilityOverlap({
        postingId: "posting-1",
        startAt: new Date("2026-06-01T00:00:00.000Z"),
        endAt: new Date("2026-06-03T00:00:00.000Z"),
      }),
    ).resolves.toBe(false);
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        postingId: "posting-1",
        startAt: {
          lt: new Date("2026-06-03T00:00:00.000Z"),
        },
        endAt: {
          gt: new Date("2026-06-01T00:00:00.000Z"),
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
                not: "booking-1",
              },
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });
  });

  it.each([
    ["cannot find the booking request", null],
    [
      "the booking request is already in a terminal status",
      {
        id: "booking-1",
        status: "paid",
        holdExpiresAt: new Date("2026-05-19T12:00:00.000Z"),
        holdBlockId: "block-1",
        convertedAt: null,
        conversionReservationExpiresAt: null,
      },
    ],
    [
      "the booking request has already been converted",
      {
        id: "booking-1",
        status: "pending",
        holdExpiresAt: new Date("2026-05-19T12:00:00.000Z"),
        holdBlockId: "block-1",
        convertedAt: new Date("2026-05-19T11:00:00.000Z"),
        conversionReservationExpiresAt: null,
      },
    ],
    [
      "the conversion reservation is still active",
      {
        id: "booking-1",
        status: "pending",
        holdExpiresAt: new Date("2026-05-19T12:00:00.000Z"),
        holdBlockId: "block-1",
        convertedAt: null,
        conversionReservationExpiresAt: new Date("2026-05-20T12:05:00.000Z"),
      },
    ],
    [
      "the hold has not expired yet",
      {
        id: "booking-1",
        status: "pending",
        holdExpiresAt: new Date("2026-05-20T12:05:00.000Z"),
        holdBlockId: "block-1",
        convertedAt: null,
        conversionReservationExpiresAt: null,
      },
    ],
  ])("does not expire a booking request when %s", async (_label, existing) => {
    const updateMany = jest.fn(async () => ({
      count: 1,
    }));
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => existing),
        updateMany,
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
    const repository = new BookingsRepository(database as any);

    await expect(repository.expire("booking-1")).resolves.toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns false when expire loses its conditional updateMany write", async () => {
    const deleteMany = jest.fn(async () => undefined);
    const updateMany = jest.fn(async () => ({
      count: 0,
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

    const repository = new BookingsRepository(database as any);

    await expect(repository.expire("booking-1")).resolves.toBe(false);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("creates a conversion reservation when the booking is available", async () => {
    const updateMany = jest.fn(async () => ({
      count: 1,
    }));
    const repository = new BookingsRepository({
      bookingRequest: {
        updateMany,
      },
    } as any);
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
    } as any);

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
    } as any);
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
