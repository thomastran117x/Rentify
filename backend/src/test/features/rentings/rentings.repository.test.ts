import { Prisma } from "@/generated/prisma/client";
import BadRequestError from "@/errors/http/bad-request.error";
import ConflictError from "@/errors/http/conflict.error";
import { RentingsRepository } from "@/features/rentings/rentings.repository";
import { testUuid } from "../../support/uuid";
const BOOKING_1_ID = testUuid(9000, 996753);
const MISSING_RENTING_ID = testUuid(9000, 882345);
const OWNER_1_ID = testUuid(9000, 219201);
const POSTING_1_ID = testUuid(9000, 254272);
const RENTER_1_ID = testUuid(9000, 235000);
const RENTING_1_ID = testUuid(9000, 915753);

const MODERATOR_1_ID = testUuid(9000, 903590);
const MODERATOR_2_ID = testUuid(9000, 903591);
const ORG_1_ID = testUuid(9000, 9234);

function createRentingPersistence(overrides: Record<string, unknown> = {}) {
  return {
    id: RENTING_1_ID,
    postingId: POSTING_1_ID,
    bookingRequestId: BOOKING_1_ID,
    renterId: RENTER_1_ID,
    organizationId: ORG_1_ID,
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
      id: POSTING_1_ID,
      name: "Sunny loft",
      photos: [
        {
          blobUrl: `https://example.test/${POSTING_1_ID}.jpg`,
        },
      ],
    },
    dispute: null,
    ...overrides,
  };
}

function createPaidBookingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_1_ID,
    postingId: POSTING_1_ID,
    renterId: RENTER_1_ID,
    organizationId: ORG_1_ID,
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
      id: POSTING_1_ID,
      name: "Sunny loft",
      photos: [
        {
          blobUrl: `https://example.test/${POSTING_1_ID}.jpg`,
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

    const repository = new RentingsRepository(database as any);
    const result = await repository.convertApprovedBookingRequest(
      BOOKING_1_ID,
      ORG_1_ID,
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: "block-1",
      },
    });
    expect(createBlock).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        postingId: POSTING_1_ID,
        startAt: new Date("2026-06-01T00:00:00.000Z"),
        endAt: new Date("2026-06-03T00:00:00.000Z"),
        note: `Renting confirmed from booking request: ${BOOKING_1_ID}`,
        source: "renting",
      },
    });
    expect(updateBooking).toHaveBeenCalledWith({
      where: {
        id: BOOKING_1_ID,
      },
      data: {
        convertedAt: new Date("2026-05-20T12:00:00.000Z"),
        conversionReservedAt: null,
        conversionReservationExpiresAt: null,
        holdBlockId: null,
      },
    });
    expect(result).toMatchObject({
      id: RENTING_1_ID,
      status: "confirmed",
      posting: {
        id: POSTING_1_ID,
        primaryPhotoUrl: `https://example.test/${POSTING_1_ID}.jpg`,
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

    const repository = new RentingsRepository(database as any);

    await expect(
      repository.convertApprovedBookingRequest(BOOKING_1_ID, OWNER_1_ID),
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
    } as any);

    const result = await repository.listMine({
      userId: RENTER_1_ID,
      organizationId: ORG_1_ID,
      page: 2,
      pageSize: 2,
      status: "confirmed",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ renterId: RENTER_1_ID }, { organizationId: ORG_1_ID }],
          status: "confirmed",
        },
        skip: 2,
        take: 2,
      }),
    );
    expect(result.rentings[0]).toMatchObject({
      id: RENTING_1_ID,
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
              id: POSTING_1_ID,
              name: "Sunny loft",
              photos: [],
            },
            dispute: {
              id: "dispute-1",
              rentingId: RENTING_1_ID,
              openedByUserId: MODERATOR_1_ID,
              reason: "damage",
              details: null,
              createdAt: new Date("2026-05-20T12:00:00.000Z"),
              updatedAt: new Date("2026-05-20T12:05:00.000Z"),
            },
          }),
        ),
      },
    } as any);

    const result = await repository.findById(RENTING_1_ID);

    expect(result).toMatchObject({
      id: RENTING_1_ID,
      posting: {
        id: POSTING_1_ID,
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
    } as any);

    await expect(repository.findById(MISSING_RENTING_ID)).resolves.toBeNull();
  });

  it("lists renter dashboard rentings", async () => {
    const findMany = jest.fn(async () => [createRentingPersistence()]);
    const repository = new RentingsRepository({
      renting: {
        findMany,
      },
    } as any);

    const result = await repository.listByRenterForDashboard(RENTER_1_ID);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        renterId: RENTER_1_ID,
      },
      orderBy: [{ startAt: "asc" }, { createdAt: "desc" }],
      include: expect.any(Object),
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: RENTING_1_ID,
      posting: {
        primaryPhotoUrl: `https://example.test/${POSTING_1_ID}.jpg`,
      },
    });
  });

  it("lists owner dashboard rentings without a posting filter", async () => {
    const findMany = jest.fn(async () => [createRentingPersistence()]);
    const repository = new RentingsRepository({
      renting: {
        findMany,
      },
    } as any);

    const result = await repository.listByOwnerForDashboard({
      organizationId: ORG_1_ID,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_1_ID,
      },
      orderBy: [{ startAt: "asc" }, { createdAt: "desc" }],
      include: expect.any(Object),
    });
    expect(result).toHaveLength(1);
    expect(result[0].organizationId).toBe(ORG_1_ID);
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
    } as any);

    const result = await repository.updateInstructions({
      rentingId: RENTING_1_ID,
      actorUserId: OWNER_1_ID,
      actorRole: "owner",
      pickupInstructions: "Call from the curb.",
      returnInstructions: "Return to concierge desk.",
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        id: RENTING_1_ID,
      },
      data: {
        pickupInstructions: "Call from the curb.",
        returnInstructions: "Return to concierge desk.",
      },
      include: expect.any(Object),
    });
    expect(result).toMatchObject({
      id: RENTING_1_ID,
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
    } as any);

    await expect(
      repository.updateInstructions({
        rentingId: MISSING_RENTING_ID,
        actorUserId: OWNER_1_ID,
        actorRole: "owner",
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
    } as any);

    const result = await repository.markCheckInReady(
      RENTING_1_ID,
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        id: RENTING_1_ID,
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
    } as any);

    await expect(
      repository.markCheckInReady(
        RENTING_1_ID,
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("returns null when marking check-in complete for a missing renting", async () => {
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () => null),
      },
    } as any);

    await expect(
      repository.markCheckInComplete(
        MISSING_RENTING_ID,
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
    } as any);

    const result = await repository.markCheckInComplete(
      RENTING_1_ID,
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        id: RENTING_1_ID,
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
    } as any);

    await expect(
      repository.markCheckInComplete(
        RENTING_1_ID,
        new Date("2026-05-20T12:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("returns null when marking a missing renting as completed", async () => {
    const repository = new RentingsRepository({
      renting: {
        findUnique: jest.fn(async () => null),
      },
    } as any);

    await expect(
      repository.markCompleted(
        MISSING_RENTING_ID,
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
    } as any);

    const result = await repository.markCompleted(
      RENTING_1_ID,
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        id: RENTING_1_ID,
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
    } as any);

    await repository.markCompleted(
      RENTING_1_ID,
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: {
        id: RENTING_1_ID,
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
    } as any);

    await expect(
      repository.markCompleted(
        RENTING_1_ID,
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
    } as any);

    await expect(
      repository.createDispute(
        {
          rentingId: MISSING_RENTING_ID,
          actorUserId: MODERATOR_1_ID,
          actorRole: "moderator",
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
          rentingId: RENTING_1_ID,
          openedByUserId: MODERATOR_1_ID,
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

    const repository = new RentingsRepository(database as any);
    const result = await repository.createDispute(
      {
        rentingId: RENTING_1_ID,
        actorUserId: MODERATOR_1_ID,
        actorRole: "moderator",
        reason: "damage",
        details: "Cracked lamp base.",
      },
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(createDispute).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        rentingId: RENTING_1_ID,
        openedByUserId: MODERATOR_1_ID,
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
              rentingId: RENTING_1_ID,
              openedByUserId: MODERATOR_1_ID,
              reason: "damage",
              details: "Cracked lamp base.",
              createdAt: new Date("2026-05-20T12:00:00.000Z"),
              updatedAt: new Date("2026-05-20T12:00:00.000Z"),
            },
          }),
        ),
      },
      $transaction: jest.fn(),
    } as any);

    await expect(
      repository.createDispute(
        {
          rentingId: RENTING_1_ID,
          actorUserId: MODERATOR_2_ID,
          actorRole: "moderator",
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
    } as any);

    const result = await repository.hasOverlap(
      POSTING_1_ID,
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-03T00:00:00.000Z"),
      RENTING_1_ID,
    );

    expect(result).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        postingId: POSTING_1_ID,
        status: {
          not: "cancelled",
        },
        id: {
          not: RENTING_1_ID,
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
    } as any);

    await repository.promoteReturnDueForRenting(
      RENTING_1_ID,
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: RENTING_1_ID,
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
    } as any);

    await repository.promoteReturnDueForUser(
      RENTER_1_ID,
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        renterId: RENTER_1_ID,
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
    } as any);

    await repository.promoteReturnDueForOwner(
      {
        organizationId: ORG_1_ID,
        postingId: POSTING_1_ID,
      },
      new Date("2026-05-20T12:00:00.000Z"),
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_1_ID,
        postingId: POSTING_1_ID,
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
      id: RENTING_1_ID,
    }));
    const database = {
      renting: {
        findFirst,
      },
    };
    const repository = new RentingsRepository(database as any);

    const result = await repository.hasEligibleReviewRenting({
      postingId: POSTING_1_ID,
      renterId: RENTER_1_ID,
      now,
    });

    expect(result).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        postingId: POSTING_1_ID,
        renterId: RENTER_1_ID,
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

  it("queries for a completed non-disputed renting when checking organization review eligibility", async () => {
    const now = new Date("2026-04-23T12:00:00.000Z");
    const findFirst = jest.fn(async () => ({
      id: RENTING_1_ID,
    }));
    const database = {
      renting: {
        findFirst,
      },
    };
    const repository = new RentingsRepository(database as any);

    const result = await repository.hasEligibleReviewRentingForOrganization({
      organizationId: ORG_1_ID,
      renterId: RENTER_1_ID,
      now,
    });

    expect(result).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_1_ID,
        renterId: RENTER_1_ID,
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

  it("returns false when there is no eligible organization renting", async () => {
    const findFirst = jest.fn(async () => null);
    const database = {
      renting: {
        findFirst,
      },
    };
    const repository = new RentingsRepository(database as any);

    const result = await repository.hasEligibleReviewRentingForOrganization({
      organizationId: ORG_1_ID,
      renterId: RENTER_1_ID,
      now: new Date("2026-04-23T12:00:00.000Z"),
    });

    expect(result).toBe(false);
  });
});
