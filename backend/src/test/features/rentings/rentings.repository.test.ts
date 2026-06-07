import { Prisma } from "@prisma/client";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import { RentingsRepository } from "@/features/rentings/rentings.repository";

function createRentingPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: "renting-1",
    postingId: "posting-1",
    bookingRequestId: "booking-1",
    renterId: "renter-1",
    organizationId: "org-1",
    status: "confirmed",
    startAt: new Date("2026-06-01T00:00:00.000Z"),
    endAt: new Date("2026-06-03T00:00:00.000Z"),
    durationDays: 2,
    guestCount: 2,
    pricingCurrency: "CAD",
    pricingSnapshot: {
      currency: "CAD",
      daily: {
        amount: 120,
      },
    },
    dailyPriceAmount: new Prisma.Decimal(120),
    estimatedTotal: new Prisma.Decimal(240),
    confirmedAt: new Date("2026-05-20T12:00:00.000Z"),
    pickupInstructions: "Meet at the lobby.",
    returnInstructions: "Leave the keys in lockbox 4.",
    checkInReadyAt: null,
    checkInCompletedAt: null,
    returnDueAt: null,
    completedAt: null,
    disputedAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
    updatedAt: new Date("2026-05-19T00:00:00.000Z"),
    posting: {
      id: "posting-1",
      name: "Sunny loft",
      photos: [
        {
          blobUrl: "https://example.test/posting-1.jpg",
        },
      ],
    },
    dispute: null,
    ...overrides,
  };
}

function createPaidBookingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    postingId: "posting-1",
    renterId: "renter-1",
    organizationId: "org-1",
    status: "paid",
    startAt: new Date("2026-06-01T00:00:00.000Z"),
    endAt: new Date("2026-06-03T00:00:00.000Z"),
    durationDays: 2,
    guestCount: 2,
    pricingCurrency: "CAD",
    pricingSnapshot: {
      currency: "CAD",
      daily: {
        amount: 120,
      },
    },
    dailyPriceAmount: new Prisma.Decimal(120),
    estimatedTotal: new Prisma.Decimal(240),
    holdBlockId: "block-1",
    convertedAt: null,
    conversionReservationExpiresAt: new Date("2026-05-20T12:10:00.000Z"),
    posting: {
      id: "posting-1",
      name: "Sunny loft",
      photos: [
        {
          blobUrl: "https://example.test/posting-1.jpg",
        },
      ],
    },
    renting: null,
    ...overrides,
  };
}

describe("RentingsRepository", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("converts a paid booking request into a confirmed renting and clears the hold block", async () => {
    const deleteMany = jest.fn(async () => undefined);
    const createBlock = jest.fn(async () => ({
      id: "block-2",
    }));
    const updateBooking = jest.fn(async () => undefined);
    const createdRenting = createRentingPersistence({
      status: "confirmed",
    });
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => createPaidBookingRequest()),
        update: updateBooking,
      },
      renting: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => createdRenting),
      },
      postingAvailabilityBlock: {
        deleteMany,
        create: createBlock,
      },
    };
    const database = {
      $transaction: async <T>(
        callback: (client: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    };

    const repository = new RentingsRepository(database as never);
    const result = await repository.convertApprovedBookingRequest(
      "booking-1",
      "org-1",
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: "block-1",
      },
    });
    expect(createBlock).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        postingId: "posting-1",
        startAt: new Date("2026-06-01T00:00:00.000Z"),
        endAt: new Date("2026-06-03T00:00:00.000Z"),
        note: "Renting confirmed from booking request: booking-1",
        source: "renting",
      },
    });
    expect(updateBooking).toHaveBeenCalledWith({
      where: {
        id: "booking-1",
      },
      data: {
        convertedAt: new Date("2026-05-20T12:00:00.000Z"),
        conversionReservedAt: null,
        conversionReservationExpiresAt: null,
        holdBlockId: null,
      },
    });
    expect(result).toMatchObject({
      id: "renting-1",
      status: "confirmed",
      posting: {
        id: "posting-1",
        primaryPhotoUrl: "https://example.test/posting-1.jpg",
      },
    });
  });

  it("maps a duplicate bookingRequestId unique constraint to ConflictError", async () => {
    const error = Object.assign(new Error("duplicate renting"), {
      code: "P2002",
      clientVersion: "test",
    });
    Object.setPrototypeOf(
      error,
      Prisma.PrismaClientKnownRequestError.prototype,
    );

    const database = {
      $transaction: async () => {
        throw error;
      },
    };

    const repository = new RentingsRepository(database as never);

    await expect(
      repository.convertApprovedBookingRequest("booking-1", "owner-1"),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("lists my rentings with organization scope and pagination", async () => {
    const findMany = jest.fn(async () => [createRentingPersistence()]);
    const count = jest.fn(async () => 3);
    const repository = new RentingsRepository({
      renting: {
        findMany,
        count,
      },
    } as never);

    const result = await repository.listMine({
      userId: "renter-1",
      organizationId: "org-1",
      page: 2,
      pageSize: 2,
      status: "confirmed",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ renterId: "renter-1" }, { organizationId: "org-1" }],
          status: "confirmed",
        },
        skip: 2,
        take: 2,
      }),
    );
    expect(result.rentings[0]).toMatchObject({
      id: "renting-1",
      dailyPriceAmount: 120,
      estimatedTotal: 240,
    });
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(result.status).toBe("confirmed");
  });

  it("finds a renting by id and maps optional photo and dispute fields", async () => {
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () =>
          createRentingPersistence({
            posting: {
              id: "posting-1",
              name: "Sunny loft",
              photos: [],
            },
            dispute: {
              id: "dispute-1",
              rentingId: "renting-1",
              openedByUserId: "moderator-1",
              reason: "damage",
              details: null,
              createdAt: new Date("2026-05-20T12:00:00.000Z"),
              updatedAt: new Date("2026-05-20T12:05:00.000Z"),
            },
          }),
        ),
      },
    } as never);

    const result = await repository.findById("renting-1");

    expect(result).toMatchObject({
      id: "renting-1",
      posting: {
        id: "posting-1",
        name: "Sunny loft",
        primaryPhotoUrl: undefined,
      },
      dispute: {
        id: "dispute-1",
        reason: "damage",
        details: undefined,
      },
    });
  });

  it("returns null when a renting lookup misses", async () => {
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () => null),
      },
    } as never);

    await expect(repository.findById("missing-renting")).resolves.toBeNull();
  });

  it("lists renter dashboard rentings", async () => {
    const findMany = jest.fn(async () => [createRentingPersistence()]);
    const repository = new RentingsRepository({
      renting: {
        findMany,
      },
    } as never);

    const result = await repository.listByRenterForDashboard("renter-1");

    expect(findMany).toHaveBeenCalledWith({
      where: {
        renterId: "renter-1",
      },
      orderBy: [{ startAt: "asc" }, { createdAt: "desc" }],
      include: expect.any(Object),
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "renting-1",
      posting: {
        primaryPhotoUrl: "https://example.test/posting-1.jpg",
      },
    });
  });

  it("lists owner dashboard rentings without a posting filter", async () => {
    const findMany = jest.fn(async () => [createRentingPersistence()]);
    const repository = new RentingsRepository({
      renting: {
        findMany,
      },
    } as never);

    const result = await repository.listByOwnerForDashboard({
      organizationId: "org-1",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
      },
      orderBy: [{ startAt: "asc" }, { createdAt: "desc" }],
      include: expect.any(Object),
    });
    expect(result).toHaveLength(1);
    expect(result[0].organizationId).toBe("org-1");
  });

  it("updates instructions for an existing renting", async () => {
    const update = jest.fn(async () =>
      createRentingPersistence({
        pickupInstructions: "Call from the curb.",
        returnInstructions: "Return to concierge desk.",
      }),
    );
    const repository = new RentingsRepository({
      renting: {
        update,
      },
    } as never);

    const result = await repository.updateInstructions({
      rentingId: "renting-1",
      pickupInstructions: "Call from the curb.",
      returnInstructions: "Return to concierge desk.",
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "renting-1",
      },
      data: {
        pickupInstructions: "Call from the curb.",
        returnInstructions: "Return to concierge desk.",
      },
      include: expect.any(Object),
    });
    expect(result).toMatchObject({
      id: "renting-1",
      pickupInstructions: "Call from the curb.",
      returnInstructions: "Return to concierge desk.",
    });
  });

  it("returns null when updating instructions for a missing renting", async () => {
    const error = Object.assign(new Error("record not found"), {
      code: "P2025",
      clientVersion: "test",
    });
    Object.setPrototypeOf(
      error,
      Prisma.PrismaClientKnownRequestError.prototype,
    );

    const repository = new RentingsRepository({
      renting: {
        update: jest.fn(async () => {
          throw error;
        }),
      },
    } as never);

    await expect(
      repository.updateInstructions({
        rentingId: "missing-renting",
        pickupInstructions: "Meet outside.",
        returnInstructions: "Leave with the doorman.",
      }),
    ).resolves.toBeNull();
  });

  it("marks a confirmed renting as check-in ready", async () => {
    const update = jest.fn(async () =>
      createRentingPersistence({
        status: "check_in_ready",
        checkInReadyAt: new Date("2026-05-20T12:00:00.000Z"),
      }),
    );
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () => createRentingPersistence()),
        update,
      },
    } as never);

    const result = await repository.markCheckInReady(
      "renting-1",
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "renting-1",
      },
      data: {
        status: "check_in_ready",
        checkInReadyAt: new Date("2026-05-20T12:00:00.000Z"),
      },
      include: expect.any(Object),
    });
    expect(result?.status).toBe("check_in_ready");
  });

  it("rejects check-in readiness when instructions are missing", async () => {
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () =>
          createRentingPersistence({
            pickupInstructions: null,
          }),
        ),
      },
    } as never);

    await expect(
      repository.markCheckInReady(
        "renting-1",
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("returns null when marking check-in complete for a missing renting", async () => {
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () => null),
      },
    } as never);

    await expect(
      repository.markCheckInComplete(
        "missing-renting",
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();
  });

  it("checks in an upcoming renting and backfills check-in-ready time", async () => {
    const update = jest.fn(async () =>
      createRentingPersistence({
        status: "active",
        checkInReadyAt: new Date("2026-05-20T12:00:00.000Z"),
        checkInCompletedAt: new Date("2026-05-20T12:00:00.000Z"),
      }),
    );
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () =>
          createRentingPersistence({
            status: "confirmed",
            checkInReadyAt: null,
          }),
        ),
        update,
      },
    } as never);

    const result = await repository.markCheckInComplete(
      "renting-1",
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "renting-1",
      },
      data: {
        status: "active",
        checkInReadyAt: new Date("2026-05-20T12:00:00.000Z"),
        checkInCompletedAt: new Date("2026-05-20T12:00:00.000Z"),
        returnDueAt: null,
      },
      include: expect.any(Object),
    });
    expect(result?.status).toBe("active");
  });

  it("rejects check-in completion for a non-upcoming renting", async () => {
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () =>
          createRentingPersistence({
            status: "active",
          }),
        ),
      },
    } as never);

    await expect(
      repository.markCheckInComplete(
        "renting-1",
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("returns null when marking a missing renting as completed", async () => {
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () => null),
      },
    } as never);

    await expect(
      repository.markCompleted(
        "missing-renting",
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();
  });

  it("marks an active renting as completed and records return due when overdue", async () => {
    const update = jest.fn(async () =>
      createRentingPersistence({
        status: "completed",
        endAt: new Date("2026-05-19T12:00:00.000Z"),
        returnDueAt: new Date("2026-05-20T12:00:00.000Z"),
        completedAt: new Date("2026-05-20T12:00:00.000Z"),
      }),
    );
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () =>
          createRentingPersistence({
            status: "active",
            endAt: new Date("2026-05-19T12:00:00.000Z"),
            returnDueAt: null,
          }),
        ),
        update,
      },
    } as never);

    const result = await repository.markCompleted(
      "renting-1",
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "renting-1",
      },
      data: {
        status: "completed",
        returnDueAt: new Date("2026-05-20T12:00:00.000Z"),
        completedAt: new Date("2026-05-20T12:00:00.000Z"),
      },
      include: expect.any(Object),
    });
    expect(result?.status).toBe("completed");
  });

  it("preserves return-due timing when completing a return-due renting", async () => {
    const existingReturnDueAt = new Date("2026-05-19T18:00:00.000Z");
    const update = jest.fn(async () =>
      createRentingPersistence({
        status: "completed",
        returnDueAt: existingReturnDueAt,
        completedAt: new Date("2026-05-20T12:00:00.000Z"),
      }),
    );
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () =>
          createRentingPersistence({
            status: "return_due",
            returnDueAt: existingReturnDueAt,
          }),
        ),
        update,
      },
    } as never);

    await repository.markCompleted(
      "renting-1",
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "renting-1",
      },
      data: {
        status: "completed",
        returnDueAt: existingReturnDueAt,
        completedAt: new Date("2026-05-20T12:00:00.000Z"),
      },
      include: expect.any(Object),
    });
  });

  it("rejects completion for a renting that is not active or return-due", async () => {
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () =>
          createRentingPersistence({
            status: "confirmed",
          }),
        ),
      },
    } as never);

    await expect(
      repository.markCompleted(
        "renting-1",
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("returns null when opening a dispute for a missing renting", async () => {
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () => null),
      },
      $transaction: jest.fn(),
    } as never);

    await expect(
      repository.createDispute(
        {
          rentingId: "missing-renting",
          actorUserId: "moderator-1",
          reason: "damage",
        },
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();
  });

  it("opens a dispute and transitions the renting to disputed", async () => {
    const createDispute = jest.fn(async () => undefined);
    const update = jest.fn(async () =>
      createRentingPersistence({
        status: "disputed",
        disputedAt: new Date("2026-05-20T12:00:00.000Z"),
        dispute: {
          id: "dispute-1",
          rentingId: "renting-1",
          openedByUserId: "moderator-1",
          reason: "damage",
          details: "Cracked lamp base.",
          createdAt: new Date("2026-05-20T12:00:00.000Z"),
          updatedAt: new Date("2026-05-20T12:00:00.000Z"),
        },
      }),
    );
    const database = {
      renting: {
        findUnique: jest.fn(async () =>
          createRentingPersistence({
            status: "active",
          }),
        ),
      },
      $transaction: async <T>(
        callback: (client: {
          rentingDispute: { create: typeof createDispute };
          renting: { update: typeof update };
        }) => Promise<T>,
      ) =>
        callback({
          rentingDispute: {
            create: createDispute,
          },
          renting: {
            update,
          },
        }),
    };

    const repository = new RentingsRepository(database as never);
    const result = await repository.createDispute(
      {
        rentingId: "renting-1",
        actorUserId: "moderator-1",
        reason: "damage",
        details: "Cracked lamp base.",
      },
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(createDispute).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        rentingId: "renting-1",
        openedByUserId: "moderator-1",
        reason: "damage",
        details: "Cracked lamp base.",
        createdAt: new Date("2026-05-20T12:00:00.000Z"),
      },
    });
    expect(result).toMatchObject({
      status: "disputed",
      dispute: {
        id: "dispute-1",
        reason: "damage",
      },
    });
  });

  it("rejects opening a second dispute for the same renting", async () => {
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () =>
          createRentingPersistence({
            dispute: {
              id: "dispute-1",
              rentingId: "renting-1",
              openedByUserId: "moderator-1",
              reason: "damage",
              details: "Cracked lamp base.",
              createdAt: new Date("2026-05-20T12:00:00.000Z"),
              updatedAt: new Date("2026-05-20T12:00:00.000Z"),
            },
          }),
        ),
      },
      $transaction: jest.fn(),
    } as never);

    await expect(
      repository.createDispute(
        {
          rentingId: "renting-1",
          actorUserId: "moderator-2",
          reason: "damage",
        },
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("checks overlap while excluding the current renting when requested", async () => {
    const findFirst = jest.fn(async () => ({
      id: "renting-2",
    }));
    const repository = new RentingsRepository({
      renting: {
        findFirst,
      },
    } as never);

    const result = await repository.hasOverlap(
      "posting-1",
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-03T00:00:00.000Z"),
      "renting-1",
    );

    expect(result).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        postingId: "posting-1",
        status: {
          not: "cancelled",
        },
        id: {
          not: "renting-1",
        },
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

  it("updates return-due transitions for a single renting", async () => {
    const updateMany = jest.fn(async () => ({
      count: 1,
    }));
    const repository = new RentingsRepository({
      renting: {
        updateMany,
      },
    } as never);

    await repository.promoteReturnDueForRenting(
      "renting-1",
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "renting-1",
        status: "active",
        endAt: {
          lte: new Date("2026-05-20T12:00:00.000Z"),
        },
      },
      data: {
        status: "return_due",
        returnDueAt: new Date("2026-05-20T12:00:00.000Z"),
      },
    });
  });

  it("updates return-due transitions for a renter", async () => {
    const updateMany = jest.fn(async () => ({
      count: 2,
    }));
    const repository = new RentingsRepository({
      renting: {
        updateMany,
      },
    } as never);

    await repository.promoteReturnDueForUser(
      "renter-1",
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        renterId: "renter-1",
        status: "active",
        endAt: {
          lte: new Date("2026-05-20T12:00:00.000Z"),
        },
      },
      data: {
        status: "return_due",
        returnDueAt: new Date("2026-05-20T12:00:00.000Z"),
      },
    });
  });

  it("updates owner-scoped return-due transitions with an optional posting filter", async () => {
    const updateMany = jest.fn(async () => ({
      count: 2,
    }));
    const repository = new RentingsRepository({
      renting: {
        updateMany,
      },
    } as never);

    await repository.promoteReturnDueForOwner(
      {
        organizationId: "org-1",
        postingId: "posting-1",
      },
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        postingId: "posting-1",
        status: "active",
        endAt: {
          lte: new Date("2026-05-20T12:00:00.000Z"),
        },
      },
      data: {
        status: "return_due",
        returnDueAt: new Date("2026-05-20T12:00:00.000Z"),
      },
    });
  });

  it("queries for a completed non-disputed renting when checking review eligibility", async () => {
    const now = new Date("2026-04-23T12:00:00.000Z");
    const findFirst = jest.fn(async () => ({
      id: "renting-1",
    }));
    const database = {
      renting: {
        findFirst,
      },
    };
    const repository = new RentingsRepository(database as never);

    const result = await repository.hasEligibleReviewRenting({
      postingId: "posting-1",
      renterId: "renter-1",
      now,
    });

    expect(result).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        postingId: "posting-1",
        renterId: "renter-1",
        status: "completed",
        completedAt: {
          lte: now,
        },
        dispute: null,
      },
      select: {
        id: true,
      },
    });
  });
});
