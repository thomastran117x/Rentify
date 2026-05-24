import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import type { CacheService } from "@/features/cache/cache.service";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import { RentingsService } from "@/features/rentings/rentings.service";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";
import ForbiddenError from "@/errors/http/forbidden.error";
import BadRequestError from "@/errors/http/bad-request.error";

function createRentingRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "renting-1",
    postingId: "posting-1",
    ownerId: "owner-1",
    renterId: "renter-1",
    bookingRequestId: "booking-1",
    status: "confirmed",
    startAt: "2026-05-01T00:00:00.000Z",
    endAt: "2026-05-04T00:00:00.000Z",
    durationDays: 3,
    guestCount: 2,
    pricingCurrency: "CAD",
    pricingSnapshot: {
      currency: "CAD",
      daily: {
        amount: 120,
      },
    },
    dailyPriceAmount: 120,
    estimatedTotal: 360,
    confirmedAt: "2026-04-23T00:00:00.000Z",
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
    posting: {
      id: "posting-1",
      name: "City loft",
    },
    ...overrides,
  };
}

describe("RentingsService", () => {
  it("releases only the reservation it acquired when conversion fails", async () => {
    const reservation = {
      reservedAt: new Date("2026-04-23T00:00:00.000Z"),
      reservationExpiresAt: new Date("2026-04-23T00:05:00.000Z"),
    };
    const bookingsRepository = {
      findById: jest.fn(async () => ({
        id: "booking-1",
        postingId: "posting-1",
        ownerId: "owner-1",
      })),
      reserveForConversion: jest.fn(async () => reservation),
      releaseConversionReservation: jest.fn(async () => undefined),
    } as unknown as BookingsRepository;
    const rentingsRepository = {
      convertApprovedBookingRequest: jest.fn(async () => {
        throw new Error("boom");
      }),
    } as unknown as RentingsRepository;
    const analyticsRepository = {
      enqueueRentingConfirmedEvent: jest.fn(async () => undefined),
    } as unknown as PostingsAnalyticsRepository;
    const postingsRepository = {
      findById: jest.fn(async () => ({
        id: "posting-1",
        status: "published",
      })),
      enqueueSearchSync: jest.fn(async () => undefined),
    } as unknown as PostingsRepository;
    const cacheService = {
      acquireLock: jest.fn(async (key: string) => ({
        key,
        token: `${key}-token`,
        release: jest.fn(async () => true),
        extend: jest.fn(async () => true),
      })),
    } as unknown as CacheService;
    const postingsPublicCacheService = {
      invalidatePublic: jest.fn(async () => 1),
    } as unknown as PostingsPublicCacheService;

    const service = new RentingsService(
      rentingsRepository,
      bookingsRepository,
      analyticsRepository,
      postingsRepository,
      cacheService,
      postingsPublicCacheService,
    );

    await expect(
      service.convertApprovedBookingRequest({
        bookingRequestId: "booking-1",
        ownerId: "owner-1",
      }),
    ).rejects.toThrow("boom");

    expect(
      (bookingsRepository.releaseConversionReservation as unknown as jest.Mock).mock.calls[0],
    ).toEqual(["booking-1", "owner-1", reservation]);
    expect((postingsRepository.enqueueSearchSync as unknown as jest.Mock).mock.calls).toEqual([
      ["posting-1"],
      ["posting-1"],
    ]);
    expect((postingsPublicCacheService.invalidatePublic as unknown as jest.Mock).mock.calls).toEqual([
      ["posting-1"],
      ["posting-1"],
    ]);
    expect((cacheService.acquireLock as unknown as jest.Mock).mock.calls.map(([key]) => key)).toEqual([
      "booking-request:booking-1:convert",
      "posting:posting-1:booking-window",
    ]);
  });

  it("allows conversion to renting while the posting is paused", async () => {
    const bookingsRepository = {
      findById: jest.fn(async () => ({
        id: "booking-1",
        postingId: "posting-1",
        ownerId: "owner-1",
      })),
      reserveForConversion: jest.fn(async () => ({
        reservedAt: new Date("2026-04-23T00:00:00.000Z"),
        reservationExpiresAt: new Date("2026-04-23T00:05:00.000Z"),
      })),
      releaseConversionReservation: jest.fn(async () => undefined),
    } as unknown as BookingsRepository;
    const rentingsRepository = {
      convertApprovedBookingRequest: jest.fn(async () => ({
        id: "renting-1",
        postingId: "posting-1",
        ownerId: "owner-1",
        renterId: "renter-1",
        bookingRequestId: "booking-1",
        status: "confirmed",
        startAt: "2026-05-01T00:00:00.000Z",
        endAt: "2026-05-04T00:00:00.000Z",
        durationDays: 3,
        guestCount: 2,
        pricingCurrency: "CAD",
        pricingSnapshot: {
          currency: "CAD",
          daily: {
            amount: 120,
          },
        },
        dailyPriceAmount: 120,
        estimatedTotal: 360,
        confirmedAt: "2026-04-23T00:00:00.000Z",
        createdAt: "2026-04-23T00:00:00.000Z",
        updatedAt: "2026-04-23T00:00:00.000Z",
        posting: {
          id: "posting-1",
          name: "City loft",
        },
      })),
    } as unknown as RentingsRepository;
    const analyticsRepository = {
      enqueueRentingConfirmedEvent: jest.fn(async () => undefined),
    } as unknown as PostingsAnalyticsRepository;
    const postingsRepository = {
      findById: jest.fn(async () => ({
        id: "posting-1",
        status: "paused",
        archivedAt: undefined,
      })),
      enqueueSearchSync: jest.fn(async () => undefined),
    } as unknown as PostingsRepository;
    const cacheService = {
      acquireLock: jest.fn(async (key: string) => ({
        key,
        token: `${key}-token`,
        release: jest.fn(async () => true),
        extend: jest.fn(async () => true),
      })),
    } as unknown as CacheService;
    const postingsPublicCacheService = {
      invalidatePublic: jest.fn(async () => 1),
    } as unknown as PostingsPublicCacheService;

    const service = new RentingsService(
      rentingsRepository,
      bookingsRepository,
      analyticsRepository,
      postingsRepository,
      cacheService,
      postingsPublicCacheService,
    );

    const renting = await service.convertApprovedBookingRequest({
      bookingRequestId: "booking-1",
      ownerId: "owner-1",
    });

    expect(renting.id).toBe("renting-1");
    expect(
      (rentingsRepository.convertApprovedBookingRequest as unknown as jest.Mock),
    ).toHaveBeenCalledWith("booking-1", "owner-1");
    expect((postingsRepository.enqueueSearchSync as unknown as jest.Mock).mock.calls).toEqual([
      ["posting-1"],
      ["posting-1"],
    ]);
    expect((postingsPublicCacheService.invalidatePublic as unknown as jest.Mock).mock.calls).toEqual([
      ["posting-1"],
      ["posting-1"],
    ]);
  });

  it("promotes ended active rentings to return_due when reading a renting", async () => {
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () =>
        createRentingRecord({
          status: "return_due",
          endAt: "2026-04-20T00:00:00.000Z",
          returnDueAt: "2026-04-20T00:00:00.000Z",
        }),
      ),
    } as unknown as RentingsRepository;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.getById("renting-1", "renter-1", "user");

    expect((rentingsRepository.promoteReturnDueForRenting as unknown as jest.Mock)).toHaveBeenCalled();
    expect(result.status).toBe("return_due");
  });

  it("rejects renters trying to update instructions", async () => {
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () => createRentingRecord()),
    } as unknown as RentingsRepository;
    const cacheService = {
      acquireLock: jest.fn(async (key: string) => ({
        key,
        token: `${key}-token`,
        release: jest.fn(async () => true),
        extend: jest.fn(async () => true),
      })),
    } as unknown as CacheService;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      cacheService,
      {} as never,
    );

    await expect(
      service.updateInstructions({
        rentingId: "renting-1",
        actorUserId: "renter-1",
        actorRole: "user",
        pickupInstructions: "Meet outside.",
        returnInstructions: "Leave with concierge.",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows owners to complete returns on active rentings", async () => {
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () =>
        createRentingRecord({
          status: "active",
        }),
      ),
      markCompleted: jest.fn(async () =>
        createRentingRecord({
          status: "completed",
          completedAt: "2026-05-04T00:00:00.000Z",
        }),
      ),
    } as unknown as RentingsRepository;
    const cacheService = {
      acquireLock: jest.fn(async (key: string) => ({
        key,
        token: `${key}-token`,
        release: jest.fn(async () => true),
        extend: jest.fn(async () => true),
      })),
    } as unknown as CacheService;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      cacheService,
      {} as never,
    );

    const result = await service.markCompleted({
      rentingId: "renting-1",
      actorUserId: "owner-1",
      actorRole: "owner",
    });

    expect((rentingsRepository.markCompleted as unknown as jest.Mock)).toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("rejects disputes after the 7-day completion window", async () => {
    const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString();
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () =>
        createRentingRecord({
          status: "completed",
          completedAt: elevenDaysAgo,
        }),
      ),
    } as unknown as RentingsRepository;
    const cacheService = {
      acquireLock: jest.fn(async (key: string) => ({
        key,
        token: `${key}-token`,
        release: jest.fn(async () => true),
        extend: jest.fn(async () => true),
      })),
    } as unknown as CacheService;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      cacheService,
      {} as never,
    );

    await expect(
      service.createDispute({
        rentingId: "renting-1",
        actorUserId: "renter-1",
        actorRole: "user",
        reason: "Issue",
        details: "Too late",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
