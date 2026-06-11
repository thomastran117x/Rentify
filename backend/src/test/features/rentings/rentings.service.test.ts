import type { BookingsRepository } from "@/features/bookings/bookings.repository";
import type { CacheService } from "@/features/cache/cache.service";
import type { PostingsAnalyticsRepository } from "@/features/postings/analytics/analytics.repository";
import type { PostingsPublicCacheService } from "@/features/postings/postings.public-cache.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { RentingsService } from "@/features/rentings/rentings.service";
import type { RentingsRepository } from "@/features/rentings/rentings.repository";
import ForbiddenError from "@/errors/http/forbidden.error";
import BadRequestError from "@/errors/http/bad-request.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";

function createRentingRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "renting-1",
    postingId: "posting-1",
    ownerId: "owner-1",
    organizationId: "org-1",
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
  function createOrganizationAccessService() {
    return {
      requireActiveMembership: jest.fn(async (userId: string) => ({
        organizationId: "org-1",
        userId,
        role: "primary_manager",
      })),
      requireMembership: jest.fn(
        async (userId: string, organizationId: string) => {
          if (userId.startsWith("owner")) {
            return {
              organizationId,
              userId,
              role: "primary_manager",
            };
          }

          throw new ForbiddenError(
            "Only organization managers can perform this renting action.",
          );
        },
      ),
      findMembership: jest.fn(async (userId: string, organizationId: string) =>
        userId.startsWith("owner")
          ? {
              organizationId,
              userId,
              role: "primary_manager",
            }
          : null,
      ),
      assertCanManage: jest.fn(() => undefined),
    } as unknown as OrganizationAccessService;
  }

  function createCacheService() {
    return {
      acquireLock: jest.fn(async (key: string) => ({
        key,
        token: `${key}-token`,
        release: jest.fn(async () => true),
        extend: jest.fn(async () => true),
      })),
    } as unknown as CacheService;
  }

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
        organizationId: "org-1",
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
      createOrganizationAccessService(),
    );

    await expect(
      service.convertApprovedBookingRequest({
        bookingRequestId: "booking-1",
        actorUserId: "owner-1",
      }),
    ).rejects.toThrow("boom");

    expect(
      (bookingsRepository.releaseConversionReservation as unknown as jest.Mock)
        .mock.calls[0],
    ).toEqual(["booking-1", "org-1", reservation]);
    expect(
      (postingsRepository.enqueueSearchSync as unknown as jest.Mock).mock.calls,
    ).toEqual([["posting-1"], ["posting-1"]]);
    expect(
      (postingsPublicCacheService.invalidatePublic as unknown as jest.Mock).mock
        .calls,
    ).toEqual([["posting-1"], ["posting-1"]]);
    expect(
      (cacheService.acquireLock as unknown as jest.Mock).mock.calls.map(
        ([key]) => key,
      ),
    ).toEqual([
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
        organizationId: "org-1",
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
        organizationId: "org-1",
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
      createOrganizationAccessService(),
    );

    const renting = await service.convertApprovedBookingRequest({
      bookingRequestId: "booking-1",
      actorUserId: "owner-1",
    });

    expect(renting.id).toBe("renting-1");
    expect(
      rentingsRepository.convertApprovedBookingRequest as unknown as jest.Mock,
    ).toHaveBeenCalledWith("booking-1", "org-1");
    expect(
      (postingsRepository.enqueueSearchSync as unknown as jest.Mock).mock.calls,
    ).toEqual([["posting-1"], ["posting-1"]]);
    expect(
      (postingsPublicCacheService.invalidatePublic as unknown as jest.Mock).mock
        .calls,
    ).toEqual([["posting-1"], ["posting-1"]]);
  });

  it("rejects conversion when the booking request cannot be found", async () => {
    const bookingsRepository = {
      findById: jest.fn(async () => null),
    } as unknown as BookingsRepository;
    const service = new RentingsService(
      {} as never,
      bookingsRepository,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createOrganizationAccessService(),
    );

    await expect(
      service.convertApprovedBookingRequest({
        bookingRequestId: "missing-booking",
        actorUserId: "owner-1",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("rejects conversion when the posting is archived", async () => {
    const bookingsRepository = {
      findById: jest.fn(async () => ({
        id: "booking-1",
        postingId: "posting-1",
        organizationId: "org-1",
      })),
    } as unknown as BookingsRepository;
    const service = new RentingsService(
      {} as never,
      bookingsRepository,
      {} as never,
      {
        findById: jest.fn(async () => ({
          id: "posting-1",
          status: "published",
          archivedAt: "2026-04-22T00:00:00.000Z",
        })),
      } as never,
      {} as never,
      {} as never,
      createOrganizationAccessService(),
    );

    await expect(
      service.convertApprovedBookingRequest({
        bookingRequestId: "booking-1",
        actorUserId: "owner-1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("surfaces a missing renting when conversion produces no renting record", async () => {
    const reservation = {
      reservedAt: new Date("2026-04-23T00:00:00.000Z"),
      reservationExpiresAt: new Date("2026-04-23T00:05:00.000Z"),
    };
    const bookingsRepository = {
      findById: jest.fn(async () => ({
        id: "booking-1",
        postingId: "posting-1",
        organizationId: "org-1",
      })),
      reserveForConversion: jest.fn(async () => reservation),
      releaseConversionReservation: jest.fn(async () => undefined),
    } as unknown as BookingsRepository;
    const rentingsRepository = {
      convertApprovedBookingRequest: jest.fn(async () => null),
    } as unknown as RentingsRepository;
    const postingsRepository = {
      findById: jest.fn(async () => ({
        id: "posting-1",
        status: "published",
      })),
      enqueueSearchSync: jest.fn(async () => undefined),
    } as unknown as PostingsRepository;
    const postingsPublicCacheService = {
      invalidatePublic: jest.fn(async () => 1),
    } as unknown as PostingsPublicCacheService;

    const service = new RentingsService(
      rentingsRepository,
      bookingsRepository,
      {} as never,
      postingsRepository,
      createCacheService(),
      postingsPublicCacheService,
      createOrganizationAccessService(),
    );

    await expect(
      service.convertApprovedBookingRequest({
        bookingRequestId: "booking-1",
        actorUserId: "owner-1",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    expect(
      bookingsRepository.releaseConversionReservation as unknown as jest.Mock,
    ).toHaveBeenCalledWith("booking-1", "org-1", reservation);
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
      createOrganizationAccessService(),
    );

    const result = await service.getById("renting-1", "renter-1", "user");

    expect(
      rentingsRepository.promoteReturnDueForRenting as unknown as jest.Mock,
    ).toHaveBeenCalled();
    expect(result.status).toBe("return_due");
  });

  it("rejects reading a renting that does not exist", async () => {
    const service = new RentingsService(
      {
        promoteReturnDueForRenting: jest.fn(async () => undefined),
        findById: jest.fn(async () => null),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createOrganizationAccessService(),
    );

    await expect(
      service.getById("missing-renting", "renter-1", "user"),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("rejects reading a renting for a non-participant without membership", async () => {
    const service = new RentingsService(
      {
        promoteReturnDueForRenting: jest.fn(async () => undefined),
        findById: jest.fn(async () => createRentingRecord()),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createOrganizationAccessService(),
    );

    await expect(
      service.getById("renting-1", "intruder-1", "user"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lists my rentings even when the user has no active organization", async () => {
    const listMine = jest.fn(async () => ({
      rentings: [createRentingRecord()],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    }));
    const organizationAccessService = createOrganizationAccessService();
    (
      organizationAccessService.requireActiveMembership as unknown as jest.Mock
    ).mockRejectedValueOnce(new ForbiddenError("missing org"));

    const service = new RentingsService(
      {
        promoteReturnDueForUser: jest.fn(async () => undefined),
        listMine,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      organizationAccessService,
    );

    const result = await service.listMine({
      userId: "renter-1",
      page: 1,
      pageSize: 10,
    });

    expect(listMine).toHaveBeenCalledWith({
      userId: "renter-1",
      page: 1,
      pageSize: 10,
      organizationId: undefined,
    });
    expect(result.rentings).toHaveLength(1);
  });

  it("rejects renters trying to update instructions", async () => {
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () => createRentingRecord()),
    } as unknown as RentingsRepository;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      createCacheService(),
      {} as never,
      createOrganizationAccessService(),
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

  it("updates instructions for an owner-managed renting", async () => {
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () => createRentingRecord()),
      updateInstructions: jest.fn(async () =>
        createRentingRecord({
          pickupInstructions: "Call on arrival.",
          returnInstructions: "Leave with concierge.",
        }),
      ),
    } as unknown as RentingsRepository;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      createCacheService(),
      {} as never,
      createOrganizationAccessService(),
    );

    const result = await service.updateInstructions({
      rentingId: "renting-1",
      actorUserId: "owner-1",
      actorRole: "owner",
      pickupInstructions: "Call on arrival.",
      returnInstructions: "Leave with concierge.",
    });

    expect(
      rentingsRepository.updateInstructions as unknown as jest.Mock,
    ).toHaveBeenCalledWith({
      rentingId: "renting-1",
      actorUserId: "owner-1",
      actorRole: "owner",
      pickupInstructions: "Call on arrival.",
      returnInstructions: "Leave with concierge.",
    });
    expect(result.pickupInstructions).toBe("Call on arrival.");
  });

  it("rejects updates for cancelled rentings", async () => {
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () =>
        createRentingRecord({
          status: "cancelled",
        }),
      ),
    } as unknown as RentingsRepository;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      createCacheService(),
      {} as never,
      createOrganizationAccessService(),
    );

    await expect(
      service.updateInstructions({
        rentingId: "renting-1",
        actorUserId: "owner-1",
        actorRole: "owner",
        pickupInstructions: "Call on arrival.",
        returnInstructions: "Leave with concierge.",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("surfaces a missing renting when updating instructions after access checks", async () => {
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () => createRentingRecord()),
      updateInstructions: jest.fn(async () => null),
    } as unknown as RentingsRepository;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      createCacheService(),
      {} as never,
      createOrganizationAccessService(),
    );

    await expect(
      service.updateInstructions({
        rentingId: "renting-1",
        actorUserId: "owner-1",
        actorRole: "owner",
        pickupInstructions: "Call on arrival.",
        returnInstructions: "Leave with concierge.",
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("marks check-in ready for an owner-managed renting", async () => {
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () => createRentingRecord()),
      markCheckInReady: jest.fn(async () =>
        createRentingRecord({
          status: "check_in_ready",
        }),
      ),
    } as unknown as RentingsRepository;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      createCacheService(),
      {} as never,
      createOrganizationAccessService(),
    );

    const result = await service.markCheckInReady({
      rentingId: "renting-1",
      actorUserId: "owner-1",
      actorRole: "owner",
    });

    expect(
      rentingsRepository.markCheckInReady as unknown as jest.Mock,
    ).toHaveBeenCalled();
    expect(result.status).toBe("check_in_ready");
  });

  it("allows renters to complete check-in", async () => {
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () => createRentingRecord()),
      markCheckInComplete: jest.fn(async () =>
        createRentingRecord({
          status: "active",
          checkInCompletedAt: "2026-05-01T00:00:00.000Z",
        }),
      ),
    } as unknown as RentingsRepository;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      createCacheService(),
      {} as never,
      createOrganizationAccessService(),
    );

    const result = await service.markCheckInComplete({
      rentingId: "renting-1",
      actorUserId: "renter-1",
      actorRole: "user",
    });

    expect(
      rentingsRepository.markCheckInComplete as unknown as jest.Mock,
    ).toHaveBeenCalled();
    expect(result.status).toBe("active");
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
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      createCacheService(),
      {} as never,
      createOrganizationAccessService(),
    );

    const result = await service.markCompleted({
      rentingId: "renting-1",
      actorUserId: "owner-1",
      actorRole: "owner",
    });

    expect(
      rentingsRepository.markCompleted as unknown as jest.Mock,
    ).toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("opens a dispute for an active renting", async () => {
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () =>
        createRentingRecord({
          status: "active",
        }),
      ),
      createDispute: jest.fn(async () =>
        createRentingRecord({
          status: "disputed",
          dispute: {
            id: "dispute-1",
            rentingId: "renting-1",
            openedByUserId: "renter-1",
            reason: "damage",
            createdAt: "2026-05-04T00:00:00.000Z",
            updatedAt: "2026-05-04T00:00:00.000Z",
          },
        }),
      ),
    } as unknown as RentingsRepository;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      createCacheService(),
      {} as never,
      createOrganizationAccessService(),
    );

    const result = await service.createDispute({
      rentingId: "renting-1",
      actorUserId: "renter-1",
      actorRole: "user",
      reason: "damage",
      details: "Broken lamp.",
    });

    expect(
      rentingsRepository.createDispute as unknown as jest.Mock,
    ).toHaveBeenCalled();
    expect(result.status).toBe("disputed");
  });

  it("rejects disputes when one is already open", async () => {
    const service = new RentingsService(
      {
        promoteReturnDueForRenting: jest.fn(async () => undefined),
        findById: jest.fn(async () =>
          createRentingRecord({
            status: "disputed",
            dispute: {
              id: "dispute-1",
            },
          }),
        ),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      createCacheService(),
      {} as never,
      createOrganizationAccessService(),
    );

    await expect(
      service.createDispute({
        rentingId: "renting-1",
        actorUserId: "renter-1",
        actorRole: "user",
        reason: "Issue",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects disputes after the 7-day completion window", async () => {
    const elevenDaysAgo = new Date(
      Date.now() - 11 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const rentingsRepository = {
      promoteReturnDueForRenting: jest.fn(async () => undefined),
      findById: jest.fn(async () =>
        createRentingRecord({
          status: "completed",
          completedAt: elevenDaysAgo,
        }),
      ),
    } as unknown as RentingsRepository;
    const service = new RentingsService(
      rentingsRepository,
      {} as never,
      {} as never,
      {} as never,
      createCacheService(),
      {} as never,
      createOrganizationAccessService(),
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
