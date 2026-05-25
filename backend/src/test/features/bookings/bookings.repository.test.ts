import { Prisma } from "@prisma/client";
import { BookingsRepository } from "@/features/bookings/bookings.repository";

describe("BookingsRepository", () => {
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
        findUnique: jest.fn(async () => ({
          id: "booking-1",
          ownerId: "owner-1",
          status: "pending",
          holdExpiresAt: new Date("2099-04-21T00:00:00.000Z"),
          postingId: "posting-1",
          startAt: new Date("2026-05-01T00:00:00.000Z"),
          endAt: new Date("2026-05-04T00:00:00.000Z"),
        })),
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
      "owner-1",
      "approved",
      new Date("2099-04-24T00:00:00.000Z"),
    );

    expect(result).toBeNull();
  });

  it("returns null when decline loses its conditional updateMany write", async () => {
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => ({
          id: "booking-1",
          ownerId: "owner-1",
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
    const result = await repository.decline("booking-1", "owner-1", "declined");

    expect(result).toBeNull();
  });

  it("returns null when cancel loses its conditional updateMany write", async () => {
    const transaction = {
      bookingRequest: {
        findUnique: jest.fn(async () => ({
          id: "booking-1",
          renterId: "renter-1",
          ownerId: "owner-1",
          status: "paid",
          holdBlockId: "block-1",
          convertedAt: null,
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
    const result = await repository.cancel({
      bookingRequestId: "booking-1",
      actorUserId: "renter-1",
      actor: "renter",
      expectedStatus: "paid",
      reason: "Plans changed",
      cancellationPolicyCode: "platform_default_v1",
      cancellationRefundAmount: 110,
    });

    expect(result).toBeNull();
  });
});
